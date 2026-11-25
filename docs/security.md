# Security

## Trust boundary

```
controller (session host)                     node
┌──────────────────────────┐   SSH stdio    ┌──────────────────────────┐
│ canonical tree, secrets  │ ─────────────▶ │ replica, executed commands│
└──────────────────────────┘ ◀───────────── └──────────────────────────┘
```

The node is **semi-trusted**: it receives a copy of the workspace and every command you run there.
Anything in the tree — including `.env` files and fixtures — is readable by the SSH user on the
node. There is no inbound listener and no agent credential store; SSH is the only door.

**Arbitrary execution is the real capability.** The agent runs commands as the SSH user, so it can
already read that user's browser profiles, display session and devices. Capability grants added
later (screen, input, browser) are **audit and accident prevention**, not a sandbox. A real sandbox
would need a separate identity and a broker; v1 does not pretend to have one.

## Transport and handshake

- Public-key SSH only; `BatchMode=yes`; host keys verified with `StrictHostKeyChecking=yes`.
- No PTY; protocol bytes on stdout, logs on stderr.
- The remote command is a fixed argv: `ssh … host <agent-path> stdio`. The agent path is validated
  against a safe character set before it becomes part of the SSH command.
- The handshake reports protocol, agent version, installation id and capabilities; a required
  capability the agent lacks aborts the session. A capability is advertised only after its handler
  exists. Read-only planning negotiates `workspace.preview`; protocol 1.1 is required, so a 1.0
  agent is refused at the handshake instead of failing after a journal exists.

## Files and paths

- Every path is relative, `..`-free and NUL-free before it crosses the boundary.
- The agent resolves paths segment by segment with no-follow checks; a symlink parent is
  `PATH_UNSAFE`.
- Files are written to a temporary name in the destination directory, `fsync`ed and renamed; no
  partial file is visible under a final name.
- The root guard refuses `/`, system directories, the home directory and paths with fewer than two
  segments, because commit deletes managed paths. Roots are canonicalized before use; a registry
  lock serializes reservation, and one real root may be bound to only one workspace id, including
  no nested roots. The approved root and base manifest are checked under that lock before a state
  directory is created, so a changed approval cannot provision first.
- `workspace.open` and `sync.inspect` have read-only forms that never create a root, state directory
  or journal. Status, plan, recovery inspection and artifact download use them.

## Execution

- `argv` only; no shell mode, so no word splitting or metacharacter expansion from the controller.
- `env_clear` plus `HOME`, the node PATH (the agent process PATH, never the controller PATH), `LANG`,
  `TZ` and declared variables; the controller environment (tokens, proxies, `OPENCODE_*`) is not inherited.
- A new session and process-group termination; timeouts escalate `SIGTERM` → `SIGKILL`.
- Output is bounded by credits and an 8 MiB spool per stream.

## State and audit

- Workspace state is `0700`; files `0600`.
- The lease is a kernel `flock`: it disappears with the process, so a crash cannot leave a lock.
  `sync.commit`, `sync.abort` and `sync.recover` require the lease that owns the transaction; the
  journal records its lease id, and a release is refused while a transaction or job is still
  active. The agent generates the lease id; a client-supplied operation id cannot collide across
  workspaces. A journal without a live owner needs an explicit recovery lease. `ttlMs` is advisory:
  a lease lives with its connection, so a long accepted job cannot lose its fence halfway through.
  Metadata reads and the short journal/manifest publish sections share a registry lock, so a reader
  never sees a generation from one commit with a manifest from another.
- A read-only plan is an in-memory preview. It creates no journal, so a cancelled preview cannot
  leave `RECOVERY` behind.
- Job records and the transaction journal are written before the effect and updated after it.
  `unknown` is recorded, never rewritten to a guess.

## Detached jobs

- The OpenChamber extension service launches one local supervisor per user with the app runtime. It
  is a child process with a minimal environment: `HOME`, `PATH`, the temp directory, the SSH agent
  socket and Fleet's own paths. The service token and the host's other secrets are not passed.
- The supervisor and the plugin exchange atomic JSON files under
  `~/.local/state/openchamber-fleet`; there is no listener, port or new token. Directories are
  `0700`, files `0600`, and the supervisor log excludes argv and environment values.
- A start request contains the environment the agent approved for that one job. It is deleted as
  soon as the supervisor claims it; the durable job record keeps the argv and output tails, never the
  environment.
- The `fleet.run` / `fleet.exec` / `shell` approvals are evaluated before the request is written.
  The supervisor executes only that approved argv; it is not a second policy engine.
- A supervisor of another version is drained, not killed: it stops claiming new requests, finishes
  accepted work and exits; the successor starts afterwards. During drain it is alive but not
  advertised for new jobs, so the plugin falls back instead of spooling into a closed window. An older supervisor without drain
  support is reported as `restart required` instead of pretending a safe handover. A supervisor
  crash, an OpenChamber service stop or a machine reboot is reported as `interrupted`. The remote
  agent kills its process group when the SSH session closes, so the interruption does not leave an
  orphan. A detached job does not survive a machine reboot.

## What is not protected

- A malicious node can lie about what it ran and what it produced. SHA-256 proves byte identity,
  not honest computation.
- The canonical tree crosses the wire under SSH's transport encryption only; it is not encrypted at
  rest on the node.
- Commands run with the SSH user's full privileges. Use a dedicated user if that matters.
- Secrets inside the workspace are replicated. Exclude them or keep them out of the tree.
- OpenCode permissions are policy checks, not a sandbox. `fleet_exec` evaluates a host/cwd/env-key
  descriptor under `fleet.exec` and the exact argv under `shell`; execution-sensitive environment
  overrides must be declared in the project configuration. `fleet_upload` evaluates the canonical
  source under `read`, `external_directory` and `fleet.upload`; `fleet_download` evaluates the same
  canonical local target under `edit`, `external_directory` and `fleet.download`. `fleet_fetch`
  canonicalizes the final local path and evaluates it under `edit` and `external_directory`;
  `fleet_sync` apply, `fleet_recover` and `fleet.job.cancel` use dedicated actions. Planning never
  adopts a directory; `adopt` is CLI-only.
- `allow` is controller policy, not an agent sandbox. The agent's transfer handler writes below the
  workspace root it was given; "uploads only into scratch" follows from the controller choosing the
  scratch root, not from a second agent-side identity. A legacy project file cannot silently bind an
  existing registry alias to another SSH target; normal loading refuses the conflict.
- Transfer permissions bind the canonical path plus the opened source `dev/ino` (upload) or the
  destination parent `dev/ino` (download). A download refuses a missing destination parent and
  re-checks the parent immediately before writing. Node exposes no `openat`; a path component
  swapped between the final check and the syscall remains an OS-level TOCTOU window. This is path
  policy, not an inode sandbox; hardlinks remain readable aliases of the same inode.
- The detached supervisor runs with the user's full privileges, like the extension service and the
  OpenCode plugin. It is inside the same trust boundary, not a sandbox.
- Without the extension service (the npm-only plugin path), background jobs stay in the OpenCode
  plugin runtime and a restart interrupts them; the tool reports `supervised: false`.

## Reporting

No remote runtime service, no listener, no credential store. A vulnerability is a way to execute
something the caller did not ask for, read outside the workspace, escape the root guard or exhaust
the agent. Report privately to the maintainer.
