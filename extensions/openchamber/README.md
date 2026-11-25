# Fleet OpenChamber extension

This folder is a complete OpenChamber extension package. It uses only public OpenChamber SDK and OpenCode plugin APIs.

## Install

Prerequisites on the machine Fleet connects to:

- `ssh` and `git` on `PATH`.
- `fleet-agent` on the SSH user's `PATH` (release binary or `cargo install --path agent`).
- A writable replica root.

Then:

- In OpenChamber: Settings → Extensions → install this folder, the release
  `openchamber-fleet-extension-<version>.zip`, or the Git repository subdirectory
  `extensions/openchamber`.
- Approve the local service (`ssh`, `git`) and the OpenCode plugin permission. The extension appears
  as `openchamber-fleet`.
- In OpenCode without OpenChamber: install the `openchamber-fleet` npm package and add
  `openchamber-fleet/plugin` to the plugin list.

The extension contributes the Fleet OpenCode plugin, native tool cards/tables, a project
configuration panel, and a read-only Work Status section. It is a normal runtime extension, does not
patch OpenChamber or OpenCode, and does not require Nix.

## Configuration

Hosts are machine-level and shared by projects. A project selects aliases and owns its excludes:

```text
$XDG_CONFIG_HOME/openchamber-fleet/
  hosts.json
  workspaces/<project-id>.json
```

Use `fleet init --host workstation --ssh philipp@10.10.100.20` or edit both documents in the
extension panel. Nothing is written to the repository. The panel refuses a stale save and a host
removal that another project still selects. The panel is the configuration and observability surface;
the agent runs work through the tools. `fleet_run` synchronizes first when needed, so there is no
user-facing sync toggle. A chat without a project uses OpenChamber's internal chat-data directory; the
status section treats that as “no project selected” instead of asking for Fleet configuration. A real
unconfigured project gets a short hint that the legacy `fleet.json` is not required.

## Agent workflow

- `fleet_run` is the normal execution tool: it synchronizes, runs, and returns a compact result.
- `fleet_hosts` lists aliases and tags; `fleet_run` accepts `host: "auto"` with tags.
- `fleet_jobs` lists the session's background jobs; `fleet_job_status` and `fleet_job_cancel` inspect
  and cancel them.
- `fleet_sync` remains for explicit plan/apply review and destructive changes.
- `fleet_exec` is the low-level no-sync variant.

## Background jobs

`fleet_run` and `fleet_exec` accept `background: true`. They return a `jobId` and the agent can end
its turn. When the job reaches a terminal state, the plugin uses OpenCode's official
`session.synthetic` API with `resume: true` to wake the same session. `fleet_jobs`,
`fleet_job_status` and `fleet_job_cancel` list, inspect and cancel those jobs. A terminal job whose
notification was not delivered is re-notified once after a plugin restart.

The extension service launches a **detached local supervisor** with the app runtime. It owns the
SSH connection and writes atomic records under `~/.local/state/openchamber-fleet`; the plugin writes
start and cancel requests and reads the records. An OpenCode runtime restart, plugin unload or
location eviction therefore leaves the job running, and the new plugin instance resumes the session
when it finishes. The supervisor has no listener and no new credential. It uses the app runtime
(Bun or Electron-as-Node), so no system `node` is required.

If the service is not approved or not running, background jobs fall back to the runtime-bound
implementation and report `supervised: false`; there, an OpenCode restart interrupts the job. Very
long runtime-bound jobs need a project `experimental.location_idle_timeout` large enough for the
expected duration, or `false`.

An OpenChamber service stop or machine reboot removes the supervisor; the next plugin run marks the
job `interrupted` and the remote agent kills its process group when the SSH session closes. The
state directory is `0700` and its files are `0600`; request files carry environment values only
until the supervisor claims them. `FLEET_SUPERVISOR=off` disables the detached path explicitly.

## Security

- `fleet_exec` evaluates OpenCode `shell` permissions for the exact remote argv.
- `fleet_sync` apply and `fleet_recover` use dedicated `fleet.sync` / `fleet.recover` actions.
- `fleet_fetch` evaluates `edit` and, outside the project, `external_directory`.
- Status and sync planning are read-only.
- A configured SSH host is a trust declaration; permissions are not a remote sandbox.

## Build

From the repository root:

```sh
npm ci
npm run build
```

The build refreshes `panel/main.js`, `service/main.js`, and `plugin/dist`. Commit those built assets so folder and Git installs work without running a build inside OpenChamber.
