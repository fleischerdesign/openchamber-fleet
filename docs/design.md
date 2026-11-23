# Design

This document is the contract. Code that contradicts it is a bug in the code.

## 1. Problem

An agent session executes its tools where its runtime lives. That is the right default: files are
local, edits are fast, nothing has to be copied. It stops being right when a single command needs
more CPU or memory than the session host has, or when it would starve the services that host
carries.

Moving the session is not an option (session continuity), and starting a second runtime on the fast
machine is not an option either (fragmented state). What remains is to move **the work**: replicate
the workspace, run one command there, bring back what the command produced.

## 2. Model

Remote execution with input replication — *stage-in → execute → stage-out*:

```
canonical workspace            replica                 result
  (session host)   ──sync──▶  (remote node)  ──exec──▶  artifacts
```

- The **canonical** workspace is the directory that contains `fleet.json`. It is the only writer.
- A **replica** is a directory on a node. It is derived state: never edited by hand, never edited
  by the node's users, never merged back.
- An **artifact** is a path the caller names explicitly after the command succeeded.

The prior art this follows: Bazel remote execution (input tree + action + output tree), Goma and
distcc (compile offload), Mutagen and Unison (workspace replication), self-hosted CI runners
(job runs where the runner is).

## 3. Invariants

| # | Invariant | Enforced by |
|---|---|---|
| I1 | One writer: canonical → replica only | no reverse code path exists |
| I2 | A command never runs on a replica that is not current | `exec` verifies before spawning |
| I3 | Excluded paths are never transferred or deleted | `--exclude` on every rsync call, never `--delete-excluded` |
| I4 | An unreachable node is a failure, not a fallback | exec returns an error; no local path exists |
| I5 | An interrupted transfer never marks a replica current | state is written only after a clean verify |
| I6 | Commands do not inherit the caller's environment | `env -i` with an explicit allow-list |
| I7 | Paths crossing the boundary are relative and contained | validation before any transfer |
| I8 | Every mutating operation holds a lease | lock file with TTL and owner |

## 4. Components

```
src/config.ts     fleet.json parsing and validation (strict: unknown keys fail)
src/manifest.ts   canonical tree walk, exclusion matcher, revision digest
src/plan.ts       rsync argv construction, itemized-output parsing, plan digest
src/sync.ts       plan / apply / verify, state recording
src/exec.ts       remote wrapper, environment, timeout, cancellation
src/fetch.ts      artifact validation and transfer
src/state.ts      state directory, atomic writes, leases
src/status.ts     composed view for humans and the plugin
src/paths.ts      relative-path validation and containment
src/ssh.ts        ssh argv, host-key policy, transport override for tests
src/errors.ts     one error type, stable codes
```

No module imports anything outside Node's standard library. The plugin wraps `src/`; the CLI wraps
`src/`; both are thin.

## 5. Data model

### 5.1 Revision

`revision` is a SHA-256 over the canonical manifest: for every non-excluded entry, in byte order of
the path:

```
<type>\0<path>\0<mode>\0<size>\0<mtimeMs>\0<linkTarget>\n
```

`type` ∈ `file|dir|symlink`. It is a **metadata** digest: cheap enough for a large tree, and exactly
what rsync's quick check uses. Content equality is a separate, explicit operation
(`sync --verify --content`, which passes `--checksum` to rsync).

This distinction is stated in the CLI output and in `status`: a revision says "same names, sizes,
modes and times", never "same bytes".

### 5.2 Plan

A plan is the itemized difference between canonical and replica, as reported by
`rsync --dry-run --itemize-changes`. Each entry is `{ action, path }` with

`action ∈ add | update | delete | type-change | metadata`.

`planDigest` is a SHA-256 over the normalized entry list. A plan is empty iff the replica matches
the canonical tree under rsync's quick check.

### 5.3 State

`~/.local/state/openchamber-fleet/` (override: `FLEET_STATE_DIR`):

```
state.json                     host/workspace → last revision, last apply, last verify
leases/<host>--<workspace>.lock
runs/<runId>.json              command, host, exit code, timings, log path
runs/<runId>.log               captured output (spill file when capped)
```

State is a **hint** for `status`, never a permission to skip verification. `exec` always verifies.

## 6. State machine

```
        sync --apply                exec (verify ok)
unknown ───────────▶ current ──────────────────────▶ running
   ▲                    │                                │
   │                    │ canonical changed               │ exit
   │                    ▼                                ▼
   └──── verify fails ─ stale ◀── replica changed ── drifted
```

