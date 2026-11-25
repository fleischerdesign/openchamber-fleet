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
| Two controllers, lease release on death | WS-03 | `test/v1/failure.test.js` |
| Recovery after a dead controller | FAIL-01 | `test/v1/failure.test.js` |
| Crash during apply, forward recovery | SYNC-08 | `test/v1/failure.test.js` |
| Disk full during apply, forward recovery | FAIL-02 | `test/v1/failure.test.js` |
| Plan digest and blob corruption refusals | SYNC-06, SYNC-07 | `test/v1/failure.test.js` |
| Spool backpressure | EXEC-06 | `agent/src/exec.rs` buffer test |
| Generation precondition | WS-04 | `agent/src/sync.rs` tests |
| Exec output, exit code | EXEC-01, EXEC-02 | `agent/src/exec.rs`, `session.rs` tests |
| Timeout, cancel | EXEC-03, EXEC-04 | `agent/src/exec.rs` tests |
| Disconnect cancels the process group | EXEC-07 | `test/v1/protocol.test.js`, `agent/src/exec.rs` |
| Credit-controlled streams | EXEC-06 | `session.rs` pump tests |
| Artifact stream and digest | ART-01, ART-02 | `session.rs`, `test/v1/protocol.test.js` |
| Controller end-to-end | CTL-02, CTL-04 | `test/v1/protocol.test.js` |
| Config validation | — | `test/unit/config.test.js` |
| Path validation | — | `test/unit/paths.test.js` |
| Plugin surface | — | `test/unit/plugin.test.js` |
| Default workspace for projectless chats | — | `test/unit/config.test.js`, `test/unit/cli.test.js`, `test/unit/service.test.js` |
| Detached job store, locks, retention | — | `test/unit/job-store.test.js` |
| Supervisor state machine, queue, recovery, shutdown | — | `test/unit/supervisor.test.js` |
| Plugin half, notifications, cancel, fallback | — | `test/unit/supervised.test.js` |
| Service launcher, restart after supervisor death | — | `test/unit/service-supervisor.test.js` |
| 200k benchmark | FAIL-04 | `bench/workspace.mjs`, see `docs/benchmarks.md` |
| Large artifact (5 MiB, multi-frame) | — | `test/v1/protocol.test.js` |
| Symlink apply, symlinked parent refused | SYNC-10 | `agent/src/sync.rs` symlink tests |

## Planned (the failure suite)

| IDs | Why not yet |
|---|---|
| WS-02, WS-05, WS-06 | Need a spawn-kill harness for the journal and a permission test |
| SYNC-09 | Two controllers mutating one workspace |
| EXEC-05, EXEC-08 | Environment isolation test, crash-unknown |
| ART-03, CTL-01, CTL-03 | Artifact refusals, digest parity fixture, SSH argv unit test |
| FAIL-04, FAIL-05 | Large-workspace gate, traversal attacks (partial: path validation) |

## Rule

A new claim arrives with its test in the same commit. A planned row is a defect with a name, not a
promise in prose.
