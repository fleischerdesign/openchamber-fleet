//! Session: handshake, dispatch, streams, and the stdio run loop.
//!
//! Capabilities are advertised only when their handlers exist. v1 currently provides
//! `workspace.sync`; execution and artifact capabilities follow and are added to `Capabilities`
//! together with their dispatch arms.

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufReader, Read, Write};
use std::path::PathBuf;

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::frame;
use crate::identity;
use crate::model::Policy;
use crate::rpc::{self, Request};
use crate::sync::{self, TxnRecord};
use crate::workspace::{self, LeaseHandle, Registry};

pub const PROTOCOL_MAJOR: u64 = 1;
pub const PROTOCOL_MINOR: u64 = 0;
pub const AGENT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug)]
pub struct Capabilities {
    pub workspace_sync: bool,
    pub exec: bool,
    pub artifact: bool,
}

impl Default for Capabilities {
    fn default() -> Self {
        Self {
            workspace_sync: true,
            exec: false,
            artifact: false,
        }
    }
}

impl Capabilities {
    pub fn to_json(&self) -> Value {
        let mut map = Map::new();
        if self.workspace_sync {
            map.insert("workspace.sync".into(), json!(1));
        }
        if self.exec {
            map.insert("exec".into(), json!(1));
        }
        if self.artifact {
            map.insert("artifact".into(), json!(1));
        }
        Value::Object(map)
    }

    pub fn supports(&self, name: &str) -> bool {
        match name {
            "workspace.sync" => self.workspace_sync,
            "exec" => self.exec,
            "artifact" => self.artifact,
            _ => false,
        }
    }
}

struct Upload {
    txn_id: String,
    digest: String,
    size: u64,
    received: u64,
    next_seq: u64,
    hasher: Sha256,
    temporary: PathBuf,
    target: PathBuf,
    file: File,
}

pub struct Session {
    initialized: bool,
    installation: String,
    capabilities: Capabilities,
    registry: Registry,
    leases: HashMap<String, LeaseHandle>,
    transactions: HashMap<String, TxnRecord>,
    uploads: HashMap<u32, Upload>,
    next_stream: u32,
}

pub enum Action {
    Reply(String),
    Close(Option<String>),
}

impl Session {
    pub fn new() -> io::Result<Self> {
        Ok(Self {
            initialized: false,
            installation: identity::installation_id()?,
            capabilities: Capabilities::default(),
            registry: Registry::default(),
            leases: HashMap::new(),
            transactions: HashMap::new(),
            uploads: HashMap::new(),
            next_stream: 1,
        })
    }

    pub fn handle(&mut self, text: &str) -> Action {
        let request = match Request::parse(text) {
            Ok(request) => request,
            Err(error) => {
                return Action::Reply(rpc::error(
                    &Value::Null,
                    "INVALID_REQUEST",
                    &format!("malformed JSON-RPC: {error}"),
                    false,
                ))
            }
        };
        match request.method.as_str() {
            "session.initialize" => self.initialize(&request),
            "session.shutdown" => {
                Action::Close(Some(rpc::response(&request.id, json!({"ok": true}))))
            }
            "doctor" => self.doctor(&request),
            _ if !self.initialized => Action::Reply(rpc::error(
                &request.id,
                "NOT_INITIALIZED",
                "session.initialize must be the first message",
                false,
            )),
            "workspace.open" => self.workspace_open(&request),
            "workspace.status" => self.workspace_status(&request),
            "workspace.lease" => self.workspace_lease(&request),
            "workspace.release" => self.workspace_release(&request),
            "sync.begin" => self.sync_begin(&request),
            "sync.entries" => self.sync_entries(&request),
            "sync.plan" => self.sync_plan(&request),
            "sync.commit" => self.sync_commit(&request),
            "sync.abort" => self.sync_abort(&request),
            "sync.inspect" => self.sync_inspect(&request),
            "blob.put" => self.blob_put(&request),
            "stream.end" => self.stream_end(&request),
            other => Action::Reply(rpc::error(
                &request.id,
                "INVALID_REQUEST",
                &format!("unknown method {other}"),
                false,
            )),
        }
    }

