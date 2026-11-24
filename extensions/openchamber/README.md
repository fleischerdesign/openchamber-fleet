# Fleet OpenChamber extension

This folder is a complete OpenChamber extension package. It uses only public OpenChamber SDK and OpenCode plugin APIs.

## Install

- In OpenChamber: Settings → Extensions → install this folder, a release ZIP, or the Git repository subdirectory `extensions/openchamber`.
- In OpenCode without OpenChamber: install `openchamber-fleet/plugin` as a local plugin package, or use the repository's root `./plugin` export.

The extension contributes the Fleet OpenCode plugin, native tool cards/tables, a project configuration panel, and a read-only Work Status section. It does not patch OpenChamber or OpenCode and does not require Nix.

## Configuration

Hosts are machine-level and shared by projects. A project selects aliases and owns its excludes:

```text
$XDG_CONFIG_HOME/openchamber-fleet/
  hosts.json
  workspaces/<project-id>.json
```

Use `fleet init --host workstation --ssh philipp@10.10.100.20` or edit both documents in the
extension panel. Nothing is written to the repository. The panel can check status, show a sync plan,
and inspect recovery state. Apply, exec, fetch, cancel, and recover remain explicit agent tools with
OpenCode permission checks.

## Background jobs

`fleet_exec` accepts `background: true`. It returns a `jobId` and the agent can end its turn. When the job reaches a terminal state, the plugin uses OpenCode's official `session.synthetic` API with `resume: true` to wake the same session. `fleet_job_status` and `fleet_job_cancel` inspect and cancel those jobs.

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
