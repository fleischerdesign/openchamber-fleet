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

The same operations are exposed to an agent as `fleet_sync`, `fleet_exec`, `fleet_fetch` and
`fleet_status`.

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

v1 is implemented end to end in this repository: protocol, Rust agent, TypeScript controller, CLI
and plugin. The failure-injection suite (disconnect at every phase, two controllers, agent kill at
transaction boundaries, disk full, output flood) and the live fleet/OpenChamber proof are the
remaining gate before calling it production-ready.

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