    fn initialize(&mut self, request: &Request) -> Action {
        let major = request
            .params
            .get("protocol")
            .and_then(|protocol| protocol.get("major"))
            .and_then(Value::as_u64)
            .unwrap_or(u64::MAX);
        if major != PROTOCOL_MAJOR {
            let response = rpc::error(
                &request.id,
                "UNSUPPORTED_PROTOCOL",
                &format!("protocol major {major} is not {PROTOCOL_MAJOR}"),
                false,
            );
            return Action::Close(Some(response));
        }
        if let Some(required) = request.params.get("capabilities").and_then(Value::as_array) {
            for entry in required {
                let name = entry
                    .as_str()
                    .unwrap_or_default()
                    .split('@')
                    .next()
                    .unwrap_or_default()
                    .to_string();
                if !self.capabilities.supports(&name) {
                    let response = rpc::error(
                        &request.id,
                        "UNSUPPORTED_CAPABILITY",
                        &format!("agent does not provide {name}"),
                        false,
                    );
                    return Action::Close(Some(response));
                }
            }
        }
        self.initialized = true;
        let result = json!({
            "protocol": { "major": PROTOCOL_MAJOR, "minor": PROTOCOL_MINOR },
            "agent": {
                "version": AGENT_VERSION,
                "installationId": self.installation,
                "os": std::env::consts::OS,
                "arch": std::env::consts::ARCH,
                "pid": std::process::id(),
            },
            "capabilities": self.capabilities.to_json(),
            "limits": {
                "maxFrame": frame::MAX_FRAME,
                "maxControl": frame::MAX_CONTROL,
                "maxData": frame::MAX_DATA,
                "maxStreams": 32,
                "maxManifestEntries": 500_000,
                "defaultLeaseMs": workspace::DEFAULT_LEASE_MS,
            }
        });
        Action::Reply(rpc::response(&request.id, result))
    }

    fn doctor(&mut self, request: &Request) -> Action {
        let result = json!({
            "protocol": { "major": PROTOCOL_MAJOR, "minor": PROTOCOL_MINOR },
            "agent": { "version": AGENT_VERSION, "installationId": self.installation },
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "stateDir": identity::state_root().display().to_string(),
            "workspaceStateDir": workspace::state_root().display().to_string(),
            "capabilities": self.capabilities.to_json(),
        });
        Action::Reply(rpc::response(&request.id, result))
    }

    fn workspace_open(&mut self, request: &Request) -> Action {
        let Some(id) = request.params.get("workspaceId").and_then(Value::as_str) else {
            return usage_error(request, "workspaceId is required");
        };
        let Some(root) = request.params.get("root").and_then(Value::as_str) else {
            return usage_error(request, "root is required");
        };
        let adopt = request
            .params
            .get("adopt")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        match workspace::open_workspace(id, root, adopt) {
            Ok(workspace) => {
                let result = json!({
                    "workspaceId": workspace.id,
                    "root": workspace.root.to_string_lossy(),
                    "generation": workspace.generation,
                    "manifestDigest": workspace.manifest.digest,
                    "recovery": workspace.recovery.is_some(),
                });
                self.registry.insert(workspace);
                Action::Reply(rpc::response(&request.id, result))
            }
            Err(error) => Action::Reply(error_response(&request.id, &error)),
        }
    }

    fn workspace_status(&mut self, request: &Request) -> Action {
        let Some(id) = request.params.get("workspaceId").and_then(Value::as_str) else {
            return usage_error(request, "workspaceId is required");
        };
        let Some(workspace) = self.registry.get(id) else {
            return Action::Reply(rpc::error(&request.id, "WORKSPACE_UNKNOWN", id, false));
        };
        let result = json!({
            "workspaceId": workspace.id,
            "generation": workspace.generation,
            "manifestDigest": workspace.manifest.digest,
            "recovery": workspace.recovery.is_some(),
        });
        Action::Reply(rpc::response(&request.id, result))
    }

