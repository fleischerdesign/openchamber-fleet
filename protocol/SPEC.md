# fleet.agent.v1 — normative specification

Status: draft for implementation. This document is the contract; code that disagrees is wrong.

The key words MUST, MUST NOT, SHOULD, MAY are used as in RFC 2119.

## 1. Purpose and scope

A controller (the `fleet` CLI or the OpenCode plugin) uses resources of another machine: a
workspace copy, commands, artifacts. The agent is a **process**, not a service: it is spawned per
connection over SSH stdio and exits when the connection closes.

### 1.1 In scope

- session handshake, identity, capabilities, limits;
- workspaces with node-owned locks, generations and crash recovery;
- transactional one-way synchronization (canonical → replica);
- non-interactive command execution with bounded streaming, cancellation and inspection;
- artifact transfer with integrity;
- structured diagnostics.

### 1.2 Out of scope for v1

Screen, input, browser, devices, PTY, watch mode, multi-node scheduling, network listeners,
dynamically loaded modules, Windows. The wire protocol reserves no message numbers for them; new
capabilities are negotiated, not assumed.

## 2. Transport

The only v1 transport is SSH stdio:

```
ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes host /absolute/path/fleet-agent stdio
```

- No PTY. Protocol bytes on stdin/stdout only; logs go to stderr.
- The remote command is a **fixed string**; no user-controlled argument is interpolated into it.
- One SSH connection carries one agent session and any number of requests and streams.
- Connection setup, operation and idle timeouts are distinct.

## 3. Framing

Every frame:

```
u32 length (big endian)   number of bytes after this field: kind + payload
u8  kind                  1 = CONTROL, 2 = DATA
payload
```

- CONTROL payload is UTF-8 JSON (one JSON-RPC 2.0 object). Maximum 1 MiB.
- DATA payload is `u32 streamId (BE) | u64 seq (BE) | bytes`, maximum 1 MiB per frame.
- A frame with an unknown kind, a length above the negotiated maximum, or malformed JSON is a
  protocol violation: the agent responds with `INVALID_FRAME` and closes.
- `seq` starts at 0 per stream and increases by one per DATA frame; a gap is a protocol violation.

## 4. Control messages

JSON-RPC 2.0, no batches, no notifications except `session.shutdown` and stream credit messages.
Identifiers are strings.

| Method | Direction | Purpose |
|---|---|---|
| `session.initialize` | C→A | handshake |
| `session.shutdown` | C→A | graceful close |
| `workspace.open` | C→A | register a replica root |
| `workspace.status` | C→A | generation, lock, recovery state |
| `workspace.close` | C→A | forget a workspace (keeps files) |
| `workspace.lease` | C→A | acquire the workspace lease |
| `workspace.release` | C→A | release the lease |
| `sync.begin` | C→A | open a transaction |
| `sync.entries` | C→A | stream the desired manifest |
| `sync.plan` | C→A | compute the diff; returns the digest and counts |
| `sync.planPage` | C→A | page through changes or needed digests |
| `blob.put` | C→A | upload one blob, then DATA frames |
| `sync.commit` | C→A | apply the plan atomically per §7.6 |
| `sync.abort` | C→A | abandon a transaction before apply |
| `sync.recover` | C→A | complete an interrupted apply |
| `sync.inspect` | C→A | transaction state after a crash |
| `exec.start` | C→A | start a command |
| `exec.status` | C→A | inspect a job |
| `exec.cancel` | C→A | request cancellation |
| `exec.list` | C→A | jobs of this agent instance |
| `artifact.open` | C→A | stream one file out |
| `stream.credit` | C→A | grant N bytes of output credit |
| `stream.close` | C→A | close a stream early |
| `doctor` | C→A | environment facts and limits |

A response carries exactly one of `result` or `error`.

## 5. Handshake

The first control message MUST be `session.initialize`:

```json
{"jsonrpc":"2.0","id":"1","method":"session.initialize","params":{
  "protocol":{"major":1,"minor":0},
  "client":{"name":"fleet","version":"0.2.0","instance":"8d1f…"},
  "capabilities":["workspace.sync@1","exec@1","artifact@1"]
}}
```

