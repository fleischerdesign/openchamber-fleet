# CLI

```
fleet init --host <alias> --ssh <user@host> [--port N] [--root PATH] [--name NAME] [--tag a,b] [--force]
fleet init ... --workspace-file       # opt-in legacy fleet.json in the repository
fleet default [<project-dir>] [--clear] [--json]
fleet doctor [--host <alias>] [--agent-path PATH]
fleet hosts [--tag a,b] [--json]
fleet status --host <alias> [--json]
fleet recover --host <alias> [--abort] [--json]
fleet sync --host <alias> (--plan | --apply) [--exclude pat,pat] [--adopt]
fleet run [--host <alias|auto>] [--tag a,b] [--cwd PATH] [--env K=V,...] [--timeout SEC]
          [--sync auto|never|plan|apply] [--exclude pat,pat] [--adopt] [--scratch] [--json] -- <command…>
fleet exec --host <alias> [--cwd PATH] [--env K=V,...] [--timeout SEC] [--scratch] [--json] -- <command…>
fleet fetch --host <alias> --dest <dir> [--overwrite] [--scratch] -- <path>
fleet upload <local-path> --host <alias> --to <remote-path> [--overwrite]
fleet download <remote-path> --host <alias> --dest <local-path> [--scratch] [--overwrite]
```

Every command opens one SSH session, performs one operation and closes it. `FLEET_AGENT_PATH`
overrides the agent binary name. Every command accepts `--config-dir <dir>`; the default is
`$XDG_CONFIG_HOME/openchamber-fleet`.

`fleet init` writes the host registry and project configuration there, never into the repository.
The host registry is reusable by every project. A new project gets no `hosts` allowlist and
therefore follows the whole registry; add `requires` or an explicit `hosts` list to the project file
when it must be restricted. Selecting an alias that already exists keeps its SSH target; `--force`
replaces it. An existing legacy `fleet.json` is migrated with its name, hosts, roots, excludes,
environment and shell intact. Use `--workspace-file` only when a repository-local legacy file is
explicitly wanted; it is written at the workspace root even from a subdirectory.
`--tag` adds host capabilities such as `linux,gpu`; `fleet hosts` lists them and `fleet run` can
select a host by tags.

`fleet default <project-dir>` sets the project that Fleet uses when OpenChamber opens a chat without
a project. The value lives in `defaults.json`; it is not written into the repository and is not a
`fleet.json`. `fleet default` shows it, `fleet default --clear` removes it. `fleet_hosts` still lists
the global registry when no default is set.

## Run

`fleet run` is the normal agent path. It synchronizes the workspace first (default `--sync auto`),
then executes. `--sync plan` only plans and exits 6 without running a command when the replica would
change; `--sync never` is the low-level escape hatch when the caller knows the replica is current.
The OpenCode tool `fleet_run` has the same semantics and returns a structured result, including the
sync summary. `fleet exec` remains the raw no-sync variant.

`fleet run --host auto --tag linux -- cargo test` selects the first configured host carrying every
requested tag. The selection is an agent decision; there is no UI sync switch.

`--scratch` selects a private remote-only session space. It has no source and no sync; `run`,
`exec`, `fetch`, `status` and `hosts` accept it. Uploads always land in scratch. A download with
`--scratch` reads that space; without it, the project replica is used. Transfers handle one regular
file, verify a SHA-256 digest, stream without loading the file into memory and refuse to overwrite
unless `--overwrite` is given.

`fleet sync --plan`, `fleet status` and `fleet fetch` are read-only: they never create a replica
root or a state entry on the host.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | the remote command failed (its own exit code is preserved when it fits 1–125) |
| 2 | usage error |
| 3 | configuration error |
| 4 | transport or protocol error (SSH, handshake, host key, capability) |
| 5 | lease busy or recovery required |
| 6 | replica state: generation mismatch, plan mismatch, blob, recovery, internal agent error; also `fleet run --sync plan` when changes are pending |

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

`my-project` is the project name; the selected host is `workstation`.

`RECOVERY` appears when an interrupted transaction needs resolution. `fleet recover --host <alias>`
inspects the journal and completes an interrupted apply. `--abort` is only valid before apply has
started; the agent refuses it once an apply needs forward recovery.
