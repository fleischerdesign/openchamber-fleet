# CLI

```
fleet init --host <alias> --ssh <user@host> [--port N] [--root PATH] [--name NAME] [--force]
fleet doctor [--host <alias>] [--agent-path PATH]
fleet status --host <alias> [--json]
fleet recover --host <alias> [--abort] [--json]
fleet sync --host <alias> (--plan | --apply) [--exclude pat,pat] [--adopt]
fleet exec --host <alias> [--cwd PATH] [--env K=V,...] [--timeout SEC] [--json] -- <command…>
fleet fetch --host <alias> --dest <dir> [--overwrite] -- <path>
```

Every command opens one SSH session, performs one operation and closes it. `FLEET_AGENT_PATH`
overrides the agent binary name.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | the remote command failed (its own exit code is preserved when it fits 1–125) |
| 2 | usage error |
| 3 | configuration error |
| 4 | transport or protocol error (SSH, handshake, host key, capability) |
| 5 | lease busy or recovery required |
| 6 | replica state: generation mismatch, plan mismatch, blob, recovery, internal agent error |

## Sync

```
$ fleet sync --host workstation --plan
plan 4 change(s) sha256:9f2c…
  add     src/main.rs
  update  Cargo.lock
  delete  src/old.rs

$ fleet sync --host workstation --apply --exclude target/
generation 7 sha256:41ab…
```

`--plan` never mutates: it runs the transaction and aborts it. `--apply` commits and prints the new
generation. `--adopt` takes over an existing unmanaged directory; without it the agent refuses.

## Exec

```
$ fleet exec --host workstation -- cargo test --all-features
   Compiling …
test result: ok. 42 passed
exit 0
```

- `--` separates the command; argv boundaries are preserved.
- `--timeout` defaults to the job's own timeout at the agent (none if omitted; the controller waits).
- stdout and stderr are streamed and printed; `--json` adds the job record.

## Fetch

```
$ fleet fetch --host workstation --dest ./out -- target/release/app
fetched ./out/app (4.1 MB) sha256:…
```

The digest is verified against the agent's report before the file is written.

## Status

```
$ fleet status --host workstation
my-project: generation 7 sha256:41ab…
```

`RECOVERY` appears when an interrupted transaction needs resolution. `fleet recover --host <alias>`
inspects the journal and completes an interrupted apply. `--abort` is only valid before apply has
started; the agent refuses it once an apply needs forward recovery.
