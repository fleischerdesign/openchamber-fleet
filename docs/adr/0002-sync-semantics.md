# ADR-0002: One-way replication with a metadata revision

**Status:** superseded by ADR-0006 (kept as history)

## Context

A workspace has to exist on the node before a command can run there. Options:

- bidirectional sync (Mutagen/Unison style) with conflict handling;
- mount the canonical tree over SSHFS/NFS;
- one-way replication of a copy.

A digest is needed to state "the replica matches" without pretending to a guarantee we do not have.

## Decision

**One-way replication, canonical → replica.** The canonical tree is the only writer; the replica is
derived state. Conflict handling does not exist because conflicts cannot occur.

Replication is defined by `rsync` semantics with an explicit exclude list, and the recorded identity
of a tree is a **metadata revision**: SHA-256 over path, type, mode, size, mtime and link target.

Content equality is a separate, explicit operation (`sync --verify --content`, rsync
`--checksum`). The CLI never prints "identical" when it means "same size and mtime".

## Consequences

- A hand edit on the node is not merged; it is overwritten by the next sync or reported as drift by
  a verify. That is intentional: the node is not a place to edit.
- A file whose content changed but whose size and mtime did not is invisible to the revision and to
  rsync's quick check. `--checksum` exists precisely for that case, and the documentation says so.
- Mounting was rejected: build I/O over a network filesystem is both slow and lock-sensitive, and a
  stale mount fails in ways that are hard to diagnose from an agent session.

## Alternatives rejected

- **Bidirectional sync:** conflict resolution needs a policy, a UI, and a user decision in the
  middle of an agent run. Not worth it for a cache-like replica.
- **SSHFS/NFS:** see above. Also turns every `read` into a network round trip.
- **Content-addressed store (Bazel-style CAS):** the right answer at monorepo scale, a large amount
  of machinery for a workspace that already sits on a local disk.
