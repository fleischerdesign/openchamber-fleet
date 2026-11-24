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
  exists.

## Files and paths

- Every path is relative, `..`-free and NUL-free before it crosses the boundary.
- The agent resolves paths segment by segment with no-follow checks; a symlink parent is
  `PATH_UNSAFE`.
- Files are written to a temporary name in the destination directory, `fsync`ed and renamed; no
  partial file is visible under a final name.
- The root guard refuses `/`, system directories, the home directory and paths with fewer than two
  segments, because commit deletes managed paths.

## Execution

- `argv` only; no shell mode, so no word splitting or metacharacter expansion from the controller.
- `env_clear` plus `HOME`, the node PATH (the agent process PATH, never the controller PATH), `LANG`,
  `TZ` and declared variables; the controller environment (tokens, proxies, `OPENCODE_*`) is not inherited.
- A new session and process-group termination; timeouts escalate `SIGTERM` → `SIGKILL`.
- Output is bounded by credits and an 8 MiB spool per stream.

## State and audit

- Workspace state is `0700`; files `0600`.
- The lease is a kernel `flock`: it disappears with the process, so a crash cannot leave a lock.
- Job records and the transaction journal are written before the effect and updated after it.
  `unknown` is recorded, never rewritten to a guess.

## What is not protected

- A malicious node can lie about what it ran and what it produced. SHA-256 proves byte identity,
  not honest computation.
- The canonical tree crosses the wire under SSH's transport encryption only; it is not encrypted at
  rest on the node.
- Commands run with the SSH user's full privileges. Use a dedicated user if that matters.
- Secrets inside the workspace are replicated. Exclude them or keep them out of the tree.
- OpenCode permissions are policy checks, not a sandbox. `fleet_exec` evaluates the exact argv under
  `shell`; `fleet_fetch` evaluates the final local path under `edit` and `external_directory`;
  `fleet_sync` apply and `fleet_recover` use dedicated actions.
- Background jobs live in the OpenCode plugin runtime. A restart, plugin unload or location eviction
  interrupts them and is reported to the session; no hidden local fallback is attempted.

## Reporting

No runtime service, no listener, no credential store. A vulnerability is a way to execute something
the caller did not ask for, read outside the workspace, escape the root guard or exhaust the agent.
Report privately to the maintainer.
