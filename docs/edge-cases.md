# Edge cases

Every row is a statement the implementation must satisfy. Coverage is tracked in
[`test-coverage.md`](test-coverage.md); a row is never silently claimed as tested.

## Protocol and session

| ID | Statement | Test |
|---|---|---|
| PROTO-01 | Unknown frame kind or oversize length closes the session | `frame::tests` |
| PROTO-02 | Sequence gaps in DATA frames are invalid | `session` (client side), `client.ts` |
| PROTO-03 | A method before `session.initialize` is `NOT_INITIALIZED` | `session::tests::method_before_handshake_is_refused` |
| PROTO-04 | Major version mismatch is `UNSUPPORTED_PROTOCOL` and closes | `session::tests::version_mismatch_closes` |
| PROTO-05 | A required capability the agent lacks is `UNSUPPORTED_CAPABILITY` | handshake fixtures |
| PROTO-06 | Control frames are bounded at 1 MiB, data at 1 MiB | `frame::tests::rejects_oversize_control` |

## Workspace and leases

| ID | Statement | Test |
|---|---|---|
| WS-01 | The root guard refuses `/`, system directories, the home and short paths | `workspace::resolve_root` (unit) |
| WS-02 | An existing unmanaged root is refused without `adopt` | planned |
| WS-03 | A second lease is `WORKSPACE_BUSY`; the kernel releases a dead lease | planned (two-process test) |
| WS-04 | Generation mismatch is refused at `begin` and `exec.start` | `sync::tests::generation_mismatch_is_refused` |
| WS-05 | A journal makes the workspace `RECOVERY` and blocks leases | planned |
| WS-06 | Workspace state is `0700`, files `0600` | planned |

## Synchronization

| ID | Statement | Test |
|---|---|---|
| SYNC-01 | Add, update and delete are computed against the committed manifest | `sync::tests::plan_commit_and_idempotent_replan` |
| SYNC-02 | A second plan with the same tree is empty | same test |
| SYNC-03 | `preserve` paths survive deletion | `sync::tests::deleted_entries_are_removed_but_preserved_paths_survive` |
| SYNC-04 | Excludes match the documented subset, including ancestors | `model::tests::exclude_patterns_match_like_rsync_subset` |
| SYNC-05 | Paths with `..`, absolute paths and empty segments are refused | `model::tests::unsafe_paths_are_rejected` |
| SYNC-06 | A blob is verified against its digest before commit | `sync::tests` (planned corrupt case) |
| SYNC-07 | A commit with a wrong plan digest is `PLAN_MISMATCH` | planned |
| SYNC-08 | A crash during apply leaves `RECOVERY`, never a marked generation | `test/v1/failure.test.js` |
| SYNC-09 | Two controllers cannot mutate one workspace | planned (two-process test) |
| SYNC-10 | Symlinks are recreated, never followed | planned (agent test) |

## Execution

| ID | Statement | Test |
|---|---|---|
| EXEC-01 | stdout and stderr are streamed and separable | `session::tests::exec_streams_output_and_reports_exit` |
| EXEC-02 | Exit codes are preserved | `exec::tests::exit_code_is_preserved` |
| EXEC-03 | Timeout terminates the process group | `exec::tests::timeout_terminates` |
| EXEC-04 | Cancel terminates the process group | `exec::tests::cancel_terminates_the_process_group` |
| EXEC-05 | The caller environment is not inherited | planned (explicit env test) |
| EXEC-06 | Output is credit-controlled with a bounded spool | `session` pump test |
| EXEC-07 | A connection loss cancels its jobs | `test/v1/protocol.test.js` |
| EXEC-08 | A crash leaves `unknown`, never a guessed outcome | planned (failure suite) |

## Artifacts

| ID | Statement | Test |
|---|---|---|
| ART-01 | A file streams with size and digest | `session::tests::artifact_streams_a_file_with_digest` |
| ART-02 | The controller verifies the digest before writing | `test/v1/protocol.test.js` |
| ART-03 | Symlinks and non-files are refused | `artifact.open` code path (unit planned) |

## Controller

| ID | Statement | Test |
|---|---|---|
| CTL-01 | The manifest digest matches the agent's encoding | planned (parity fixture) |
| CTL-02 | The controller scans the source, never the replica | `test/v1/protocol.test.js` |
| CTL-03 | SSH argv is fixed and the agent path is validated | planned (unit) |
| CTL-04 | Sync, exec and fetch work against the real agent | `test/v1/protocol.test.js` |

