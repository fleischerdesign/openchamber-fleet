# ADR-0007: detached background jobs

**Status:** accepted

## Context

Fleet 0.5.0 runs a background job inside the OpenCode plugin runtime. The plugin owns the SSH
connection and the `ExecHandle`; `session.synthetic(..., resume: true)` wakes the session when the
promise settles. That is correct while the runtime lives, but an OpenCode restart, a plugin unload
or a location change destroys the handle. The job is then reported as `interrupted` and the remote
process is left to its own fate.

The next step is a local job supervisor that survives an OpenCode runtime restart. It must not
become a remote daemon, must not patch OpenChamber or OpenCode, and must keep the existing approval
and transport model.

Two runtime facts shape the design:

- The OpenCode plugin runs in a compiled Bun binary. It cannot reliably spawn a JavaScript helper
  with `process.execPath`.
- The OpenChamber extension service is a long-lived process started by the host with the app
  runtime (Bun on the server, Electron-as-Node on desktop). It survives an OpenCode runtime restart
  and can spawn a detached process.

## Decision

Run one detached supervisor per user, launched by the extension service, independent of the
OpenCode runtime. The plugin and the supervisor communicate through a file spool in a per-user
state directory. There is no listener, no port and no new credential.

The supervisor owns the SSH connection and the `fleet.agent.v1` client. The plugin only writes a
start request, reads job records and writes a cancel request. The existing approval happens before
the request is written; the supervisor executes only an argv the plugin already approved.

### Processes

```
OpenCode plugin (Bun)         extension service (Bun/Electron-as-Node)
        | writes requests              | spawns, then monitors
        v                              v
   state directory  <------------  detached supervisor (same app runtime)
                                        | SSH stdio
                                        v
                                   fleet-agent (remote)
```

The supervisor is started with `detached: true`, `stdio: 'ignore'` and `unref()`. On a systemd
service, the process stays in the OpenChamber cgroup; an OpenChamber service stop therefore still
kills it. On desktop, it can outlive the app process. The supervisor exits on its own when the
service heartbeat has been gone for 90 seconds and no job is active.

### State

```
~/.local/state/openchamber-fleet/
  supervisor.json          discovery + heartbeat, atomic, 0600
  supervisor.lock          pid + startedAt + bootTime, created with O_EXCL
  supervisor.log           bounded operator log; no argv or env
  jobs/<jobId>.json        one record per job, atomic, 0600
  requests/<jobId>.json    start request, 0600, deleted after claim
  requests/claimed/        atomically renamed request while it is being started
  cancel/<jobId>.json      cancellation request
```

The default state root is `$HOME/.local/state/openchamber-fleet`. `FLEET_STATE_DIR` overrides it
for tests and advanced setups. A small runtime pointer in the OS temp directory maps the plugin to
the service's state root, so a different `HOME` between OpenChamber and OpenCode cannot split them:

```
$TMPDIR/openchamber-fleet-<user>/
  state.json               { version, stateRoot, servicePid, updatedAt }
  service.json             { pid, updatedAt } service heartbeat
```

The service writes both at startup and refreshes the heartbeat every 5 seconds. The directory is
0700 and owned by the user; the files are 0600.

### Job record

```json
{
  "version": 1,
  "jobId": "job-…",
  "sessionID": "ses_…",
  "workspace": "nixfiles",
  "directory": "/home/philipp/dev/nixfiles",
  "host": "mob-nb-01",
  "argv": ["bash", "-lc", "…"],
  "state": "running",
  "remoteJobId": "job-…",
  "startedAt": 0,
  "updatedAt": 0,
  "endedAt": null,
  "exitCode": null,
  "signal": null,
  "stdoutBytes": 0,
  "stderrBytes": 0,
  "stdoutTail": "",
  "stderrTail": "",
  "error": null,
  "supervisor": { "pid": 1234, "startedAt": 0 }
}
```

States are `queued`, `starting`, `running`, `cancel-requested`, `succeeded`, `failed`, `cancelled`,
`interrupted` and `unknown`. Environment variables are never persisted; they live only in the
request file and are removed when the supervisor claims it. Records keep the argv the user approved
and the 4 KiB output tails, as 0.5.0 already does.

### Lifecycle

1. The service starts, writes the runtime pointer and heartbeat, and ensures a supervisor. It
   re-checks every 5 seconds.
2. The plugin synchronizes the workspace, then checks the supervisor heartbeat. If it is healthy,
   the plugin writes `requests/<jobId>.json` and waits up to 20 seconds for `running` or a terminal
   record. If it is not healthy, the plugin falls back to the 0.5.0 in-process registry and reports
   `supervised: false`.
3. The supervisor atomically claims the request, writes a `queued`/`starting` record, opens the
   workspace lease, calls `exec.start` and streams output. It persists the record every 2 seconds
   and on every state change.
4. On terminal, the supervisor writes the final record and releases the lease. The plugin poller
   sees it, sends one synthetic message with `resume: true` for success/failure/cancel, and marks the
   notification in OpenCode storage. Interrupted jobs use `resume: false`, as 0.5.0 does.
5. Cancellation writes `cancel/<jobId>.json`. The supervisor marks `cancel-requested`, sends
   `exec.cancel`, and writes the terminal record. A cancel from a new plugin instance reaches a job
   started by an old one.
6. On an OpenCode runtime restart, the supervisor is untouched. The new plugin scans records,
   tracks running jobs without marking them interrupted, and notifies when they finish.
