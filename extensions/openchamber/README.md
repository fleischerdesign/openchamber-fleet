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
user-facing sync toggle.

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
notification was not delivered is re-notified once after a plugin restart; a job that was still
running is reported as interrupted.

Background jobs are tied to the running OpenCode plugin runtime. An OpenCode restart, plugin unload, or location eviction interrupts them; the plugin reports that honestly from its durable job record. Very long jobs should run with a project `experimental.location_idle_timeout` large enough for the expected duration, or `false`.

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
