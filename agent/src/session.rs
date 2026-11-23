//! Session: handshake, dispatch, streams, and the stdio run loop.
//!
//! Capabilities are advertised only when their handlers exist. v1 currently provides
//! `workspace.sync`; execution and artifact capabilities follow and are added to `Capabilities`
//! together with their dispatch arms.

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufReader, Read, Write};
use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::exec::{self, Buffer, Job};
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
            exec: true,
            artifact: true,
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
    jobs: HashMap<String, Arc<Job>>,
    out_streams: HashMap<u32, OutStream>,
    next_stream: u32,
}

struct OutStream {
    buffer: Arc<Buffer>,
    credit: u64,
    seq: u64,
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
            jobs: HashMap::new(),
            out_streams: HashMap::new(),
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
            "sync.planPage" => self.sync_plan_page(&request),
            "sync.commit" => self.sync_commit(&request),
            "sync.abort" => self.sync_abort(&request),
            "sync.recover" => self.sync_recover(&request),
            "sync.inspect" => self.sync_inspect(&request),
            "blob.put" => self.blob_put(&request),
            "stream.end" => self.stream_end(&request),
            "stream.credit" => self.stream_credit(&request),
            "exec.start" => self.exec_start(&request),
            "exec.status" => self.exec_status(&request),
            "exec.cancel" => self.exec_cancel(&request),
            "exec.list" => self.exec_list(&request),
            "artifact.open" => self.artifact_open(&request),
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
                // Plan lists can exceed a control frame; they are paged via sync.planPage.
                let response = json!({
                    "planDigest": result.plan_digest,
                    "changes": result.changes.len(),
                    "needed": result.needed.len(),
                });
                Action::Reply(rpc::response(&request.id, response))
            }
            Err(error) => Action::Reply(error_response(&request.id, &error)),
        }
    }

    fn sync_plan_page(&mut self, request: &Request) -> Action {
        let Some(txn_id) = request.params.get("txnId").and_then(Value::as_str) else {
            return usage_error(request, "txnId is required");
        };
        let Some(kind) = request.params.get("kind").and_then(Value::as_str) else {
            return usage_error(request, "kind is required");
        };
        let offset = request
            .params
            .get("offset")
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize;
        let limit = request
            .params
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(5000)
            .min(5000) as usize;
        let Some(record) = self.transactions.get(txn_id) else {
            return Action::Reply(rpc::error(&request.id, "OPERATION_UNKNOWN", txn_id, false));
        };
        let (items, total) = match kind {
            "changes" => (
                record
                    .changes
                    .iter()
                    .skip(offset)
                    .take(limit)
                    .map(|change| json!({"action": change.action, "path": change.path}))
                    .collect::<Vec<_>>(),
                record.changes.len(),
            ),
            "needed" => (
                record
                    .needed
                    .iter()
                    .skip(offset)
                    .take(limit)
                    .map(|digest| json!(digest))
                    .collect::<Vec<_>>(),
                record.needed.len(),
            ),
            _ => return usage_error(request, "kind must be changes or needed"),
        };
        Action::Reply(rpc::response(
            &request.id,
            json!({"items": items, "more": offset + items.len() < total}),
        ))
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
                if let Some(entry) = self.registry.get_mut(&record.workspace) {
                    entry.recovery = Some("applying".into());
                }
                self.transactions.insert(txn_id.to_string(), record);
                Action::Reply(error_response(&request.id, &error))
            }
        }
    }

    fn sync_recover(&mut self, request: &Request) -> Action {
        let Some(txn_id) = request.params.get("txnId").and_then(Value::as_str) else {
            return usage_error(request, "txnId is required");
        };
        let workspace_id = match self.transactions.remove(txn_id) {
            Some(record) => Some(record.workspace),
            None => {
                let mut found = None;
                for id in self.registry.ids() {
                    if let Some(workspace) = self.registry.get(&id) {
                        if let Ok(Some(record)) = workspace::read_journal(&workspace.state) {
                            if record.get("txnId").and_then(Value::as_str) == Some(txn_id) {
                                found = Some(id);
                                break;
                            }
                        }
                    }
                }
                found
            }
        };
        let Some(workspace_id) = workspace_id else {
            return Action::Reply(rpc::error(&request.id, "OPERATION_UNKNOWN", txn_id, false));
        };
        let Some(mut workspace) = self.registry.get(&workspace_id).cloned() else {
            return Action::Reply(rpc::error(
                &request.id,
                "WORKSPACE_UNKNOWN",
                &workspace_id,
                false,
            ));
        };
        let mut record = match workspace::read_journal(&workspace.state) {
            Ok(Some(value)) => match serde_json::from_value::<TxnRecord>(value) {
                Ok(record) => record,
                Err(error) => {
                    return Action::Reply(rpc::error(
                        &request.id,
                        "INTERNAL",
                        &error.to_string(),
                        false,
                    ))
                }
            },
            _ => return Action::Reply(rpc::error(&request.id, "OPERATION_UNKNOWN", txn_id, false)),
        };
        match sync::resume(&mut record, &mut workspace) {
            Ok((generation, manifest_digest)) => {
                self.registry.insert(workspace);
                Action::Reply(rpc::response(
                    &request.id,
                    json!({"generation": generation, "manifestDigest": manifest_digest}),
                ))
            }
            Err(error) => Action::Reply(error_response(&request.id, &error)),
        }
    }

    fn sync_abort(&mut self, request: &Request) -> Action {
        let Some(txn_id) = request.params.get("txnId").and_then(Value::as_str) else {
            return usage_error(request, "txnId is required");
        };
        let workspace_id = match self.transactions.remove(txn_id) {
            Some(record) => Some(record.workspace),
            None => {
                // The transaction may survive a restart only as a journal. Find its workspace.
                let mut found = None;
                for id in self.registry.ids() {
                    if let Some(workspace) = self.registry.get(&id) {
                        if let Ok(Some(record)) = workspace::read_journal(&workspace.state) {
                            if record.get("txnId").and_then(Value::as_str) == Some(txn_id) {
                                found = Some(id);
                                break;
                            }
                        }
                    }
                }
                found
            }
        };
        let Some(workspace_id) = workspace_id else {
            return Action::Reply(rpc::error(&request.id, "OPERATION_UNKNOWN", txn_id, false));
        };
        let Some(workspace) = self.registry.get(&workspace_id).cloned() else {
            return Action::Reply(rpc::error(
                &request.id,
                "WORKSPACE_UNKNOWN",
                &workspace_id,
                false,
            ));
        };
        match sync::abort(&workspace) {
            Ok(()) => {
                if let Some(entry) = self.registry.get_mut(&workspace_id) {
                    entry.recovery = None;
                }
                Action::Reply(rpc::response(&request.id, json!({"ok": true})))
            }
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

impl Session {
    fn stream_credit(&mut self, request: &Request) -> Action {
        let Some(stream) = request.params.get("streamId").and_then(Value::as_u64) else {
            return usage_error(request, "streamId is required");
        };
        let Some(bytes) = request.params.get("bytes").and_then(Value::as_u64) else {
            return usage_error(request, "bytes is required");
        };
        match self.out_streams.get_mut(&(stream as u32)) {
            Some(entry) => {
                entry.credit = entry.credit.saturating_add(bytes);
                Action::Reply(rpc::response(&request.id, json!({"ok": true})))
            }
            None => Action::Reply(rpc::error(
                &request.id,
                "OPERATION_UNKNOWN",
                "stream",
                false,
            )),
        }
    }

    fn exec_start(&mut self, request: &Request) -> Action {
        let Some(workspace_id) = request.params.get("workspaceId").and_then(Value::as_str) else {
            return usage_error(request, "workspaceId is required");
        };
        let Some(lease) = request.params.get("leaseId").and_then(Value::as_str) else {
            return usage_error(request, "leaseId is required");
        };
        if !self.leases.contains_key(lease) {
            return Action::Reply(rpc::error(&request.id, "LEASE_UNKNOWN", lease, false));
        }
        let Some(argv) = request.params.get("argv").and_then(Value::as_array) else {
            return usage_error(request, "argv is required");
        };
        let argv: Vec<String> = argv
            .iter()
            .filter_map(Value::as_str)
            .map(ToString::to_string)
            .collect();
        if argv.is_empty() {
            return usage_error(request, "argv must not be empty");
        }
        let expected = request
            .params
            .get("expectedGeneration")
            .and_then(Value::as_u64)
            .unwrap_or(u64::MAX);
        let cwd = request
            .params
            .get("cwd")
            .and_then(Value::as_str)
            .map(ToString::to_string);
        let timeout_ms = request.params.get("timeoutMs").and_then(Value::as_u64);
        let mut env = Vec::new();
        if let Some(value) = request.params.get("env") {
            if let Some(object) = value.as_object() {
                for (key, value) in object {
                    if let Some(value) = value.as_str() {
                        env.push((key.clone(), value.to_string()));
                    }
                }
            }
        }
        let Some(workspace) = self.registry.get(workspace_id) else {
            return Action::Reply(rpc::error(
                &request.id,
                "WORKSPACE_UNKNOWN",
                workspace_id,
                false,
            ));
        };
        if expected != u64::MAX && workspace.generation != expected {
            return Action::Reply(rpc::error(
                &request.id,
                "GENERATION_MISMATCH",
                &format!("expected {expected} actual {}", workspace.generation),
                false,
            ));
        }
        let job_id = format!("job-{}", identity_fragment());
        let stdout_stream = self.next_stream;
        let stderr_stream = stdout_stream + 1;
        self.next_stream += 2;
        let spawn_request = exec::SpawnRequest {
            job_id: job_id.clone(),
            workspace: workspace.id.clone(),
            workspace_root: workspace.root.clone(),
            argv,
            cwd,
            env,
            timeout_ms,
            state_dir: Some(workspace.state.clone()),
        };
        match exec::spawn(spawn_request) {
            Ok(job) => {
                self.out_streams.insert(
                    stdout_stream,
                    OutStream {
                        buffer: job.stdout.clone(),
                        credit: 0,
                        seq: 0,
                    },
                );
                self.out_streams.insert(
                    stderr_stream,
                    OutStream {
                        buffer: job.stderr.clone(),
                        credit: 0,
                        seq: 0,
                    },
                );
                let record = job.status();
                let _ = exec::persist(&workspace.state, &record);
                self.jobs.insert(job_id.clone(), Arc::new(job));
                Action::Reply(rpc::response(
                    &request.id,
                    json!({
                        "jobId": job_id,
                        "state": record.state,
                        "stdoutStream": stdout_stream,
                        "stderrStream": stderr_stream,
                    }),
                ))
            }
            Err(error) => Action::Reply(error_response(&request.id, &error)),
        }
    }

    fn exec_status(&mut self, request: &Request) -> Action {
        let Some(job_id) = request.params.get("jobId").and_then(Value::as_str) else {
            return usage_error(request, "jobId is required");
        };
        let Some(job) = self.jobs.get(job_id) else {
            return Action::Reply(rpc::error(&request.id, "OPERATION_UNKNOWN", job_id, false));
        };
        let record = job.status();
        Action::Reply(rpc::response(
            &request.id,
            serde_json::to_value(record).unwrap_or(Value::Null),
        ))
    }

    fn exec_cancel(&mut self, request: &Request) -> Action {
        let Some(job_id) = request.params.get("jobId").and_then(Value::as_str) else {
            return usage_error(request, "jobId is required");
        };
        let grace = request
            .params
            .get("graceMs")
            .and_then(Value::as_u64)
            .unwrap_or(2000);
        let Some(job) = self.jobs.get(job_id) else {
            return Action::Reply(rpc::error(&request.id, "OPERATION_UNKNOWN", job_id, false));
        };
        job.cancel(grace);
        Action::Reply(rpc::response(&request.id, json!({"accepted": true})))
    }

    fn exec_list(&mut self, request: &Request) -> Action {
        let records: Vec<Value> = self
            .jobs
            .values()
            .map(|job| serde_json::to_value(job.status()).unwrap_or(Value::Null))
            .collect();
        Action::Reply(rpc::response(&request.id, json!({"jobs": records})))
    }

    fn artifact_open(&mut self, request: &Request) -> Action {
        let Some(workspace_id) = request.params.get("workspaceId").and_then(Value::as_str) else {
            return usage_error(request, "workspaceId is required");
        };
        let Some(path) = request.params.get("path").and_then(Value::as_str) else {
            return usage_error(request, "path is required");
        };
        let Some(workspace) = self.registry.get(workspace_id) else {
            return Action::Reply(rpc::error(
                &request.id,
                "WORKSPACE_UNKNOWN",
                workspace_id,
                false,
            ));
        };
        if let Err(error) = crate::model::validate_path(path) {
            return Action::Reply(rpc::error(&request.id, "PATH_UNSAFE", &error, false));
        }
        let target = workspace.root.join(path);
        let metadata = match fs::symlink_metadata(&target) {
            Ok(metadata) => metadata,
            Err(_) => {
                return Action::Reply(rpc::error(&request.id, "OPERATION_UNKNOWN", path, false))
            }
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Action::Reply(rpc::error(
                &request.id,
                "PATH_UNSAFE",
                "not a regular file",
                false,
            ));
        }
        let bytes = match fs::read(&target) {
            Ok(bytes) => bytes,
            Err(error) => {
                return Action::Reply(rpc::error(
                    &request.id,
                    "INTERNAL",
                    &error.to_string(),
                    false,
                ))
            }
        };
        let digest = format!("sha256:{}", crate::model::sha256_hex(&bytes));
        let buffer = Buffer::new();
        buffer.push(&bytes);
        buffer.end();
        let stream = self.next_stream;
        self.next_stream += 1;
        self.out_streams.insert(
            stream,
            OutStream {
                buffer,
                credit: 0,
                seq: 0,
            },
        );
        Action::Reply(rpc::response(
            &request.id,
            json!({"streamId": stream, "size": bytes.len(), "digest": digest}),
        ))
    }

    fn pump<W: Write>(&mut self, writer: &mut W) -> io::Result<()> {
        let mut finished: Vec<(u32, u64)> = Vec::new();
        for (id, stream) in self.out_streams.iter_mut() {
            if stream.credit == 0 {
                continue;
            }
            let limit = stream.credit.min(exec::CHUNK as u64) as usize;
            match stream.buffer.take(limit) {
                None => finished.push((*id, stream.seq)),
                Some(bytes) if bytes.is_empty() => {}
                Some(bytes) => {
                    let mut payload = Vec::with_capacity(12 + bytes.len());
                    payload.extend_from_slice(&id.to_be_bytes());
                    payload.extend_from_slice(&stream.seq.to_be_bytes());
                    payload.extend_from_slice(&bytes);
                    frame::write_frame(writer, frame::DATA, &payload)?;
                    stream.seq += 1;
                    stream.credit -= bytes.len() as u64;
                }
            }
        }
        for (id, seq) in finished {
            frame::write_control(
                writer,
                &rpc::notification("stream.end", json!({"streamId": id, "seq": seq})),
            )?;
            self.out_streams.remove(&id);
        }
        Ok(())
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
    let mut session = Session::new()?;
    session.run(BufReader::new(io::stdin()), io::stdout())
}

impl Session {
    pub fn run<R: Read + Send + 'static, W: Write>(
        &mut self,
        mut reader: R,
        mut writer: W,
    ) -> io::Result<()> {
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || loop {
            match frame::read_frame(&mut reader) {
                Ok(Some(frame)) => {
                    if sender.send(Ok(frame)).is_err() {
                        break;
                    }
                }
                Ok(None) => {
                    let _ = sender.send(Err(()));
                    break;
                }
                Err(_) => {
                    let _ = sender.send(Err(()));
                    break;
                }
            }
        });

        loop {
            self.pump(&mut writer)?;
            match receiver.recv_timeout(Duration::from_millis(20)) {
                Ok(Ok(frame)) => match frame.kind {
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
                            Action::Reply(response) => {
                                frame::write_control(&mut writer, &response)?
                            }
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
                },
                Ok(Err(())) => return Ok(()),
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => return Ok(()),
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
        assert_eq!(plan["result"]["needed"], 1);

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

    fn read_data_frames(output: &[u8]) -> HashMap<u32, Vec<u8>> {
        let mut streams: HashMap<u32, Vec<u8>> = HashMap::new();
        let mut cursor = std::io::Cursor::new(output.to_vec());
        while let Ok(Some(frame)) = frame::read_frame(&mut cursor) {
            if frame.kind != frame::DATA || frame.payload.len() < 12 {
                continue;
            }
            let id = u32::from_be_bytes([
                frame.payload[0],
                frame.payload[1],
                frame.payload[2],
                frame.payload[3],
            ]);
            streams
                .entry(id)
                .or_default()
                .extend_from_slice(&frame.payload[12..]);
        }
        streams
    }

    #[test]
    fn exec_streams_output_and_reports_exit() {
        let base = std::env::temp_dir().join(format!("fleet-agent-exec-{}", std::process::id()));
        let root = base.join("replica");
        let state = base.join("state");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&state).unwrap();
        std::env::set_var("FLEET_AGENT_STATE_DIR", &state);
        let mut session = Session::new().unwrap();
        init(&mut session);
        reply(&mut session, &json!({"jsonrpc":"2.0","id":"1","method":"workspace.open","params":{"workspaceId":"exec-demo","root":root.to_string_lossy(),"adopt":true}}).to_string());
        reply(&mut session, &json!({"jsonrpc":"2.0","id":"2","method":"workspace.lease","params":{"workspaceId":"exec-demo","operationId":"op","ttlMs":60000}}).to_string());
        let start = reply(
            &mut session,
            &json!({"jsonrpc":"2.0","id":"3","method":"exec.start","params":{
            "workspaceId":"exec-demo","leaseId":"op","expectedGeneration":0,
            "argv":["sh","-c","printf hello; printf err >&2; exit 3"]}})
            .to_string(),
        );
        let job = start["result"]["jobId"].as_str().unwrap().to_string();
        let stdout = start["result"]["stdoutStream"].as_u64().unwrap() as u32;
        let stderr = start["result"]["stderrStream"].as_u64().unwrap() as u32;
        reply(&mut session, &json!({"jsonrpc":"2.0","id":"4","method":"stream.credit","params":{"streamId":stdout,"bytes":1048576}}).to_string());
        reply(&mut session, &json!({"jsonrpc":"2.0","id":"5","method":"stream.credit","params":{"streamId":stderr,"bytes":1048576}}).to_string());
        let mut output = Vec::new();
        for _ in 0..200 {
            session.pump(&mut output).unwrap();
            if session.out_streams.is_empty() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let streams = read_data_frames(&output);
        assert_eq!(
            String::from_utf8_lossy(streams.get(&stdout).unwrap()),
            "hello"
        );
        assert_eq!(
            String::from_utf8_lossy(streams.get(&stderr).unwrap()),
            "err"
        );
        let status = reply(
            &mut session,
            &json!({"jsonrpc":"2.0","id":"6","method":"exec.status","params":{"jobId":job}})
                .to_string(),
        );
        assert_eq!(status["result"]["state"], "failed");
        assert_eq!(status["result"]["exitCode"], 3);
    }

    #[test]
    fn artifact_streams_a_file_with_digest() {
        let base =
            std::env::temp_dir().join(format!("fleet-agent-artifact-{}", std::process::id()));
        let root = base.join("replica");
        let state = base.join("state");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&state).unwrap();
        std::env::set_var("FLEET_AGENT_STATE_DIR", &state);
        fs::write(root.join("out.bin"), b"artifact").unwrap();
        let mut session = Session::new().unwrap();
        init(&mut session);
        reply(&mut session, &json!({"jsonrpc":"2.0","id":"1","method":"workspace.open","params":{"workspaceId":"artifact-demo","root":root.to_string_lossy(),"adopt":true}}).to_string());
        let open = reply(&mut session, &json!({"jsonrpc":"2.0","id":"2","method":"artifact.open","params":{"workspaceId":"artifact-demo","path":"out.bin"}}).to_string());
        let stream = open["result"]["streamId"].as_u64().unwrap() as u32;
        assert_eq!(open["result"]["size"], 8);
        reply(&mut session, &json!({"jsonrpc":"2.0","id":"3","method":"stream.credit","params":{"streamId":stream,"bytes":4096}}).to_string());
        let mut output = Vec::new();
        for _ in 0..50 {
            session.pump(&mut output).unwrap();
            if session.out_streams.is_empty() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        let streams = read_data_frames(&output);
        assert_eq!(
            String::from_utf8_lossy(streams.get(&stream).unwrap()),
            "artifact"
        );
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
