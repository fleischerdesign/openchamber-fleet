# openchamber-fleet

Run an OpenCode/OpenChamber agent's work on a machine that has the cores, while the session stays
where it is.

`openchamber-fleet` replicates a workspace to another machine and executes a command there — over
one versioned protocol, spoken to a small Rust agent through SSH stdio. No listener, no daemon, no
rsync, no shell-script transport.

## How it works

```
controller (OpenCode plugin / CLI)          node (any machine with sshd)
        │  fleet.agent.v1 · length-prefixed frames
        ▼
ssh -T host fleet-agent stdio  ────────────▶  agent process
        ├─ workspace.open / lease / generation
        ├─ sync.begin → entries → plan → blobs → commit
        ├─ exec.start → stdout/stderr streams → status/cancel
        └─ artifact.open → stream + digest
```

- **One protocol**, specified in [`protocol/SPEC.md`](protocol/SPEC.md) with state machines in
  [`protocol/STATE.md`](protocol/STATE.md).
- **Node-owned truth**: leases (`flock`), generations, the manifest, the journal and the blob store
  live on the node. The controller cannot fence with local state.
- **Transactional sync**: plan → upload missing blobs → commit; an interrupted transaction is
  `RECOVERY` and blocks new work until it is resolved.
- **Bounded streaming**: stdout, stderr and artifacts are credit-controlled, with an 8 MiB spool and
  explicit end-of-stream frames.
- **Honest outcomes**: a crash yields `unknown`, never a guess; commits record the generation only
  after a clean apply.

## Install

### OpenChamber extension (no Nix)

1. Download `openchamber-fleet-extension-<version>.zip` from the latest GitHub release, or clone this
   repository and use `extensions/openchamber`.
2. In OpenChamber, open **Settings → Extensions** and install the ZIP or folder. Approve the local
   service (`ssh`, `git`) and the OpenCode plugin permission. The extension appears as
   `openchamber-fleet`.
3. On the target machine, install the matching `fleet-agent` release binary, or build it with
   `cargo install --path agent`, and put it on the SSH user's `PATH`. `ssh` and `git` are required
   there.
4. Open the Fleet panel, add the host and project, and use the ten tools from any OpenCode session.
   Normal work uses `fleet_run`: it synchronizes the workspace first when it changed, then executes.

The extension bundles the controller and the OpenCode plugin. The `fleet` CLI is optional. A ZIP or
folder install runs from OpenChamber's writable extension catalog and needs no Nix.

### CLI (optional)

```bash
# release tarball; or: npm ci && npm run build && npm link
npm install -g ./openchamber-fleet-<version>.tgz

# in the project: writes the local host registry + project configuration,
# never a file in the repository
fleet init --host workstation --ssh philipp@10.10.100.20

fleet run --host workstation -- cargo test --all-features
fleet run --host auto --tag linux -- cargo test --all-features
fleet sync --host workstation --plan
fleet fetch --host workstation --dest ./out -- target/release/app

# projectless: explicit scratch, no project config
fleet run --scratch --host workstation -- uname -a
fleet upload ./report.md --host workstation --to report.md
fleet download report.json --host workstation --dest ./report.json --scratch
```

`fleet run` synchronizes first (default `--sync auto`), then executes. `fleet exec` is the low-level
variant when the replica is intentionally current. `--scratch` selects a private per-session remote
space without a source tree or manifest. Uploads go only into scratch; downloads can read scratch or
the replica. The agent-facing tools are `fleet_run`, `fleet_sync`, `fleet_exec`, `fleet_fetch`,
`fleet_upload`, `fleet_download`, `fleet_hosts`, `fleet_status`, `fleet_jobs`, `fleet_job_status`,
`fleet_job_cancel` and `fleet_recover`.

### Nix (optional)

```bash
nix profile install github:fleischerdesign/openchamber-fleet#fleet-agent
nix profile install github:fleischerdesign/openchamber-fleet#controller
```

The flake also exposes `packages.<system>.extension`, the portable package for declarative runtime
installs.

## OpenCode and OpenChamber

The repository builds three artifacts from one controller core:

- the `fleet` CLI/library,
- a dependency-free OpenCode V2 plugin (`openchamber-fleet/plugin`),
- a complete OpenChamber extension in [`extensions/openchamber`](extensions/openchamber).

The extension contributes native tool cards/tables, a project configuration panel, a read-only Work
Status section and the OpenCode plugin. It is a normal runtime extension: install it from Settings →
Extensions and approve the declared service and plugin permissions. The panel edits the same local
XDG configuration as the CLI: hosts are machine-level, projects only state requirements and own
excludes; an allowlist is optional. Nothing is written to the repository. It uses only public
OpenChamber SDK and OpenCode plugin APIs; Nix is an optional packaging path, not a runtime
requirement.

A chat without a project uses OpenChamber's internal chat-data directory. Fleet then falls back to a
configured **default workspace** (`fleet default /path/to/project`); the status section names it and
the tools operate on that project. A real project without Fleet configuration still reports that it
is unconfigured; it never silently borrows another project. No `fleet.json` is required.

Without OpenChamber, install the npm package and add `openchamber-fleet/plugin` to OpenCode's plugin
list. That path provides the ten tools and the CLI, but not the OpenChamber panel or status section.