    fn workspace_lease(&mut self, request: &Request) -> Action {
        let Some(id) = request.params.get("workspaceId").and_then(Value::as_str) else {
            return usage_error(request, "workspaceId is required");
        };
        let Some(operation) = request.params.get("operationId").and_then(Value::as_str) else {
            return usage_error(request, "operationId is required");
        };
        let ttl = request
            .params
            .get("ttlMs")
            .and_then(Value::as_u64)
            .unwrap_or(workspace::DEFAULT_LEASE_MS);
        let Some(workspace) = self.registry.get(id) else {
            return Action::Reply(rpc::error(&request.id, "WORKSPACE_UNKNOWN", id, false));
        };
        if workspace.recovery.is_some() {
            return Action::Reply(rpc::error(
                &request.id,
                "RECOVERY_REQUIRED",
                "workspace has an unfinished transaction",
                true,
            ));
        }
        match workspace::acquire_lease(&workspace.state, operation, &self.installation, ttl) {
            Ok(handle) => {
                let result = json!({
                    "leaseId": operation,
                    "generation": workspace.generation,
                    "expiresAt": handle.meta.expires_at,
                });
                self.leases.insert(operation.to_string(), handle);
                Action::Reply(rpc::response(&request.id, result))
            }
            Err(error) => Action::Reply(error_response(&request.id, &error)),
        }
    }

    fn workspace_release(&mut self, request: &Request) -> Action {
        let Some(lease) = request.params.get("leaseId").and_then(Value::as_str) else {
            return usage_error(request, "leaseId is required");
        };
        match self.leases.remove(lease) {
            Some(handle) => {
                handle.release();
                Action::Reply(rpc::response(&request.id, json!({"ok": true})))
            }
            None => Action::Reply(rpc::error(&request.id, "LEASE_UNKNOWN", lease, false)),
        }
    }

    fn sync_begin(&mut self, request: &Request) -> Action {
        let Some(workspace_id) = request.params.get("workspaceId").and_then(Value::as_str) else {
            return usage_error(request, "workspaceId is required");
        };
        let Some(lease) = request.params.get("leaseId").and_then(Value::as_str) else {
            return usage_error(request, "leaseId is required");
        };
        if !self.leases.contains_key(lease) {
            return Action::Reply(rpc::error(&request.id, "LEASE_UNKNOWN", lease, false));
        }
        let base = request
            .params
            .get("baseGeneration")
            .and_then(Value::as_u64)
            .unwrap_or(u64::MAX);
        let policy: Policy = match request.params.get("policy") {
            Some(value) => match serde_json::from_value(value.clone()) {
                Ok(policy) => policy,
                Err(error) => return usage_error(request, &format!("invalid policy: {error}")),
            },
            None => Policy::default(),
        };
        let Some(workspace) = self.registry.get(workspace_id) else {
            return Action::Reply(rpc::error(
                &request.id,
                "WORKSPACE_UNKNOWN",
                workspace_id,
                false,
            ));
        };
        let txn_id = format!("txn-{}", identity_fragment());
        match sync::begin(workspace, policy, base, &txn_id) {
            Ok(record) => {
                self.transactions.insert(txn_id.clone(), record);
                Action::Reply(rpc::response(&request.id, json!({"txnId": txn_id})))
            }
            Err(error) => Action::Reply(error_response(&request.id, &error)),
        }
    }

