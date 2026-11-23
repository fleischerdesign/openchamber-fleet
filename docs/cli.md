# CLI

Every command that touches a node prints what it is about to do before doing it, and every failure
names a defect rather than an HTTP status.

## Commands

```
fleet init --host <alias> --ssh <user@host> [--port N] [--root PATH] [--preset node,rust] [--force]
fleet status [--json] [--check]
fleet sync --host <alias> (--plan | --apply | --verify) [--content] [--exclude pat,pat] [--allow-delete]
fleet exec --host <alias> [--timeout SECONDS] [--allow-stale] [--json] -- <command…>
fleet exec --host <alias> --shell '<command string>' [--timeout SECONDS]
fleet fetch --host <alias> --dest <dir> [--overwrite] [--verify] -- <path…>
fleet cancel --host <alias> [--run <runId>]
fleet logs <runId>
fleet doctor [--host <alias>]
```

`--host` names a key under `hosts` in `fleet.json`.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | the remote command failed (its own exit code is preserved when it fits 1–125) |
| 2 | usage error |
| 3 | configuration error |
| 4 | node unreachable / SSH failure |
| 5 | lease busy |
| 6 | replica stale or diverged |
| 7 | artifact missing |
| 8 | doctor found a missing or too-old dependency |
| 97 | replica root missing (exec wrapper) |
| 124 | timeout |

## Sync

```
$ fleet sync --host workstation --plan
plan 4 changes (sha256:9f2c…)
  add     src/main.rs
  update  Cargo.lock
  delete  src/old.rs
  add     tests/fixture.bin

$ fleet sync --host workstation --apply
applied 4 changes in 0.412s (sha256:9f2c…)
verified: replica matches revision sha256:41ab…
```

`--plan` never writes. `--apply` writes and then verifies. A verify that finds changes fails with
`sync-not-converged` and does **not** mark the replica current.

`--exclude` adds patterns to the configured excludes for this call; the effective set is recorded with
the replica. A plan without `--exclude` describes the replica as it was last synced.

`--content` makes both plan and verify compare file contents (`rsync --checksum`), which is slower
and the only way to catch a same-size, same-mtime change.

## Exec

```
$ fleet exec --host workstation -- cargo test --all-features
   Compiling …
test result: ok. 42 passed
exit 0 in 38.2s
```

- `--` separates the command; argument boundaries are preserved.
- `--shell` takes one string and runs it through bash; use it for pipes and redirections.
- `--timeout` defaults to the `FLEET_TIMEOUT` environment variable, else 900 seconds.
- stdout and stderr are streamed; the CLI does not truncate.

## Fetch

```
$ fleet fetch --host workstation --dest ./out -- target/release/app target/test-report.xml
fetched 2 paths (4.1 MB)
```

Paths are relative to the replica root. `--verify` compares SHA-256 after transfer.

## Status

```
$ fleet status
workspace: my-project
host          replica                     revision    state     lease
workstation   ~/.cache/…/my-project     sha256:41ab current   —
notebook      ~/.cache/…/my-project     sha256:9f2c stale     run 7f3a (12s)
```

`--check` re-verifies each replica (one rsync dry run per host) instead of trusting the state file.

## Errors

Every failure prints `code: message` and, when it helps, the command that produced it:

```
node-unreachable: ssh to philipp@10.10.100.20:22 failed (ConnectTimeout 10s)
host-key-mismatch: host key for 10.10.100.20 differs from known_hosts; nothing was executed
lease-busy: workstation/my-project is held by run 7f3a since 12s
```

## Environment

| Variable | Effect |
|---|---|
| `FLEET_STATE_DIR` | override the state directory |
| `FLEET_TIMEOUT` | default exec timeout in seconds |
| `FLEET_SSH` | transport override for tests; never set in production |
