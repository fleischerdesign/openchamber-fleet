# Test coverage

The ledger for [`edge-cases.md`](edge-cases.md). Rust tests run with `cargo test`; the controller
tests run with `npm test` and need `FLEET_AGENT_BIN` pointing at the built agent.

## Covered

| Area | IDs | Test |
|---|---|---|
| Framing, limits | PROTO-01, PROTO-06 | `agent/src/frame.rs` tests |
| Handshake, version, pre-init | PROTO-03, PROTO-04 | `agent/src/session.rs` tests |
| JSON-RPC envelopes | — | `agent/src/rpc.rs` tests |
| Manifest digest, path validation | SYNC-05 | `agent/src/model.rs` tests |
| Exclude/preserve matcher | SYNC-04 | `agent/src/model.rs` tests |
| Plan, commit, idempotence | SYNC-01, SYNC-02 | `agent/src/sync.rs` tests |
| Preserve on delete | SYNC-03 | `agent/src/sync.rs` tests |
| Generation precondition | WS-04 | `agent/src/sync.rs` tests |
| Exec output, exit code | EXEC-01, EXEC-02 | `agent/src/exec.rs`, `session.rs` tests |
| Timeout, cancel | EXEC-03, EXEC-04 | `agent/src/exec.rs` tests |
| Credit-controlled streams | EXEC-06 | `session.rs` pump tests |
| Artifact stream and digest | ART-01, ART-02 | `session.rs`, `test/v1/protocol.test.js` |
| Controller end-to-end | CTL-02, CTL-04 | `test/v1/protocol.test.js` |
| Config validation | — | `test/unit/config.test.js` |
| Path validation | — | `test/unit/paths.test.js` |
| Plugin surface | — | `test/unit/plugin.test.js` |

## Planned (the failure suite)

| IDs | Why not yet |
|---|---|
| WS-02, WS-03, WS-05, WS-06 | Need two processes for the lease and a spawn-kill harness for the journal |
| SYNC-06…SYNC-10 | Blob corruption, plan mismatch, crash during apply, two controllers, symlink apply |
| EXEC-05, EXEC-07, EXEC-08 | Environment isolation test, disconnect cancel, crash-unknown |
| ART-03, CTL-01, CTL-03 | Artifact refusals, digest parity fixture, SSH argv unit test |
| FAIL-01…FAIL-05 | Disconnect matrix, disk full, output flood, 200k benchmark, traversal attacks |

## Rule

A new claim arrives with its test in the same commit. A planned row is a defect with a name, not a
promise in prose.