`fleet_run` and `fleet_exec` accept `background: true`. The tool returns a `jobId`, the agent can end
its turn, and the plugin resumes the same session through OpenCode's official `session.synthetic` API
when the job finishes. `fleet_jobs` lists the session's jobs; `fleet_job_status` and
`fleet_job_cancel` inspect and cancel them. A terminal job whose notification was not delivered is
re-notified once after a plugin restart.

When the OpenChamber extension service is available, background jobs run in a **detached local
supervisor**, not in the OpenCode plugin runtime. The service launches it with the app runtime; it
owns the SSH connection and writes atomic records under `~/.local/state/openchamber-fleet`. An
OpenCode runtime restart or plugin reload therefore leaves the job running, and the next plugin
instance resumes the session when it finishes. The supervisor holds no listener and needs no new
credential. On an OpenChamber service stop or machine reboot it is gone, and the job is reported as
`interrupted`; the remote agent kills its process group when the SSH session closes, so no orphan is
left behind.

Without the extension service (the npm-only plugin path), background jobs fall back to the 0.5.0
runtime-bound implementation and report `supervised: false`. `fleet_jobs` and `fleet_job_status` show
which mode a job used. The approval model is unchanged: `fleet.run`/`fleet.exec` and `shell` are
evaluated before the request is written; the supervisor executes only the approved argv.

### Detached job state

```
~/.local/state/openchamber-fleet/
  supervisor.json   discovery and heartbeat
  supervisor.lock   one supervisor per user
  supervisor.log    bounded operator log; no argv or environment
  jobs/<jobId>.json atomic job records
  requests/         start requests, claimed atomically
  cancel/           cancellation requests
```

The directory is `0700`, the files are `0600`. A runtime pointer in the OS temp directory lets the
plugin find the service's state root even if `HOME` differs. `FLEET_STATE_DIR` overrides the root for
tests and advanced setups, and `FLEET_SUPERVISOR=off` keeps jobs runtime-bound. The supervisor stays
resident while the extension service is alive; it exits after the service heartbeat has been gone
for 90 seconds and no job is active.

Permissions follow OpenCode rules: `fleet_run` evaluates the combined sync-and-run descriptor under
`fleet.run` and the exact command under `shell`; raw `fleet_exec` uses `fleet.exec` and `shell`.
Fetch evaluates `edit` and `external_directory`; sync apply/recovery use dedicated `fleet.sync` /
`fleet.recover` actions. Status and sync planning are read-only; `adopt` is apply-only.

Hosts can carry tags in the local host registry, for example `"tags": ["linux", "gpu"]`. The agent
uses `fleet_hosts` to inspect them and `fleet_run` with `host: "auto"` plus tags to select a machine;
there is no per-run switch in the UI.

## Guarantees

- One writer: canonical → replica; conflicts cannot occur.
- A command runs only at the generation the caller expected (`GENERATION_MISMATCH` otherwise).
- Excluded and preserved paths are never deleted; unmanaged files are never touched.
- An unreachable node fails; there is no local fallback.
- A crashed sync leaves the previous generation or `RECOVERY`, never a half-applied tree marked
  current.
- Commands do not inherit the controller's environment; the base is `HOME`, a fixed `PATH`,
  `LANG=C.UTF-8`, `TZ=UTC` plus declared variables.

## Requirements

- OpenChamber ≥ 2.8.0 for the extension; Node.js ≥ 22 for the CLI and the standalone OpenCode plugin.
- Node: `ssh`, `git` and the `fleet-agent` binary. Nothing else — no rsync, no bash wrapper, no service.
- The agent is a Rust binary; the release publishes Linux x86_64/aarch64 builds. On macOS, build it
  from source with `cargo install --path agent` (or `cargo install --git
  https://github.com/fleischerdesign/openchamber-fleet fleet-agent`).
- Linux is tested; macOS is expected to work (Unix APIs only); Windows is unsupported.
- SSH key authentication, host keys verified (`StrictHostKeyChecking=yes`).

## Status

v1 is implemented end to end in this repository: protocol, Rust agent, TypeScript controller, CLI,
OpenCode plugin and OpenChamber runtime extension. The test suite covers two controllers, recovery
after a dead controller, agent kills at transaction boundaries, disk full, cancellation, the
negotiated frame size and the packaged extension surface. The extension is installed and exercised
live as a runtime extension in the Nixfiles fleet; the remaining rows in
[`docs/test-coverage.md`](docs/test-coverage.md) stay the public coverage ledger.

## Documentation

| Document | Purpose |
|---|---|
| [`protocol/SPEC.md`](protocol/SPEC.md) | normative wire contract |
| [`protocol/STATE.md`](protocol/STATE.md) | state machines and crash windows |
| [`docs/design.md`](docs/design.md) | invariants and component boundaries |
| [`docs/edge-cases.md`](docs/edge-cases.md) | the catalogue the tests refer to |
| [`docs/security.md`](docs/security.md) | trust boundary, grants, audit |
| [`docs/config.md`](docs/config.md) | host registry and project selection |
| [`docs/cli.md`](docs/cli.md) | commands and exit codes |
| [`docs/test-coverage.md`](docs/test-coverage.md) | which claim is proven where |
| [`docs/benchmarks.md`](docs/benchmarks.md) | measured large-workspace numbers |
| [`docs/adr/`](docs/adr/) | decisions with rejected alternatives |

## Development

```bash
nix develop          # Node, Rust, OpenSSH
npm ci && npm run build
cargo test --manifest-path agent/Cargo.toml
npm test             # TypeScript tests; set FLEET_AGENT_BIN to the built agent
```

## License

MIT.