The result:

```json
{"protocol":{"major":1,"minor":0},
 "agent":{"version":"0.1.0","build":"2026-11-23","installationId":"…","os":"linux","arch":"x86_64"},
 "capabilities":{"workspace.sync":1,"exec":1,"artifact":1},
 "limits":{"maxFrame":16777216,"maxChunk":1048576,"maxControl":1048576,"maxStreams":32,
           "maxManifestEntries":500000,"defaultLeaseMs":300000}}
```

Rules:

- A major mismatch is `UNSUPPORTED_PROTOCOL`; the agent closes after the error response.
- A capability the client requires but the agent lacks is `UNSUPPORTED_CAPABILITY`.
- `installationId` is stable per agent installation (a file in the state directory). It identifies
  the node, not the connection.
- The agent MUST refuse every other method before a successful handshake with `NOT_INITIALIZED`.
- The agent reports its own limits; the effective limit is the minimum of both sides.

## 6. Workspaces

### 6.1 Registration

`workspace.open {workspaceId, root, stateRoot?}`

- `workspaceId` matches `^[a-z0-9][a-z0-9._-]*$`.
- `root` MUST be inside one of the configured allowed bases (agent configuration) and MUST pass
  the root guard: not `/`, not a system directory, not the user's home, at least two segments.
- The agent owns `<stateRoot>/<workspaceId>/` (default `~/.local/state/fleet-agent`), containing the
  manifest, generation, journal, blob store and job records. It MUST be `0700`.
- `workspace.open` on an unknown root creates it `0700`. On a root that exists but is not managed,
  it refuses unless `adopt: true` is passed.

### 6.2 Generation

A workspace has `generation` (monotonic integer, starts at 0) and `manifestDigest` (SHA-256 over the
canonical manifest encoding, §7.2). Both are written together after a clean commit. A workspace that
was mid-transaction at startup is `RECOVERY` until `sync.inspect`/`sync.abort` resolves it.

### 6.3 Lease

One lease per workspace covers every mutation (`sync.*`, `exec.start`).

`workspace.lease {workspaceId, operationId, ttlMs}` → `{leaseId, generation, expiresAt}`

- The node is the authority: a second lease attempt while one is held returns `WORKSPACE_BUSY`
  with the holder's `operationId` and remaining TTL.
- A lease expires only if its holder stopped renewing. The agent checks liveness of the connection
  that acquired it; a lease from a closed connection is reclaimed immediately.
- `workspace.release {leaseId}`. A command with an unknown, expired or foreign lease returns
  `LEASE_UNKNOWN`/`LEASE_EXPIRED` and MUST NOT mutate anything.
- `exec.status`, `exec.cancel`, `sync.inspect`, `artifact.open` and `doctor` do not need a lease.

## 7. Synchronization

One-way: the controller's tree is authoritative; the replica is derived.

### 7.1 Manifest entry

```json
{"path":"src/main.rs","type":"file","mode":"100644","size":1234,"mtimeMs":1764000000000,"digest":"sha256:…"}
{"path":"target","type":"dir","mode":"40755"}
{"path":"link","type":"symlink","link":"src/main.rs"}
```

- `path` is a relative POSIX path, no `..`, no empty segments, no NUL.
- `type` ∈ `file|dir|symlink`.
- `mode` is the permission bits as an octal string; the executable bit is the only bit with
  portable meaning in v1.
- For `file`, `digest` is the SHA-256 of the content and is required when the blob is needed.
- Entries are sorted by the byte order of `path`.

### 7.2 Manifest digest

SHA-256 over each entry encoded as:

```
type \0 path \0 mode \0 size \0 mtimeMs \0 digest \0 link \n
```

with missing fields as the empty string. Metadata-level identity; content identity is the set of
blob digests.

### 7.3 Ownership

The agent tracks the managed set: every path it created or updated in the last committed
generation. Commit may delete a path only if it is in the previous managed set and not in the new
manifest and not covered by a preserve rule. It MUST NOT delete unmanaged files.