7. If the supervisor dies, the service restarts it within 5 seconds. The new supervisor marks every
   non-terminal record owned by a previous supervisor instance as `interrupted`, then the plugin
   notifies with `resume: false`. The remote agent kills its child process when the SSH stdio
   session closes, so an interrupted job does not leave an orphan.
8. On an OpenChamber service stop or machine reboot, the supervisor is gone. The next plugin run
   marks the remaining running records `interrupted` after a grace period and notifies.
9. A terminal job whose notification was not delivered is re-notified once after the next plugin
   start. The deterministic synthetic id and the storage ledger make this idempotent.

### Failure handling

| Failure | Behaviour |
|---|---|
| supervisor absent (npm-only plugin, service not granted) | fall back to in-process; `supervised: false` |
| two supervisors start at once | `supervisor.lock` with `O_EXCL`; the second exits |
| stale lock after reboot / PID reuse | lock carries `bootTime`; a lock from another boot is removed; a live pid with a fresh heartbeat is never killed |
| supervisor heartbeat stale | plugin does not write running records; it waits for the service to restart the supervisor, then marks interrupted |
| disk full while persisting | supervisor logs and retries; a terminal state that cannot be persisted is reported as `interrupted` after the supervisor is gone |
| SSH connection lost | the remote agent sees EOF, kills the process group; the record becomes `failed`/`interrupted` |
| duplicate start request | same `jobId` is idempotent; the second request is deleted |
| duplicate notification | deterministic `msg_fleet_<digest>` id plus the storage `notified` flag |
| session deleted while the plugin was down | a reconciler checks the session once and writes a cancel request instead of waking it |

### Why a file spool and not a socket

A socket would add a listener, a token, reconnect logic and a second lifecycle to test. A spool is
the same contract with the filesystem as the transport:

- atomic `rename` gives exactly-one claim;
- either side can restart without a handshake;
- the queue is inspectable with `ls` and `cat`;
- there is no port to collide with, and no token to leak;
- it works on Linux, macOS and Windows through the same `fs` API.

The supervisor is the only writer of a job record while it owns the job. The plugin is the only
writer of the notification ledger in OpenCode storage. That keeps the two state machines apart.

### Security

- The existing `fleet.run` / `fleet.exec` / `shell` approvals happen before the request is written.
  The supervisor cannot be used to bypass a permission; it only runs an argv the plugin approved.
- The state directory is 0700 and files are 0600. Request files contain environment values and the
  SSH agent socket, and are deleted immediately after the claim.
- No environment is copied into job records or logs. The log names job ids and states only.
- No new network listener exists. The supervisor is reachable only through the user's state
  directory, i.e. the same trust domain as the user's shell.
- The service passes only `SSH_AUTH_SOCK`, `SSH_AGENT_PID`, `FLEET_AGENT_PATH` and `FLEET_SSH_PATH`
  through the request; all are validated before use.

### Non-goals

- Surviving a machine reboot, or a systemd stop of the OpenChamber service (its cgroup kills the
  detached process). Those remain honest `interrupted` cases.
- Reattaching to a remote job after SSH loss. The agent is still spawned per connection; a remote
  daemon is a separate ADR.
- A user-facing sync or job switch. The agent decides; the human configures hosts and approvals.
- Detached mode for the npm-only plugin without the OpenChamber extension service. It falls back to
  the runtime-bound implementation.

## Alternatives rejected

- **Supervisor inside the extension service:** simpler, but it dies whenever the service is
  restarted (extension update, service crash). It also makes the service's request loop responsible
  for long-running work it cannot isolate.
- **Supervisor spawned by the OpenCode plugin:** the compiled Bun runtime has no reliable
  `node`/`bun` executable to hand a script to. The extension service exists precisely to provide
  the app runtime.
- **Remote-side detached jobs:** best survival (local machine can sleep or shut down), but it
  needs a remote job supervisor, a reattach protocol, lease renewal across controller restarts and
  a new remote log contract. It is a larger semantic change and belongs in its own ADR.
- **A local HTTP/Unix socket daemon:** more moving parts for the same guarantees; a file spool is
  sufficient at the tens-of-jobs scale Fleet targets.

## Testing

- `job-store` unit tests: atomic writes, validation, retention, request claiming, stale locks,
  boot-time detection.
- `SupervisorCore` unit tests with a fake executor: start, progress, terminal, cancel, restart
  recovery, pending-request recovery, max-active refusal.
- Process integration: spawn the built supervisor with a throwaway state root, observe discovery,
  write a request that fails fast, assert the terminal record, send SIGTERM, assert cleanup.
- Service launcher tests: pointer/heartbeat, ensure/reuse, stale lock, `FLEET_SUPERVISOR=off`.
- Plugin tests: supervised start, in-process fallback, list/status/cancel after a simulated
  restart, exactly-one notification, interrupted reporting, session deletion.
- Rust agent test: closing the stdio session terminates a running process group.
- Live on `hom-srv-01`: start a 60-second job, kill only the OpenCode runtime process, verify the
  supervisor and job continue, verify the session is woken with the result, then cancel a second job
  after another restart. No failed units; the OpenChamber core path stays unchanged.

## Deployment

- Fleet 0.6.0: extension ZIP, npm tarball, Linux agent binaries.
- Nixfiles pins the merge commit, runs the gate on `mob-nb-01`, pushes the closure to Attic and
  deploys through nod.
- The extension service starts the supervisor; no installer or manifest capability changes.
