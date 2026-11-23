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
