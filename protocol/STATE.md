# State machines

Normative companion to `SPEC.md`. Every transition names the crash outcome, because a state diagram
that ignores crashes is a drawing, not a specification.

## Session

```
NEW ──initialize──▶ ACTIVE ──shutdown──▶ CLOSED
 │                    │
 └──invalid frame────▶└──connection lost──▶ CLOSED
```

- Handshake failure closes the session after the error response.
- Every method except `session.initialize` is `NOT_INITIALIZED` before `ACTIVE`.
- Closing cancels jobs and releases leases owned by the connection (§8).

Crash: a dead process leaves no session. Jobs are recorded; leases are reclaimed when the
connection is gone.

## Workspace

```
UNMANAGED ──open──▶ READY ──begin──▶ SYNCING ──commit/abort──▶ READY
ABSENT ──preview──▶ ABSENT (no state, no journal)
                       │                  │
                       │                  └──agent crash──▶ RECOVERY
                       └──startup finds journal──▶ RECOVERY
RECOVERY ──inspect+abort──▶ READY
```

- `READY` carries `generation` and `manifestDigest`.
- `SYNCING` holds the lease; `exec.start` is refused while a transaction is open
  (`WORKSPACE_BUSY`), even by the same connection.
- `RECOVERY` refuses leases until resolved.

Invariant: the manifest and generation file are replaced **after** the journal is fully applied,
inside one directory rename of the state directory's `commit` file. A crash before that rename
leaves the previous pair.

## Sync transaction

```
BEGIN ──entries──▶ PLANNING ──plan──▶ PLANNED ──blobs──▶ TRANSFERRING
   │                    │                  │                  │
   └──abort/error───────┴──────────────────┴──────────────────┴──▶ ABORTED
                                                                  │
                       commit (all blobs present, planDigest ok) ─┴──▶ COMMITTED
```

- `BEGIN` records the journal header with `baseGeneration` and `operationId` **before** any file is
  touched.
- `PLANNING` refuses a second `sync.begin` for the same workspace.
- `TRANSFERRING` accepts blobs in any order; duplicates are idempotent.
- `commit` requires the owning lease and the exact `planDigest`; a mismatch is `PLAN_MISMATCH` and
  leaves the transaction
  open for inspection.
- `ABORTED` removes temporary blobs; content-addressed blobs already committed are retained for a
  later transaction.

Crash windows:

| Crash after | Startup finds | Recovery |
|---|---|---|
| journal header | `RECOVERY`, no staged tree | abort → READY at previous generation |
| some blobs | `RECOVERY` | abort; orphan blobs pruned by GC |
| apply, before commit record | `RECOVERY` with undo log | abort rolls back, READY |
| commit record, before manifest rename | `RECOVERY` with completed journal | finish: rename, verify, READY at new generation |

## Lease

```
FREE ──lease──▶ HELD ──release──▶ FREE
                  │
                  ├──connection lost──▶ FREE (reclaimed)
                  └──ttl elapsed, connection alive──▶ HELD (renewed or expired on next check)
```

- The agent does not use wall-clock TTL as authority while the owning connection is alive; it
  expires only when the connection is gone or the holder fails to renew before `expiresAt`.
- A lease carries `operationId`; a second acquisition reports it.

## Job

```
STARTING ──spawned──▶ RUNNING ──exit──▶ SUCCEEDED | FAILED
    │                    │
    │                    ├──cancel──▶ CANCEL_REQUESTED ──signal──▶ CANCELLED
    │                    └──connection lost──▶ CANCEL_REQUESTED (agent-initiated)
    └──spawn failed──▶ FAILED (with cause)
agent crash ──▶ UNKNOWN (recorded, never rewritten)
```

- `UNKNOWN` is terminal for the agent instance; `exec.status` after restart reports `unknown` with
  the last known timestamp.
- A job record is written before the process is spawned (`STARTING`), so a crash between spawn and
  record cannot happen; a crash after spawn but before `RUNNING` yields `UNKNOWN`, which is honest.

## Stream

```
OPEN ──credit──▶ FLOWING ──end──▶ ENDED
  │                 │
  └────close────────┴──────────▶ CLOSED
```

- Data is sent only within credits.
- `stream.end` carries the final `seq` and total bytes; a mismatch is a protocol violation.
- Closing a stream early asks the agent to stop producing; the job may continue writing to its
  spool up to the limit.
