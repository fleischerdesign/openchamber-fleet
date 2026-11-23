# Test coverage

The catalogue in [`edge-cases.md`](edge-cases.md) is the statement; this file is the ledger. A row is
either covered by a named test, explicitly planned, or moved to the non-goals in `design.md` §12.

## Covered

| Area | IDs | Test |
|---|---|---|
| Path validation, quoting | SEC-04, SYNC-18, EXEC-03, EXEC-04 | `test/unit/paths.test.js` |
| Config strictness, defaults | CFG-01…CFG-08 | `test/unit/config.test.js` |
| Exclude semantics | SYNC-35…SYNC-38 | `test/unit/config.test.js` |
| Plan parsing, digest stability | SYNC-01…SYNC-05 (classification) | `test/unit/plan.test.js` |
| State, atomic writes, leases | STATE-01…STATE-06 | `test/unit/state.test.js` |
| Sync against real rsync | SYNC-01…SYNC-06, 08, 12, 15…18, 21, 26, 27, 30, 34 | `test/integration/sync.test.js` |
| Exec, environment, timeout, lease | EXEC-01, 02, 03, 06, 07, 08, 11, 12, 13, 18, 20, 23 | `test/integration/exec.test.js` |
| Transport and sync failures | SEC-01…SEC-03, SYNC-26, SYNC-27, STATE-07 | `test/integration/failures.test.js` |
| Fetch safety | FETCH-03…FETCH-06, 07, 09, SEC-04 | `test/integration/failures.test.js` |
| State permissions, audit record | SEC-07, SEC-08 | `test/integration/failures.test.js`, `exec.test.js` |
| Convergence, idempotence | property over random trees | `test/property/convergence.test.js` |

Every row above runs in CI on Node 20, 22 and 24.

## Planned, with the reason

| IDs | Why not yet |
|---|---|
| SYNC-07, 09, 10, 11, 14 | Symlink target forms beyond relative/absolute, hardlinks, FIFOs, setuid: rsync-archive semantics are inherited and would need a privileged node for setuid |
| SYNC-19, 20 | Unicode normalization and case-only renames need a case-insensitive filesystem; CI is ext4 |
| SYNC-22, 23, 24 | Depth > 100, 255-byte names, > 1 GiB: covered manually on the fleet node, too slow for the default gate |
| SYNC-25 | File modified during the walk: requires a deterministic race injector; the racy guard covers the common case |
| SYNC-28, 29 | Network drop and concurrent apply: the second is covered by leases; a real drop needs a proxy in the test |
| SYNC-31, 32 | Paths with spaces on the *controller* and trailing-slash roots: covered manually; a fixture needs a spaced temp root |
| EXEC-14, 15, 16, 17 | SIGKILL escalation, daemonising commands, TTY refusal, output cap: tested manually on `hom-wrk-01`; the cap needs a large-output fixture |
| EXEC-21, 22 | Umask and signal forwarding: partially covered (umask is set in the wrapper); forwarding needs a PTY harness |
| EXEC-24, 25 | Empty argv and missing shell: trivial to add, currently covered by code paths only |
| FETCH-02, 08, 10 | Directory fetch, mode preservation, empty list: the first two are exercised manually; empty list is a usage error in code |
| PORT-01…PORT-05 | rsync version gate, missing base64, macOS controller: need a second OS/version matrix |

## Manual verification on the fleet

Run on 2026-11-23 from `cld-ops-01` against `hom-wrk-01` (Linux 6.18, rsync 3.5):

- plan / apply / verify against a real node with `~/.cache` root;
- exec: cwd, `uname`, script execution, exit codes;
- stale guard after an edit (`replica-stale`, revision in the message);
- timeout: `sleep 20` with `--timeout 1` → exit 124 after ~1.8 s;
- artifact write, fetch with `--verify` (SHA-256 compared), `logs`;
- `status --check` reporting `current`;
- excluded `target/` preserved across syncs.

## Rule

A new edge case is added here in the same commit as the test that proves it. A row that cannot be
tested is moved to `design.md` §12 with a reason, not left as an unmarked claim.
