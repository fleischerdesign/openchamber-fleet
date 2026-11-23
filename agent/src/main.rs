//! fleet-agent: the node side of `fleet.agent.v1`.
//!
//! It is a process, not a service: the controller spawns it over SSH stdio and it exits when the
//! connection closes. No listener, no credentials of its own.

mod frame;
mod identity;
mod rpc;
mod session;

use std::process::ExitCode;

fn usage() -> ExitCode {
    eprintln!("usage: fleet-agent [stdio|doctor|--version]");
    ExitCode::from(2)
}

fn main() -> ExitCode {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    match arguments.as_slice() {
        [] => run(),
        [command] if command == "stdio" => run(),
        [command] if command == "--version" => {
            println!("fleet-agent {}", session::AGENT_VERSION);
            ExitCode::SUCCESS
        }
        [command] if command == "doctor" => doctor(),
        _ => usage(),
    }
}

fn doctor() -> ExitCode {
    let mut session = match session::Session::new() {
        Ok(session) => session,
        Err(error) => {
            eprintln!("fleet-agent: {error}");
            return ExitCode::from(1);
        }
    };
    let initialize = serde_json::json!({
        "jsonrpc": "2.0",
        "id": "init",
        "method": "session.initialize",
        "params": { "protocol": { "major": 1, "minor": 0 } }
    });
    if let session::Action::Reply(reply) = session.handle(&initialize.to_string()) {
        let value: serde_json::Value = serde_json::from_str(&reply).unwrap_or_default();
        if value.get("error").is_some() {
            eprintln!("{reply}");
            return ExitCode::from(1);
        }
    }
    let request = serde_json::json!({
        "jsonrpc": "2.0", "id": "doctor", "method": "doctor", "params": {}
    });
    match session.handle(&request.to_string()) {
        session::Action::Reply(reply) => {
            println!("{reply}");
            ExitCode::SUCCESS
        }
        _ => ExitCode::from(1),
    }
}

fn run() -> ExitCode {
    match session::run_stdio() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("fleet-agent: {error}");
            ExitCode::from(1)
        }
    }
}
