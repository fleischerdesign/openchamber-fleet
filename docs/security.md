# Security

## Trust boundary

```
 controller (session host)                node (remote machine)
 ┌───────────────────────────┐  SSH      ┌──────────────────────────┐
 │ fleet.json, canonical tree│ ────────▶ │ replica, executed commands│
 │ secrets, session context  │ ◀──────── │ artifacts                 │
 └───────────────────────────┘           └──────────────────────────┘
```

The node is **semi-trusted**. It receives a copy of the workspace and every command you choose to
run there. Anything in the workspace — source code, test fixtures, `.env` files that are part of the
tree — is visible to anyone with read access on the node. Treat the node's filesystem as you would
the node's console.

The node cannot initiate a connection back. There is no inbound port, no daemon, no callback.

## Authentication

- SSH public-key authentication only. `BatchMode=yes` disables password and keyboard-interactive
  prompts, so an unattended run can never block on one.
- Host keys are verified (`StrictHostKeyChecking=yes`). An unknown or changed key is a hard failure
  (`host-key-mismatch`); there is no option to bypass it, and `FLEET_SSH` is documented as a test
  seam, not a production setting.
- `ConnectTimeout` is bounded so an unreachable node fails quickly instead of hanging a session.

## Command construction

- Host aliases are validated against `^[A-Za-z0-9._-]+$` and are passed as arguments, never
  interpolated into a shell string.
- The remote script is base64-encoded and piped into `bash -s`, so the node's login shell is not
  involved and cannot reinterpret content.
- Paths are validated as relative, `..`-free and NUL-free before they cross the boundary.
- `rsync` is invoked with an explicit argv array (`spawn`, not `shell: true`) and with
  `--protect-args`, so filenames cannot become options or shell words.
- `--safe-links` is used for artifact fetches, so a symlink cannot pull data from outside the
  replica.

## Environment

The child environment is constructed from scratch (`env -i`) with a fixed base:

```
HOME=<remote user home>  PATH=<fixed>  LANG=C.UTF-8  TZ=UTC  UMASK=0022
```

plus the `env` map declared in `fleet.json`. Nothing else. In particular, `OPENCODE_*`,
`AWS_*`, `GITHUB_*` and any variable of the controller process are invisible to the command. A
secret that a command needs must be declared explicitly, and that declaration is then part of the
repository's configuration and reviewable.

## Files and permissions

- The state directory is created `0700`; lease, run and log files are `0600`.
- The replica root defaults to `~/.cache/openchamber-fleet/<workspace>` on the node, created `0700`
  by the first sync.
- Artifacts land with their original mode (subject to the node's umask at creation; archive mode
  restores it).
- Logs may contain command output. They live in the state directory and are never uploaded.

## Audit

Every mutating run appends one record to `runs/<runId>.json`:

```json
{"runId":"…","kind":"sync|exec|fetch","host":"workstation","workspace":"my-project",
 "revision":"sha256:…","planDigest":"sha256:…","command":"…","startedAt":"…","endedAt":"…",
 "exitCode":0,"outputBytes":1234,"user":"philipp","controller":"hostname"}
```

`fleet status --json` exposes the same records. `fleet logs <runId>` prints the captured output.

## What is explicitly not protected

- A malicious node can lie about what it executed and what it produced. Verification (`--verify`,
  content checksums) detects accidental corruption, not an adversary.
- The canonical tree is not encrypted in transit beyond SSH's transport encryption.
- Commands run with the remote user's full privileges. Use a dedicated user if that matters.

## Reporting

This repository has no runtime service, no network listener and no credential store of its own. A
vulnerability is a way to make it execute something the caller did not ask for, read a file outside
the replica, or leak the controller's environment. Report privately to the maintainer; do not open a
public issue with a working exploit.
