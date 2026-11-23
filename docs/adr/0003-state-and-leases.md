# ADR-0003: Local state, file leases, verify-before-execute

**Status:** accepted

## Context

Two sessions can target the same node and workspace. A sync and a build must not interleave, and a
recorded "synced" flag must not be trusted after a crash.

## Decision

- State lives on the **controller** in `~/.local/state/openchamber-fleet/`, never on the node.
- Mutual exclusion uses a **lease file** created with `O_EXCL`, holding `{runId, pid, startedAt,
  expiresAt}`. A lease whose pid is gone and whose TTL has passed is reclaimed; a lease with a live
  pid is never stolen.
- State is a **hint for display**, never a permission. `exec` runs an in-band verify (an rsync dry
  run) before spawning anything, so a stale flag cannot cause a stale build.
- Writes are atomic (temp file + rename) and state is plain JSON; a corrupt file is reported, not
  silently replaced.

## Consequences

- Every `exec` costs one rsync dry run. On a warm tree this is milliseconds; on 200k files it is
  noticeable, and that is the honest price of not running against a stale replica.
- A crashed process leaves a lease that expires. It cannot leave a replica marked current, because
  the mark is written only after a clean verify.
- Clock skew across hosts is irrelevant: no cross-host timestamps are compared. The only clock used
  is the controller's, for lease expiry.

## Alternatives rejected

- **Lock file on the node:** introduces a second state store and a cleanup problem when the node is
  unreachable.
- **Trust the state file:** cheap, and wrong exactly when it matters (crash, manual edit).
- **A database:** a single small JSON file plus `flock`-style creation is enough for the concurrency
  this tool has.
