# ADR-0001: SSH and rsync as the only transport

**Status:** accepted

## Context

Remote execution needs a transport that works on machines we do not administer, without installing
anything. Candidate transports:

- a small agent daemon (gRPC/HTTP) on each node;
- SSH with per-command execution;
- a message queue with workers;
- a distributed filesystem plus remote shell.

## Decision

Use **SSH with `rsync` for replication and `bash -c` for execution**. No daemon, no listener, no
package on the node.

## Consequences

- Works on any machine that already has `ssh` and `rsync` — which is every developer machine and
  every CI runner we care about.
- Authentication, host verification, and encryption are inherited from OpenSSH, including its
  configuration and audit story.
- Per-command latency includes connection setup (~50–200 ms on a LAN). Acceptable for commands that
  take seconds; irrelevant for builds.
- Cancellation is cooperative: a timeout must signal the remote pid through a second connection.
- `rsync` is a real dependency on the node. Version is checked and a too-old version is refused
  rather than producing subtly different semantics.

## Alternatives rejected

- **Agent daemon:** one more service to install, patch, secure and monitor on every node; the
  product is a plugin, not a fleet agent.
- **Queue with workers:** introduces a broker, job schema, and a second source of truth for state.
  Only justified when many jobs run concurrently across many nodes.
- **Distributed filesystem:** latency and locking problems for builds, plus a new failure domain.

## Connection reuse

Every command opens its own SSH connection by default, which costs a handshake per call. The
transport therefore sets `ControlMaster=auto`, `ControlPath=<runtime-dir>/%C` and
`ControlPersist=60s`: the first command opens a master, the following commands and rsync share it,
and it closes after a minute of silence. No daemon is involved — the master is an sshd child that
already exists for the session lifetime.

Multiplexing is skipped when `FLEET_SSH` is set (the test transport must not share a socket) or when
the runtime directory cannot be created. `FLEET_SSH_NO_MULTIPLEX=1` forces it off.

## Revisit triggers

The decision was made for coarse-grained work: one build, one test suite, one render per call. It
should be reopened, deliberately and with a new ADR, if any of these become true:

- interactive sessions or a PTY on the node are required;
- file-level RPC over the boundary becomes the dominant workload (many small reads and writes);
- Windows nodes must be supported;
- a job queue with many concurrent jobs across many nodes is needed;
- block-level delta transfer inside large files becomes the bottleneck.

Until then, adding a daemon would trade an install step, a listener, a credential store and a version
matrix for a latency win that a 30-second build does not notice.
