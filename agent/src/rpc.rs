//! JSON-RPC envelope helpers. Nothing here owns state; the session does.

use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
pub struct Request {
    pub method: String,
    #[serde(default)]
    pub id: Value,
    #[serde(default)]
    pub params: Value,
}

impl Request {
    pub fn parse(text: &str) -> Result<Request, serde_json::Error> {
        serde_json::from_str(text)
    }
}

pub fn response(id: &Value, result: Value) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string()
}

pub fn notification(method: &str, params: Value) -> String {
    json!({ "jsonrpc": "2.0", "method": method, "params": params }).to_string()
}

pub fn error(id: &Value, code: &str, message: &str, retryable: bool) -> String {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message, "retryable": retryable }
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_string_and_number_ids() {
        let request = Request::parse(r#"{"jsonrpc":"2.0","id":"a","method":"x"}"#).unwrap();
        assert_eq!(request.id, json!("a"));
        let request = Request::parse(r#"{"jsonrpc":"2.0","id":7,"method":"x"}"#).unwrap();
        assert_eq!(request.id, json!(7));
    }

    #[test]
    fn missing_id_becomes_null() {
        let request = Request::parse(r#"{"jsonrpc":"2.0","method":"session.shutdown"}"#).unwrap();
        assert!(request.id.is_null());
    }

    #[test]
    fn error_has_a_code_and_retryable_flag() {
        let text = error(&json!("1"), "WORKSPACE_BUSY", "held", true);
        let value: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value["error"]["code"], "WORKSPACE_BUSY");
        assert_eq!(value["error"]["retryable"], true);
    }
}
