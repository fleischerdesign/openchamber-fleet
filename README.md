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

## Quickstart

```bash
# once per node: install the agent (Nix, cargo, or a release binary)
nix profile install github:fleischerdesign/openchamber-fleet#fleet-agent

# in the project
fleet init --host workstation --ssh philipp@10.10.100.20

fleet sync --host workstation --plan
fleet sync --host workstation --apply --exclude target/,dist/

fleet exec --host workstation -- cargo test --all-features
fleet fetch --host workstation --dest ./out -- target/release/app
```

The same operations are exposed to an agent as `fleet_sync`, `fleet_exec`, `fleet_fetch`,
`fleet_status`, `fleet_job_status`, `fleet_job_cancel` and `fleet_recover`.

## OpenCode and OpenChamber

The repository builds three artifacts from one controller core:

- the `fleet` CLI/library,
- a dependency-free OpenCode V2 plugin (`openchamber-fleet/plugin`),
- a complete OpenChamber extension in [`extensions/openchamber`](extensions/openchamber).

The extension contributes native tool cards/tables, a project configuration panel, a read-only Work
Status section and the OpenCode plugin. It uses only public OpenChamber SDK and OpenCode plugin APIs;
Nix is an optional packaging path, not a runtime requirement.

`fleet_exec` accepts `background: true`. The tool returns a `jobId`, the agent can end its turn, and
the plugin resumes the same session through OpenCode's official `session.synthetic` API when the job
finishes. `fleet_job_status` and `fleet_job_cancel` manage those jobs. Background jobs are tied to the
running OpenCode runtime; restart, plugin unload and location eviction are reported as interruptions.

Permissions follow OpenCode rules: remote exec evaluates `shell`, fetch evaluates `edit` and
`external_directory`, and sync apply/recovery use dedicated `fleet.sync` / `fleet.recover` actions.
Status and sync planning are read-only.

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

- Controller: Node.js ≥ 22.
- Node: `ssh` and the `fleet-agent` binary. Nothing else — no rsync, no bash wrapper, no service.
- SSH key authentication, host keys verified (`StrictHostKeyChecking=yes`).

## Status

v1 is implemented end to end in this repository: protocol, Rust agent, TypeScript controller, CLI,
OpenCode plugin and OpenChamber extension. The test suite covers two controllers, recovery after a
dead controller, agent kills at transaction boundaries, disk full, cancellation and the packaged
extension surface. The live fleet/OpenChamber proof and the remaining rows in
[`docs/test-coverage.md`](docs/test-coverage.md) are still the gate before calling it production-ready.

## Documentation

| Document | Purpose |
|---|---|
| [`protocol/SPEC.md`](protocol/SPEC.md) | normative wire contract |
| [`protocol/STATE.md`](protocol/STATE.md) | state machines and crash windows |
| [`docs/design.md`](docs/design.md) | invariants and component boundaries |
| [`docs/edge-cases.md`](docs/edge-cases.md) | the catalogue the tests refer to |
| [`docs/security.md`](docs/security.md) | trust boundary, grants, audit |
| [`docs/config.md`](docs/config.md) | `fleet.json` |
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
