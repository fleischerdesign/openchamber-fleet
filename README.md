# openchamber-fleet

Run an OpenCode/OpenChamber agent's work on a machine that has the cores, while the session
stays where it is.

`openchamber-fleet` gives an agent three primitives over plain SSH:

- **replicate** a workspace to a remote machine, digest-based and cache-preserving;
- **execute** a command inside that replica, with a deterministic environment and a real timeout;
- **fetch** the declared results back.

It is an [OpenCode plugin](https://opencode.ai/docs/plugins/) and a CLI. The plugin has no runtime
dependencies; the only things it needs on either end are `ssh` and `rsync`.

## Why

A session's tools run where the session runs. When that machine is an always-on box with four
cores, a Rust build or a browser test suite is the wrong thing to run there — but moving the
session to the workstation breaks session continuity, and a second runtime fragments it.

Replication keeps one session, one workspace of record, and still lets the expensive command run
on the machine that should run it.

## Status

Version 0.1.0. The repository is public and CI is green on Node 22 and 24; the npm package is
not published yet, so install from the repository for now.

## Quickstart

```bash
# install from the repository (npm publish is the next step)
git clone https://github.com/fleischerdesign/openchamber-fleet
cd openchamber-fleet && npm ci && npm run build && npm link

# in the project you want to offload work from
fleet init --host workstation --ssh philipp@10.10.100.20

# check ssh, rsync and the remote wrappers on both ends
fleet doctor

# see what would change on the node, then make it match
fleet sync --host workstation --plan
fleet sync --host workstation --apply

# run the expensive command there
fleet exec --host workstation -- cargo test --all-features

# bring the results back
fleet fetch --host workstation --dest ./artifacts -- target/debug/my-binary
```

The same three steps are exposed to an agent as `fleet_sync`, `fleet_exec` and `fleet_fetch`.

Excludes are never guessed from the project type. A plan names generated output it is about to
replicate; the caller passes `--exclude dist/,build/` (or `excludes` on the tool call), and that set
is recorded with the replica so later verifies use it.

## Guarantees

- **One writer.** Replication is one-way, canonical → replica. There is no merge and no bidirection
  sync, so conflicts cannot exist.
- **No stale execution.** `fleet exec` refuses to run when the replica is not at the canonical
  revision, unless `--allow-stale` is passed explicitly.
- **Caches survive.** Excluded paths (`target/`, `node_modules/`, `.direnv`) are never transferred
  and never deleted.
- **No silent fallback.** An unreachable node fails; the command never quietly runs locally.
- **Resumable.** An interrupted sync never leaves a replica marked current.
- **Deterministic environment.** Commands never inherit the caller's environment; only the
  declared variables and a fixed base are visible.

## Requirements

- Controller: Node.js ≥ 22 (Node 20 is end-of-life and lacks the test runner glob).
- Node: `ssh`, `rsync` ≥ 3.1, `bash`, `base64`.
- SSH key authentication. Host keys are verified (`StrictHostKeyChecking=yes`); there is no
  password fallback and no `known_hosts` bypass.

## Platform notes

- Linux (glibc or musl) and NixOS need `openssh`, `rsync` >= 3.1 and coreutils; `fleet doctor`
  names what is missing and how to install it.
- macOS ships `openrsync` as `/usr/bin/rsync`, which does not implement the flags this tool uses.
  Install GNU rsync: `brew install rsync`.
- Windows is not supported natively; WSL is untested.

## What it is not

No daemon on the node, no distributed filesystem, no scheduler, no bidirectional sync, no
Windows-native support. Those are deliberate omissions; see `docs/design.md` and the ADRs.

## Documentation

| Document | Purpose |
|---|---|
| [`docs/design.md`](docs/design.md) | invariants, components, state machine |
| [`docs/edge-cases.md`](docs/edge-cases.md) | the numbered catalogue every test refers to |
| [`docs/security.md`](docs/security.md) | trust boundary, credentials, audit |
| [`docs/config.md`](docs/config.md) | `fleet.json` reference |
| [`docs/cli.md`](docs/cli.md) | command and exit-code reference |
| [`docs/adr/`](docs/adr/) | the decisions, with the alternatives that lost |
| [`docs/test-coverage.md`](docs/test-coverage.md) | which edge case is proven by which test |

## Development

```bash
nix develop        # Node, TypeScript, rsync, OpenSSH
npm ci
npm run build      # tsc -> dist/
npm test           # unit, property and integration tests
npm run typecheck  # tsc --noEmit
```

The integration tests use a fake SSH transport that runs the remote command locally, so the real
`rsync` semantics are exercised without a second machine.

## License

MIT.