## Context, transfers and read-only operations

| ID | Statement | Test |
|---|---|---|
| CTX-01 | Status and probe never create a replica root or state entry | `test/v1/protocol.test.js`, `test/unit/operations.test.js` |
| CTX-02 | `sync plan` is read-only and refuses an absent replica | `test/unit/operations.test.js` |
| CTX-03 | A lease is bound to the workspace that acquired it | `test/v1/protocol.test.js` |
| CTX-04 | `sync=plan` never executes a command | `test/unit/run.test.js` |
| CTX-05 | `cwd` stays relative to the root and rejects symlink or parent escapes | `test/v1/protocol.test.js` |
| CTX-06 | A scratch target is explicit and has no source or sync | `test/unit/scratch.test.js`, `test/unit/plugin.test.js` |
| XFR-01 | A regular file round-trips through scratch with size and digest verification | `test/v1/protocol.test.js` |
| XFR-02 | Symlinks, path traversal and non-regular files are refused | `test/v1/protocol.test.js` |
| XFR-03 | An existing destination is not overwritten by default | `test/v1/protocol.test.js` |
| XFR-04 | Jobs are addressed by id and owning session, not by the current workspace | `test/unit/jobs.test.js`, `test/unit/supervised.test.js` |
| XFR-05 | A background exec carries the synchronized generation | `test/unit/supervised.test.js` |

## Host selection

| ID | Statement | Test |
|---|---|---|
| SEL-01 | A project without `hosts` uses every host in the global registry | `test/unit/config.test.js` |
| SEL-02 | A present `hosts` allowlist restricts the registry | `test/unit/config.test.js` |
| SEL-03 | `requires` keeps only hosts carrying every tag | `test/unit/config.test.js` |
| SEL-04 | An explicit host that lacks a required tag is refused | `test/unit/config.test.js` |
| SEL-05 | An empty allowlist, duplicate alias or duplicate requirement is refused, and an empty allowlist stays repairable in the panel | `test/unit/config.test.js` |
| SEL-06 | A replica root must target a selected host | `test/unit/config.test.js` |
| SEL-07 | Removing a registry host is refused while another project names it in `hosts` or `roots`; implicit projects follow the registry | `test/unit/config.test.js` |
| SEL-08 | A new project registered by `fleet init` omits the allowlist and uses the registry | `test/unit/config.test.js` |
| SEL-09 | Panel read and save routes use the default project for a projectless chat | `test/unit/service.test.js` |

## Default workspace

| ID | Statement | Test |
|---|---|---|
| PROJ-01 | A projectless OpenChamber chat uses the configured default project | `test/unit/config.test.js`, `test/unit/service.test.js` |
| PROJ-02 | A real project without Fleet configuration never borrows the default | `test/unit/config.test.js` |
| PROJ-03 | `fleet_hosts` lists the global registry without a project or default | `test/unit/cli.test.js` |
| PROJ-04 | `fleet default` sets, shows and clears the default | `test/unit/cli.test.js` |

## Detached jobs

| ID | Statement | Test |
|---|---|---|
| JOB-01 | A background job survives an OpenCode runtime restart | live gate + model in `test/unit/supervised.test.js` |
| JOB-02 | An old running record is interrupted, never resumed | `test/unit/supervisor.test.js` |
| JOB-03 | A new plugin instance can cancel an old job | `test/unit/supervised.test.js` |
| JOB-04 | A terminal job produces one resuming notification | `test/unit/supervised.test.js` |
| JOB-05 | Closing the agent session kills the remote process group | `test/v1/protocol.test.js` |
| JOB-06 | Without the service the plugin falls back to the runtime-bound path | `test/unit/supervised.test.js` |
| JOB-07 | The spool is `0700`/`0600` and carries no environment in job records | `test/unit/job-store.test.js` |

## Recovery, failure, performance

| ID | Statement | Test |
|---|---|---|
| FAIL-01 | Disconnect at begin, entries, plan, blob and commit is recoverable | planned |
| FAIL-02 | Disk full fails before a generation is committed | `test/v1/failure.test.js` (simulated) |
| FAIL-03 | Output flood blocks at the spool limit and never grows memory | planned |
| FAIL-04 | 200k files plan/commit within a documented time and memory bound | planned |
| FAIL-05 | Symlink traversal attempts are refused | partially (path validation) |

Planned rows are the definition of the failure-injection suite; they are not implemented yet and are
not claimed as done.