    fn sync_entries(&mut self, request: &Request) -> Action {
        let Some(txn_id) = request.params.get("txnId").and_then(Value::as_str) else {
            return usage_error(request, "txnId is required");
        };
        let entries = match request.params.get("entries") {
            Some(value) => {
                match serde_json::from_value::<Vec<crate::model::Entry>>(value.clone()) {
                    Ok(entries) => entries,
                    Err(error) => {
                        return usage_error(request, &format!("invalid entries: {error}"))
                    }
                }
            }
            None => return usage_error(request, "entries are required"),
        };
        let Some(workspace_id) = self
            .transactions
            .get(txn_id)
            .map(|record| record.workspace.clone())
        else {
            return Action::Reply(rpc::error(&request.id, "OPERATION_UNKNOWN", txn_id, false));
        };
        let Some(workspace) = self.registry.get(&workspace_id) else {
            return Action::Reply(rpc::error(
                &request.id,
                "WORKSPACE_UNKNOWN",
                &workspace_id,
                false,
            ));
        };
        let Some(record) = self.transactions.get_mut(txn_id) else {
            return Action::Reply(rpc::error(&request.id, "OPERATION_UNKNOWN", txn_id, false));
        };
        match sync::add_entries(record, entries, workspace) {
            Ok(()) => Action::Reply(rpc::response(&request.id, json!({"accepted": true}))),
            Err(error) => Action::Reply(error_response(&request.id, &error)),
        }
    }

    fn sync_plan(&mut self, request: &Request) -> Action {
        let Some(txn_id) = request.params.get("txnId").and_then(Value::as_str) else {
            return usage_error(request, "txnId is required");
        };
        let Some(workspace_id) = self
            .transactions
            .get(txn_id)
            .map(|record| record.workspace.clone())
        else {
            return Action::Reply(rpc::error(&request.id, "OPERATION_UNKNOWN", txn_id, false));
        };
        let Some(workspace) = self.registry.get(&workspace_id) else {
            return Action::Reply(rpc::error(
                &request.id,
                "WORKSPACE_UNKNOWN",
                &workspace_id,
                false,
            ));
        };
        let Some(record) = self.transactions.get_mut(txn_id) else {
            return Action::Reply(rpc::error(&request.id, "OPERATION_UNKNOWN", txn_id, false));
        };
        match sync::plan(record, workspace) {
            Ok(result) => {
                let changes: Vec<Value> = result
                    .changes
                    .iter()
                    .map(|change| json!({"action": change.action, "path": change.path}))
                    .collect();
                let response = json!({
                    "planDigest": result.plan_digest,
                    "changes": changes,
                    "needed": result.needed,
                });
                Action::Reply(rpc::response(&request.id, response))
            }
            Err(error) => Action::Reply(error_response(&request.id, &error)),
        }
    }

