# ADR-0006: protocol-first architecture (supersedes 0001–0003)

**Status:** accepted

## Context

v0 implemented remote execution with a bash wrapper over SSH and rsync for replication. It worked,
but it had three contracts in one tool: a shell script for execution, rsync for files, and a
controller-side state model for leases. Every new capability (browser, screen, devices) would have
added a fourth special case.

The review of v0 (external, 2026-11-23) named the structural risks: no node-owned fencing, no
disconnect policy, no transactional sync, no bounded streaming, and a trust boundary that capability
grants could not actually enforce.

## Decision

One protocol, `fleet.agent.v1`, spoken over SSH stdio to a Rust agent that is spawned per
connection:

- **Transport:** SSH stdio, fixed argv, no listener, no PTY. SSH supplies authentication, host
  verification and encryption.
- **Framing:** `u32 length | kind | payload`; JSON-RPC control, stream-id/sequence data frames,
  1 MiB bounds.
- **State:** node-owned. `flock` lease, generation + manifest, journal, content-addressed blobs.
- **Sync:** `begin → entries → plan → blob.put → commit`; journaled in place; `RECOVERY` after a
  crash; generation precondition for callers that need a snapshot.
- **Exec:** argv only, new session, process-group termination, credit-controlled streams, `unknown`
  after a crash.
- **No fallback:** the bash/rsync backend is deleted. The agent binary is a required install.

## Consequences

- Nodes need an installed binary; in exchange they need nothing else (no rsync, no shell wrapper).
- The protocol is testable without a network: spawn the agent and exchange frames.
- The controller stays TypeScript because the OpenCode plugin API is TypeScript; the agent is Rust
  for a static binary, device access and predictable performance.
- Every future capability is a negotiated module with its own schema, not a new code path in the
  tool.

## Rejected alternatives

- **Keep bash+rsync as a fallback:** two contracts, two semantics, duplicated tests — the exact
  duplication this ADR removes. A migration window is acceptable; a permanent second path is not.
- **Daemon with a listener:** adds authentication, TLS, discovery and lifecycle for a product that
  is a plugin. A persistent transport can be added later behind the same protocol.
- **MCP as the transport:** good for model-facing tools, not a workspace-transfer or job-lifecycle
  protocol.
- **Controller in Rust:** another bridge for no benefit; the hard problems are filesystem and
  process semantics, which live in the agent.
