//! Session: handshake, dispatch, and the stdio run loop.
//!
//! v1 starts with the framing and handshake; workspace, sync, exec and artifact handlers land as
//! their own modules and are advertised only once they exist. Advertising a capability that returns
//! `UNSUPPORTED_CAPABILITY` would be the exact lie the design forbids.

use std::io::{self, BufReader, Read, Write};

use serde_json::{json, Value};

use crate::frame;
use crate::identity;
use crate::rpc::{self, Request};

pub const PROTOCOL_MAJOR: u64 = 1;
pub const PROTOCOL_MINOR: u64 = 0;
pub const AGENT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Default)]
pub struct Capabilities {
    pub workspace_sync: bool,
    pub exec: bool,
    pub artifact: bool,
}

impl Capabilities {
    pub fn to_json(&self) -> Value {
        let mut map = serde_json::Map::new();
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

pub struct Session {
    initialized: bool,
    installation: String,
    capabilities: Capabilities,
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
            other => {
                if !self.initialized {
                    return Action::Reply(rpc::error(
                        &request.id,
                        "NOT_INITIALIZED",
                        "session.initialize must be the first message",
                        false,
                    ));
                }
                Action::Reply(rpc::error(
                    &request.id,
                    "INVALID_REQUEST",
                    &format!("unknown method {other}"),
                    false,
                ))
            }
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
                "defaultLeaseMs": 300_000,
            }
        });
        Action::Reply(rpc::response(&request.id, result))
    }

    fn doctor(&mut self, request: &Request) -> Action {
        if !self.initialized {
            return Action::Reply(rpc::error(
                &request.id,
                "NOT_INITIALIZED",
                "session.initialize must be the first message",
                false,
            ));
        }
        let state = identity::state_root();
        let result = json!({
            "protocol": { "major": PROTOCOL_MAJOR, "minor": PROTOCOL_MINOR },
            "agent": { "version": AGENT_VERSION, "installationId": self.installation },
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "stateDir": state.display().to_string(),
            "capabilities": self.capabilities.to_json(),
        });
        Action::Reply(rpc::response(&request.id, result))
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
                    let text = match std::str::from_utf8(&frame.payload) {
                        Ok(text) => text,
                        Err(_) => {
                            let response = rpc::error(
                                &Value::Null,
                                "INVALID_FRAME",
                                "control frame is not UTF-8",
                                false,
                            );
                            frame::write_control(&mut writer, &response)?;
                            return Ok(());
                        }
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
                    let response = rpc::error(
                        &Value::Null,
                        "INVALID_FRAME",
                        "data frame without an open stream",
                        false,
                    );
                    frame::write_control(&mut writer, &response)?;
                    return Ok(());
                }
                _ => unreachable!("frame kind validated by read_frame"),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn call(session: &mut Session, text: &str) -> Value {
        match session.handle(text) {
            Action::Reply(response) | Action::Close(Some(response)) => {
                serde_json::from_str(&response).unwrap()
            }
            _ => panic!("expected a reply"),
        }
    }

    #[test]
    fn handshake_returns_identity_and_limits() {
        let mut session = Session::new().unwrap();
        let response = call(
            &mut session,
            r#"{"jsonrpc":"2.0","id":"1","method":"session.initialize","params":{"protocol":{"major":1,"minor":0}}}"#,
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
        let response = call(
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
    fn unknown_method_after_handshake_is_invalid_request() {
        let mut session = Session::new().unwrap();
        call(
            &mut session,
            r#"{"jsonrpc":"2.0","id":"1","method":"session.initialize","params":{"protocol":{"major":1}}}"#,
        );
        let response = call(
            &mut session,
            r#"{"jsonrpc":"2.0","id":"2","method":"wat","params":{}}"#,
        );
        assert_eq!(response["error"]["code"], "INVALID_REQUEST");
    }

    #[test]
    fn shutdown_closes_session() {
        let mut session = Session::new().unwrap();
        let request = r#"{"jsonrpc":"2.0","id":"9","method":"session.shutdown"}"#;
        match session.handle(request) {
            Action::Close(Some(_)) => {}
            _ => panic!("expected close"),
        }
    }

    #[test]
    fn run_loop_answers_over_a_byte_stream() {
        let mut input = Vec::new();
        let mut request = Vec::new();
        frame::write_control(&mut request, r#"{"jsonrpc":"2.0","id":"1","method":"session.initialize","params":{"protocol":{"major":1}}}"#).unwrap();
        frame::write_control(
            &mut request,
            r#"{"jsonrpc":"2.0","id":"2","method":"session.shutdown"}"#,
        )
        .unwrap();
        input.extend_from_slice(&request);
        let mut output = Vec::new();
        let mut session = Session::new().unwrap();
        session.run(Cursor::new(input), &mut output).unwrap();
        let mut reader = Cursor::new(output);
        let first = frame::read_frame(&mut reader).unwrap().unwrap();
        let value: Value = serde_json::from_slice(&first.payload).unwrap();
        assert_eq!(value["id"], "1");
        let second = frame::read_frame(&mut reader).unwrap().unwrap();
        let value: Value = serde_json::from_slice(&second.payload).unwrap();
        assert_eq!(value["id"], "2");
    }
}