    fn blob_put(&mut self, request: &Request) -> Action {
        let Some(txn_id) = request.params.get("txnId").and_then(Value::as_str) else {
            return usage_error(request, "txnId is required");
        };
        let Some(digest) = request.params.get("digest").and_then(Value::as_str) else {
            return usage_error(request, "digest is required");
        };
        let size = request
            .params
            .get("size")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let Some(workspace_id) = self
            .transactions
            .get(txn_id)
            .map(|record| record.workspace.clone())
        else {
            return Action::Reply(rpc::error(&request.id, "OPERATION_UNKNOWN", txn_id, false));
        };
        let Some(workspace) = self.registry.get(&workspace_id) else {
            return Action::Reply(rpc::error(
                &request.id,
                "WORKSPACE_UNKNOWN",
                &workspace_id,
                false,
            ));
        };
        let directory = sync::blob_dir(workspace);
        if let Err(error) = fs::create_dir_all(&directory) {
            return Action::Reply(rpc::error(
                &request.id,
                "INTERNAL",
                &error.to_string(),
                false,
            ));
        }
        let stream = self.next_stream;
        self.next_stream += 1;
        let temporary = directory.join(format!(".upload-{stream}-{}", std::process::id()));
        let file = match OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temporary)
        {
            Ok(file) => file,
            Err(error) => {
                return Action::Reply(rpc::error(
                    &request.id,
                    "INTERNAL",
                    &error.to_string(),
                    false,
                ))
            }
        };
        let target = sync::blob_path(workspace, digest);
        self.uploads.insert(
            stream,
            Upload {
                txn_id: txn_id.to_string(),
                digest: digest.to_string(),
                size,
                received: 0,
                next_seq: 0,
                hasher: Sha256::new(),
                temporary,
                target,
                file,
            },
        );
        Action::Reply(rpc::response(&request.id, json!({"streamId": stream})))
    }

    fn stream_end(&mut self, request: &Request) -> Action {
        let Some(stream) = request.params.get("streamId").and_then(Value::as_u64) else {
            return usage_error(request, "streamId is required");
        };
        let Some(upload) = self.uploads.remove(&(stream as u32)) else {
            return Action::Reply(rpc::error(
                &request.id,
                "OPERATION_UNKNOWN",
                "stream",
                false,
            ));
        };
        let digest = format!("sha256:{}", hex::encode(upload.hasher.finalize()));
        if upload.received != upload.size {
            let _ = fs::remove_file(&upload.temporary);
            return Action::Reply(rpc::error(
                &request.id,
                "BLOB_CORRUPT",
                &format!("size {} is not {}", upload.received, upload.size),
                false,
            ));
        }
        if digest != upload.digest {
            let _ = fs::remove_file(&upload.temporary);
            return Action::Reply(rpc::error(&request.id, "BLOB_CORRUPT", &digest, false));
        }
        drop(upload.file);
        if let Err(error) = fs::rename(&upload.temporary, &upload.target) {
            return Action::Reply(rpc::error(
                &request.id,
                "INTERNAL",
                &error.to_string(),
                false,
            ));
        }
        Action::Reply(rpc::response(
            &request.id,
            json!({"digest": digest, "txnId": upload.txn_id}),
        ))
    }

    fn sync_commit(&mut self, request: &Request) -> Action {
        let Some(txn_id) = request.params.get("txnId").and_then(Value::as_str) else {
            return usage_error(request, "txnId is required");
        };
        let Some(plan_digest) = request.params.get("planDigest").and_then(Value::as_str) else {
            return usage_error(request, "planDigest is required");
        };
        let Some(mut record) = self.transactions.remove(txn_id) else {
            return Action::Reply(rpc::error(&request.id, "OPERATION_UNKNOWN", txn_id, false));
        };
        let Some(workspace) = self.registry.get_mut(&record.workspace.clone()) else {
            self.transactions.insert(txn_id.to_string(), record);
            return Action::Reply(rpc::error(
                &request.id,
                "WORKSPACE_UNKNOWN",
                "workspace",
                false,
            ));
        };
        match sync::commit(&mut record, workspace, plan_digest) {
            Ok((generation, _digest)) => {
                let result =
                    json!({"generation": generation, "manifestDigest": workspace.manifest.digest});
                Action::Reply(rpc::response(&request.id, result))
            }
            Err(error) => {
                self.transactions.insert(txn_id.to_string(), record);
                Action::Reply(error_response(&request.id, &error))
            }
        }
    }

    fn sync_abort(&mut self, request: &Request) -> Action {
        let Some(txn_id) = request.params.get("txnId").and_then(Value::as_str) else {
            return usage_error(request, "txnId is required");
        };
        let Some(record) = self.transactions.remove(txn_id) else {
            return Action::Reply(rpc::error(&request.id, "OPERATION_UNKNOWN", txn_id, false));
        };
        let Some(workspace) = self.registry.get(&record.workspace) else {
            return Action::Reply(rpc::error(
                &request.id,
                "WORKSPACE_UNKNOWN",
                "workspace",
                false,
            ));
        };
        match sync::abort(workspace) {
            Ok(()) => Action::Reply(rpc::response(&request.id, json!({"ok": true}))),
            Err(error) => Action::Reply(error_response(&request.id, &error)),
        }
    }

    fn sync_inspect(&mut self, request: &Request) -> Action {
        let Some(workspace_id) = request.params.get("workspaceId").and_then(Value::as_str) else {
            return usage_error(request, "workspaceId is required");
        };
        let Some(workspace) = self.registry.get(workspace_id) else {
            return Action::Reply(rpc::error(
                &request.id,
                "WORKSPACE_UNKNOWN",
                workspace_id,
                false,
            ));
        };
        match sync::inspect(workspace) {
            Some(record) => Action::Reply(rpc::response(
                &request.id,
                json!({
                    "state": "RECOVERY",
                    "txnId": record.txn_id,
                    "phase": record.phase,
                    "planDigest": record.plan_digest,
                    "startedAt": record.started_at,
                }),
            )),
            None => Action::Reply(rpc::response(
                &request.id,
                json!({"state": "READY", "generation": workspace.generation}),
            )),
        }
    }

    /// Feed one DATA frame. Returns a control response when the frame was invalid.
    pub fn handle_data(&mut self, payload: &[u8]) -> Option<String> {
        if payload.len() < 12 {
            return Some(rpc::error(
                &Value::Null,
                "INVALID_FRAME",
                "data frame too short",
                false,
            ));
        }
        let stream = u32::from_be_bytes([payload[0], payload[1], payload[2], payload[3]]);
        let seq = u64::from_be_bytes(payload[4..12].try_into().ok()?);
        let bytes = &payload[12..];
        let Some(upload) = self.uploads.get_mut(&stream) else {
            return Some(rpc::error(
                &Value::Null,
                "INVALID_FRAME",
                "unknown stream",
                false,
            ));
        };
        if seq != upload.next_seq {
            return Some(rpc::error(
                &Value::Null,
                "INVALID_FRAME",
                "sequence gap",
                false,
            ));
        }
        if upload.received + bytes.len() as u64 > upload.size {
            return Some(rpc::error(
                &Value::Null,
                "BLOB_CORRUPT",
                "more bytes than declared",
                false,
            ));
        }
        if let Err(error) = upload.file.write_all(bytes) {
            return Some(rpc::error(
                &Value::Null,
                "INTERNAL",
                &error.to_string(),
                false,
            ));
        }
        upload.hasher.update(bytes);
        upload.received += bytes.len() as u64;
        upload.next_seq += 1;
        None
    }
}