Policy per transaction:

```json
{"excludes":["target/","node_modules/"],
 "preserve":["target/"],
 "deleteManaged":true,
 "casePolicy":"reject-collisions"}
```

- `excludes` are applied to the incoming manifest and to deletion decisions.
- `preserve` paths are never deleted and never cleaned, even if absent from the manifest.
- A file that is both excluded and preserved is simply untouched.
- Paths under `.git` are ordinary entries; no special casing.

### 7.4 Transaction

1. `sync.begin {workspaceId, leaseId, baseGeneration, policy}` → `{txnId}`.
   `baseGeneration` must equal the current generation, else `GENERATION_MISMATCH`.
2. `sync.entries {txnId, entries, more}` — zero or more pages of at most 5000 entries.
3. `sync.plan {txnId}` → `{planDigest, changes:<count>, needed:<count>}`. The agent computes
   the diff against the last committed manifest. Lists are paged (a 200k-file plan would not fit
   in a bounded control frame): `sync.planPage {txnId, kind:"changes"|"needed", offset, limit}`
   → `{items, more}` with `limit` capped at 5000.
4. For every needed blob: `blob.put {txnId, digest, size}` → `{streamId}`; DATA frames; the agent
   verifies the digest and size and stores it in the content-addressed store. A mismatch is
   `BLOB_CORRUPT`; the transaction is aborted.
5. `sync.commit {txnId, planDigest}` → `{generation, manifestDigest}`.
6. `sync.abort {txnId}` discards the journal and leaves the previous generation intact.

### 7.5 Filesystem hazards

The agent MUST:

- use directory-relative, no-follow operations for every path segment;
- reject entries whose parent is a symlink or a non-directory;
- reject file/directory/symlink type swaps that would follow a link;
- reject a path if any component is `.` or `..`, or if two entries collide case-insensitively when
  the destination filesystem is case-insensitive;
- reject hardlinks (v1 does not model them) and special files (FIFO, socket, device);
- preserve the executable bit; all other mode bits are set to `0644`/`0755` for files and `0755` for
  directories;
- write file content to a temporary name in the destination directory, `fsync`, `rename` over the
  target, and `fsync` the directory;
- on any failure, leave the previous generation intact and the transaction `INCOMPLETE`.

Cross-filesystem rename is never required: temporary files are created in the destination
directory.

### 7.6 Commit semantics

Commit is **journaled in place under the lease**, not an atomic replacement of the whole tree. The
specification therefore promises:

- after a crash, the workspace is either at the previous generation or `RECOVERY`;
- no partial file is ever visible under a final name;
- a recovery pass re-applies or rolls back the journal before any new mutation.

It does not promise that 200 000 files change in one instant. Callers that need a snapshot use the
generation precondition.

### 7.7 Recovery

On startup, a workspace with an unfinished journal is `RECOVERY`:

- `sync.inspect {workspaceId}` → `{state:"RECOVERY"|"READY", txnId?, planDigest?, startedAt?}`
- `sync.abort {txnId}` clears a transaction that has not started applying.
- `sync.recover {txnId}` completes an apply that was interrupted; the apply is idempotent.
- Until resolved, `workspace.lease` returns `RECOVERY_REQUIRED`.

## 8. Execution

`exec.start {workspaceId, leaseId, expectedGeneration, argv, cwd?, env?, timeoutMs?, output?}`

- `argv` is an array of strings; v1 has no shell mode. `cwd` is relative to the workspace root.
- `expectedGeneration` must match, else `GENERATION_MISMATCH`.
- `env` replaces the base environment except `HOME`, `PATH`, `LANG=C.UTF-8`, `TZ=UTC`. `PATH` is the
  agent process PATH (node-local); declared entries may override any of them.
- The agent starts the process in a new session (`setsid`) and, on Linux, inside a cgroup when the
  cgroup v2 delegation is available; otherwise process-group cleanup is the documented fallback.
