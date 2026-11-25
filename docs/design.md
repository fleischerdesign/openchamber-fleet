# Design

The normative wire contract is [`protocol/SPEC.md`](../protocol/SPEC.md); the state machines,
including every crash window, are in [`protocol/STATE.md`](../protocol/STATE.md). This document
explains why the components are split the way they are.

## 1. Problem

An agent session executes its tools where its runtime lives. That is right until one command needs
more CPU, memory or a device than the session host has. Moving the session breaks continuity;
starting a second runtime fragments state. What remains is to move **the work**: replicate the
workspace, run one command, bring back what it produced.

## 2. Model

```
canonical workspace (controller)  ──sync──▶  replica (node)  ──exec──▶  artifacts
```

- The canonical tree is the only writer; the replica is derived state.
- The node owns the truth about its replica: lease, generation, manifest, journal, blob store.
- The controller owns planning, the manifest it wants, and the local artifacts.

This split is the central decision. A controller-side lease cannot fence a second controller; a
node-side generation cannot be forged by a stale controller.

## 3. Invariants

| # | Invariant | Where it is enforced |
|---|---|---|
| I1 | One writer, canonical → replica | no reverse path exists |
| I2 | Work runs only at the expected generation | `exec.start.expectedGeneration` |
| I3 | One mutation or execution per workspace | node lease (`flock`) |
| I4 | Excluded/preserved paths are never deleted | compiled policy at plan and commit |
| I5 | Unmanaged files are never deleted | managed set from the last committed manifest |
| I6 | A crash leaves the previous generation or `RECOVERY` | journal written before apply |
| I7 | Commands do not inherit the caller's environment | `env_clear` + fixed base + declared vars |
| I8 | Streams are bounded and credit-controlled | 8 MiB spool, credit accounting |
| I9 | Unknown outcomes are reported, never guessed | `JobState::Unknown`, `OPERATION_UNKNOWN` |

## 4. Components

### Agent (Rust, `agent/`)

- `frame`: length-prefixed framing, size limits, seq validation.
- `session`: handshake, dispatch, stream pump, stdio loop.
- `workspace`: registry, state directory, generation, `flock` lease.
- `sync`: manifest diff, blob store, journal, apply, commit, abort.
- `exec`: argv spawn in a new session, process-group termination, buffered streams.
- `model`: entries, digest, policy matcher, job states.

A process, not a service: it is spawned over SSH stdio, serves one connection and exits. There is
no listener, no credential store, no upgrade daemon.

### Controller (TypeScript, `src/`)

- `v1/frame` and `v1/client`: framing, JSON-RPC, streams, credits.
- `v1/workspace`: local scan, SHA-256 per file, manifest digest shared with the agent.
- `v1/operations`: sync, exec, fetch, status.
- `cli` and `plugin`: two thin adapters.

No transport logic outside `v1/transport.ts`; no agent logic in the plugin.

## 5. Why not rsync/bash

Both are excellent at what they do, and both create a second contract:

- a bash wrapper cannot stream with backpressure, cannot report structured progress, and needs
  quoted-script tricks for cancellation;
- rsync excludes must stay byte-for-byte compatible with the manifest matcher, or the plan and the
  transfer disagree — a class of bug we had to test around.

The agent owns both the file semantics and the process semantics in one place. This costs an
installed binary per node. That is the trade: one contract instead of three.

## 6. Synchronization

`begin → entries → plan → blob.put → commit` (§7 of the spec), with a separate in-memory preview
for `mode=plan`.

- The controller sends its desired manifest; the agent diffs it against the last committed one.
- A preview never writes a journal. It works against an absent replica, so the first plan is
  available before anything is provisioned.
- Missing blobs are content-addressed and verified on receipt.
- Commit applies a journal in place under the lease and only then writes generation + manifest.
- A crash during apply leaves `RECOVERY`; `sync.inspect` shows the transaction, `sync.abort` works
  before apply, and completing forward is the recovery for an interrupted apply.
- Entry-level atomicity (temp file, fsync, rename) is guaranteed; whole-tree atomicity is not. The
  generation precondition is how a caller asks for a coherent snapshot.

## 7. Execution

- argv only; no shell mode.
- New session, process-group termination, optional timeout, optional cgroup later.
- stdout/stderr are credit-controlled streams with a bounded spool.
- Cancellation is a request; the final state reports the real outcome.
- A connection loss cancels the jobs of that connection and records the outcome; an agent crash
  leaves `unknown`.

### Detached background jobs

The OpenCode plugin's background jobs can outlive an OpenCode runtime restart without turning Fleet
into a remote daemon. The extension service launches a local supervisor with the app runtime; the
supervisor owns the SSH connection and writes atomic job records under
`~/.local/state/openchamber-fleet`. The plugin writes start/cancel requests and reads records through
the same directory. There is no listener and no new credential.

The agent still spawns per connection. Its new teardown rule is that closing the stdio session
terminates the job's process group, so a dead supervisor cannot leave an orphan on the node. The
supervisor's own teardown cancels active jobs first; a crash is reported as `interrupted`. The
design and its failure table are in ADR-0007.

## 8. Errors and recovery

Stable codes (`protocol/errors.json`) and a `retryable` hint. Mutations are not replayed
automatically; an unknown outcome is inspected first. The controller's `sync` wraps a transaction in
`abort` on failure, and the agent refuses a new lease while a journal exists.

## 9. Non-goals for v1

Screen, input, browser, devices, PTY, watch mode, multi-node scheduling, network listeners,
dynamically loaded modules, Windows. The protocol reserves nothing for them: they are negotiated
capabilities, added with their own modules and tools.

## 10. Open work

The failure-injection suite and the live fleet/OpenChamber proof are the remaining gate. The
protocol deliberately makes those tests possible: every phase boundary is observable, every state
is reported, and every unknown is named.