fn identity_fragment() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    format!("{:x}{:x}", nanos, std::process::id())
}

fn usage_error(request: &Request, message: &str) -> Action {
    Action::Reply(rpc::error(&request.id, "INVALID_REQUEST", message, false))
}

fn error_response(id: &Value, message: &str) -> String {
    let mut parts = message.splitn(2, ' ');
    let candidate = parts.next().unwrap_or("INTERNAL");
    let rest = parts.next().unwrap_or(message);
    let known = [
        "WORKSPACE_UNKNOWN",
        "WORKSPACE_BUSY",
        "RECOVERY_REQUIRED",
        "GENERATION_MISMATCH",
        "LEASE_UNKNOWN",
        "LEASE_EXPIRED",
        "PATH_UNSAFE",
        "UNSUPPORTED_METADATA",
        "PLAN_MISMATCH",
        "BLOB_MISSING",
        "BLOB_CORRUPT",
        "DISK_FULL",
        "PERMISSION_DENIED",
        "RESOURCE_EXHAUSTED",
        "OPERATION_UNKNOWN",
        "INVALID_REQUEST",
        "INTERNAL",
    ];
    if known.contains(&candidate) {
        rpc::error(
            id,
            candidate,
            rest,
            candidate == "WORKSPACE_BUSY" || candidate == "RECOVERY_REQUIRED",
        )
    } else {
        rpc::error(id, "INTERNAL", message, false)
    }
}