- stdout and stderr become streams. Each stream obeys credits:

  `stream.credit {streamId, bytes}` increases the allowance. The agent sends data only within the
  allowance, buffering up to `maxSpoolBytes` (default 8 MiB per stream) on disk. When the spool is
  full and no credit arrives, the job **blocks** (default) or truncates with a durable marker if
  `output: "truncate"`.
- End of stream is a CONTROL `stream.end {streamId, seq, bytes}` followed by DATA with the final
  sequence number.
- `exec.status {jobId}` → `{state, exitCode?, signal?, startedAt, endedAt?, unknown?:true}`.
  `state` ∈ `starting|running|cancel-requested|succeeded|failed|cancelled|unknown`.
- `exec.cancel {jobId, graceMs}` → `{accepted:true}`; the final state reports the real outcome.
  Cancellation is `SIGTERM`, then `SIGKILL` after `graceMs`.
- On connection loss the agent MUST cancel all jobs of that connection (v1 policy), record the
  outcome, and flush the final state to the job record. A crash of the agent leaves `unknown`; the
  record is never rewritten to a guess.
- Exit codes are the process's own. The agent maps a signal to `signal` and `exitCode: null`.

## 9. Artifacts

`artifact.open {workspaceId, path}` → `{streamId, size, digest}`; DATA frames; `stream.end`.
Paths obey §7.5. A symlink is rejected unless `follow:true`, which the agent refuses for links
outside the workspace. The controller verifies the digest itself.

## 10. Errors

Every error response uses a stable code, a human message and optional details:

```json
{"code":"GENERATION_MISMATCH","message":"generation 4 is not 3","retryable":false,
 "details":{"expected":3,"actual":4}}
```

Codes: `INVALID_FRAME`, `INVALID_REQUEST`, `NOT_INITIALIZED`, `UNSUPPORTED_PROTOCOL`,
`UNSUPPORTED_CAPABILITY`, `WORKSPACE_UNKNOWN`, `WORKSPACE_BUSY`, `RECOVERY_REQUIRED`,
`GENERATION_MISMATCH`, `LEASE_UNKNOWN`, `LEASE_EXPIRED`, `PATH_UNSAFE`, `UNSUPPORTED_METADATA`,
`PLAN_MISMATCH`, `BLOB_MISSING`, `BLOB_CORRUPT`, `DISK_FULL`, `PERMISSION_DENIED`,
`RESOURCE_EXHAUSTED`, `OPERATION_UNKNOWN`, `CANCELLED`, `INTERNAL`.

`retryable` is advice, never an instruction to replay a mutation.

## 11. Idempotency and unknown outcomes

- `operationId` identifies a mutation attempt. Repeating a request with the same `operationId` and
  identical parameters returns the recorded result; different parameters return `INVALID_REQUEST`.
- Operation records live in the state directory and expire after 24 h.
- No exactly-once guarantee exists for process execution: there is a window between spawn and the
  persisted job record. The protocol exposes `unknown` rather than guessing.
- A controller MUST inspect before replaying an operation whose outcome is unknown.

## 12. Limits

| Limit | Default | Enforcement |
|---|---|---|
| control frame | 1 MiB | reject |
| data frame | 1 MiB | reject |
| manifest entries | 500 000 | reject the transaction |
| streams per session | 32 | reject |
| spool per stream | 8 MiB | block or truncate per job policy |
| lease TTL | 300 000 ms | expire |
| operation record TTL | 24 h | prune |

## 13. Conformance

An implementation is conformant when it passes every fixture in `protocol/fixtures/`:

- `handshake.json` — happy path, version mismatch, capability mismatch;
- `workspace.json` — open, lease, busy, expiry;
- `sync.json` — plan, commit, abort, generation mismatch, recovery;
- `exec.json` — stdout/stderr, exit code, timeout, cancel, disconnect;
- `artifact.json` — open, digest, unsafe path;
- `errors.json` — every code, `retryable` flag.

Fixtures are data, not prose: request/response sequences with expected frames. The Rust agent and
the TypeScript controller both consume them.