- `unknown`: no state entry, or the replica directory does not exist.
- `current`: the last verify was empty at the recorded revision.
- `stale`: the canonical revision changed since the last apply.
- `drifted`: a verify found changes that the canonical side did not cause (someone edited the
  replica).
- `running`: a lease is held by a live process.

`exec` proceeds only from `current` after a fresh in-band verify. `--allow-stale` exists for
deliberate debugging; it is never the default.

## 7. Sync semantics

1. Compute the canonical revision (manifest).
2. Build the rsync argv: archive mode, `--delete`, the declared excludes, `--itemize-changes`,
   `--protect-args`, an explicit ssh transport with pinned host keys.
3. `--plan` returns the entries and their digest without touching the node.
4. `--apply` performs the transfer, then runs the same dry-run again. A non-empty result is
   `sync-not-converged`: the node changed under us, and the replica is *not* marked current.
5. When any canonical file was modified within the last five seconds, transfer and verify use
   `--checksum`. rsync compares whole seconds, so a same-size edit inside that window would
   otherwise be skipped; the racy guard costs a full hash only while a tree is being edited.
5. Record `{revision, planDigest, appliedAt}` only after the empty verify.

Deletion is scoped to the replica root by rsync itself. `--delete-excluded` is never passed: a cache
directory must survive a sync even when the canonical tree has no such directory.

## 8. Exec semantics

The remote command is transported as a base64-encoded bash script, so the node's login shell
(fish, zsh) cannot reinterpret it:

```bash
set -u
cd "$ROOT" || exit 97
SHELL_BIN=$(command -v bash) || exit 98
echo $$ > "$PIDFILE"
exec env -i HOME="$HOME" PATH="$PATH_FIXED" LANG=C.UTF-8 TZ=UTC \
     <declared env> "$SHELL_BIN" -c '<command>'
```

- The environment is constructed, not inherited (I6).
- `argv` input is shell-quoted element by element; a raw `--shell` string is passed through
  unchanged except for single-quote escaping.
- A timeout kills the local ssh process, then a second ssh sends `SIGTERM` to the recorded pid,
  waits, then `SIGKILL`. A command that daemonizes itself escapes this; daemons are out of scope
  (use a service manager, not `fleet exec`).
- Exit codes are propagated unchanged. `97` means "replica root missing", `98` means "configured
  shell not found"; both are reserved and never produced by a user command by accident.
- `PATH` is fixed to `/run/current-system/sw/bin:/usr/local/bin:/usr/bin:/bin` and can be
  overridden through `env.PATH`. The shell is resolved by absolute path before the environment is
  cleared, so a NixOS node and a generic Linux node behave the same.
- Output is streamed. The plugin caps what it returns to the model (default 256 KiB) and points at
  the spill file; the CLI never caps.

## 9. Fetch semantics

- Paths must be relative, non-empty, free of `..` and NUL, and must not resolve outside the replica
  through a symlink (`rsync --safe-links` plus a prefix check on the caller side).
- Only named paths are transferred. There is no "fetch everything".
- A destination collision is an error unless `--overwrite` is passed.

## 10. Concurrency

One lease per `(host, workspace)` covers `sync` and `exec`. `fetch` and `status` are read-only and
take no lease. A lease is a file created with `O_EXCL` containing `{runId, pid, startedAt,
expiresAt}`; an expired lease whose pid is gone is reclaimed, an expired lease with a live pid is
not.

Two agents on the same node therefore serialise; the second waits (`--wait`, bounded) or fails
fast (`lease-busy`).

## 11. Failure semantics

| Situation | Behaviour |
|---|---|
| Node unreachable | `node-unreachable`, nothing is written |
| SSH host key mismatch | `host-key-mismatch`, nothing is written |
| rsync exits non-zero | `sync-failed`, replica not marked current |
| Verify finds changes | `sync-not-converged`, replica not marked current |
| Timeout | local ssh killed, remote pid signalled, exit `124` |
| Process interrupted (SIGINT) | lease released, run recorded as `interrupted`, replica state untouched |
| Unknown outcome after a crash | next command verifies before running; `status` shows the recorded run |

The last row is the important one: after an unknown outcome, inspect state; never replay blindly.

## 12. Non-goals

- No daemon or agent on the node (SSH + rsync only).
- No bidirectional or multi-writer sync.
- No merge or conflict resolution.
- No job scheduler, queue, or cluster membership.
- No network filesystem.
- No Windows-native support; WSL is untested and unsupported.