pub fn run_stdio() -> io::Result<()> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut session = Session::new()?;
    session.run(BufReader::new(stdin.lock()), stdout.lock())
}

impl Session {
    pub fn run<R: Read, W: Write>(&mut self, mut reader: R, mut writer: W) -> io::Result<()> {
        loop {
            let frame = match frame::read_frame(&mut reader) {
                Ok(Some(frame)) => frame,
                Ok(None) => return Ok(()),
                Err(error) => return Err(error),
            };
            match frame.kind {
                frame::CONTROL => {
                    let Ok(text) = std::str::from_utf8(&frame.payload) else {
                        let response = rpc::error(
                            &Value::Null,
                            "INVALID_FRAME",
                            "control frame is not UTF-8",
                            false,
                        );
                        frame::write_control(&mut writer, &response)?;
                        return Ok(());
                    };
                    match self.handle(text) {
                        Action::Reply(response) => frame::write_control(&mut writer, &response)?,
                        Action::Close(response) => {
                            if let Some(response) = response {
                                frame::write_control(&mut writer, &response)?;
                            }
                            return Ok(());
                        }
                    }
                }
                frame::DATA => {
                    if let Some(response) = self.handle_data(&frame.payload) {
                        frame::write_control(&mut writer, &response)?;
                        return Ok(());
                    }
                }
                _ => unreachable!("frame kind validated by read_frame"),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::sha256_hex;
    use std::io::Cursor;

    fn reply(session: &mut Session, text: &str) -> Value {
        match session.handle(text) {
            Action::Reply(response) | Action::Close(Some(response)) => {
                serde_json::from_str(&response).unwrap()
            }
            Action::Close(None) => Value::Null,
        }
    }

    fn init(session: &mut Session) {
        let value = reply(
            session,
            r#"{"jsonrpc":"2.0","id":"1","method":"session.initialize","params":{"protocol":{"major":1}}}"#,
        );
        assert!(value.get("result").is_some(), "{value}");
    }

    #[test]
    fn handshake_returns_identity_and_limits() {
        let mut session = Session::new().unwrap();
        let response = reply(
            &mut session,
            r#"{"jsonrpc":"2.0","id":"1","method":"session.initialize","params":{"protocol":{"major":1}}}"#,
        );
        assert_eq!(response["result"]["protocol"]["major"], 1);
        assert_eq!(
            response["result"]["agent"]["installationId"]
                .as_str()
                .unwrap()
                .len(),
            32
        );
        assert!(response["result"]["limits"]["maxControl"].as_u64().unwrap() > 0);
    }

    #[test]
    fn method_before_handshake_is_refused() {
        let mut session = Session::new().unwrap();
        let response = reply(
            &mut session,
            r#"{"jsonrpc":"2.0","id":3,"method":"workspace.status","params":{}}"#,
        );
        assert_eq!(response["error"]["code"], "NOT_INITIALIZED");
    }

    #[test]
    fn version_mismatch_closes() {
        let mut session = Session::new().unwrap();
        match session.handle(r#"{"jsonrpc":"2.0","id":2,"method":"session.initialize","params":{"protocol":{"major":2}}}"#) {
            Action::Close(Some(response)) => {
                let value: Value = serde_json::from_str(&response).unwrap();
                assert_eq!(value["error"]["code"], "UNSUPPORTED_PROTOCOL");
            }
            _ => panic!("expected close with error"),
        }
    }

    #[test]
    fn full_sync_through_the_session() {
        let base = std::env::temp_dir().join(format!("fleet-agent-session-{}", std::process::id()));
        let root = base.join("replica");
        let state = base.join("state");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&state).unwrap();
        std::env::set_var("FLEET_AGENT_STATE_DIR", &state);

        let mut session = Session::new().unwrap();
        init(&mut session);
        let open = reply(
            &mut session,
            &json!({"jsonrpc":"2.0","id":"2","method":"workspace.open","params":{
                "workspaceId":"demo","root":root.to_string_lossy(),"adopt":true}})
            .to_string(),
        );
        assert!(open.get("result").is_some(), "{open}");
        let lease = reply(
            &mut session,
            &json!({"jsonrpc":"2.0","id":"3","method":"workspace.lease","params":{
                "workspaceId":"demo","operationId":"op1","ttlMs":60000}})
            .to_string(),
        );
        assert!(lease.get("result").is_some(), "{lease}");
        let begin = reply(
            &mut session,
            &json!({"jsonrpc":"2.0","id":"4","method":"sync.begin","params":{
                "workspaceId":"demo","leaseId":"op1","baseGeneration":0,"policy":{}}})
            .to_string(),
        );
        let txn = begin["result"]["txnId"].as_str().unwrap().to_string();

        let content = b"hello through the wire\n";
        let digest = format!("sha256:{}", sha256_hex(content));
        let entries = json!([{
            "path":"src/app.txt","type":"file","mode":"0644","size":content.len(),
            "mtimeMs":0,"digest":digest
        }]);
        let entries_reply = reply(
            &mut session,
            &json!({"jsonrpc":"2.0","id":"5","method":"sync.entries","params":{"txnId":txn,"entries":entries}}).to_string(),
        );
        assert!(entries_reply.get("result").is_some(), "{entries_reply}");
        let plan = reply(
            &mut session,
            &json!({"jsonrpc":"2.0","id":"6","method":"sync.plan","params":{"txnId":txn}})
                .to_string(),
        );
        let plan_digest = plan["result"]["planDigest"].as_str().unwrap().to_string();
        assert_eq!(plan["result"]["needed"].as_array().unwrap().len(), 1);

        let put = reply(
            &mut session,
            &json!({"jsonrpc":"2.0","id":"7","method":"blob.put","params":{
                "txnId":txn,"digest":digest,"size":content.len()}})
            .to_string(),
        );
        let stream = put["result"]["streamId"].as_u64().unwrap() as u32;
        let mut frame = Vec::new();
        frame.extend_from_slice(&stream.to_be_bytes());
        frame.extend_from_slice(&0u64.to_be_bytes());
        frame.extend_from_slice(content);
        assert!(session.handle_data(&frame).is_none());
        let end = reply(
            &mut session,
            &json!({"jsonrpc":"2.0","id":"8","method":"stream.end","params":{"streamId":stream}})
                .to_string(),
        );
        assert!(end.get("result").is_some(), "{end}");
        let commit = reply(
            &mut session,
            &json!({"jsonrpc":"2.0","id":"9","method":"sync.commit","params":{
                "txnId":txn,"planDigest":plan_digest}})
            .to_string(),
        );
        assert_eq!(commit["result"]["generation"], 1, "{commit}");
        assert_eq!(fs::read(root.join("src/app.txt")).unwrap(), content);
    }

    #[test]
    fn run_loop_answers_over_a_byte_stream() {
        let mut request = Vec::new();
        frame::write_control(&mut request, r#"{"jsonrpc":"2.0","id":"1","method":"session.initialize","params":{"protocol":{"major":1}}}"#).unwrap();
        frame::write_control(
            &mut request,
            r#"{"jsonrpc":"2.0","id":"2","method":"session.shutdown"}"#,
        )
        .unwrap();
        let mut output = Vec::new();
        let mut session = Session::new().unwrap();
        session.run(Cursor::new(request), &mut output).unwrap();
        let mut reader = Cursor::new(output);
        let first = frame::read_frame(&mut reader).unwrap().unwrap();
        let value: Value = serde_json::from_slice(&first.payload).unwrap();
        assert_eq!(value["id"], "1");
        let second = frame::read_frame(&mut reader).unwrap().unwrap();
        let value: Value = serde_json::from_slice(&second.payload).unwrap();
        assert_eq!(value["id"], "2");
    }
}
