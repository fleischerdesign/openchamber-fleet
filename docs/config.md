# Configuration

Fleet keeps machine definitions and project settings separate:

```text
$XDG_CONFIG_HOME/openchamber-fleet/
  hosts.json                 # machines: SSH targets and tags, shared by projects
  workspaces/<project-id>.json   # project requirements, roots and excludes
  defaults.json              # optional: project used by projectless chats
```

`XDG_CONFIG_HOME` defaults to `~/.config`. `FLEET_CONFIG_DIR` or `--config-dir` can override the
root. Nothing is written to the repository.

## Host registry

`hosts.json` contains connection data only. A host is reusable across projects.

```json
{
  "version": 1,
  "hosts": {
    "workstation": { "ssh": "philipp@10.10.100.20", "port": 22, "tags": ["linux", "gpu"] },
    "notebook": { "ssh": "philipp@10.10.100.30" }
  }
}
```

| Key | Type | Meaning |
|---|---|---|
| `version` | `1` | configuration format |
| `hosts.<alias>.ssh` | `user@host` | required |
| `hosts.<alias>.port` | integer | default 22 |
| `hosts.<alias>.tags` | string[] | optional capabilities such as `linux`, `gpu`, `large`; lowercase identifiers, at most 20 |
| `hosts.<alias>.allow` | string[] | optional operations: `workspace`, `scratch`, `transfer`; omitted means all, an explicit empty array denies all |

Tags are how an agent selects a machine without a UI choice: `fleet_hosts` lists them, and
`fleet_run` accepts `host: "auto"` plus required tags. They describe capability; they are not
authorization. `allow` is controller-side policy: a host can be scratch-only or transfer-only
without becoming a sync target. The operations are independent: `workspace` covers sync, status and
workspace execution; `scratch` covers scratch execution/status; `transfer` covers upload and
download. A host that may only receive files therefore needs `transfer`, while a scratch-only host
needs `scratch` and, for uploads, `transfer`. It is not a sandbox — an allowed `exec` still runs with
the SSH user's full rights. Omitting `allow` keeps the compatibility default of every operation; an
explicit empty array denies every operation.

The registry must define at least one host. Unknown keys are an error. File mode is `0600`.

## Project configuration

Machines belong to the host registry, not to a project. A project describes what it needs and owns
its excludes and optional replica-root overrides.

A project file is **optional**. Without one, Fleet derives a safe workspace from the project
directory and the global registry:

- `label` is the directory name; the stable workspace id adds a hash of the project identity and
  the canonical checkout path, so two checkouts with the same name get separate replicas.
- all registry hosts are candidates; `hosts`/`requires` only exist when the user adds a file.
- excludes are `.git`, `.direnv/` and `result*`.
- the default replica root is `~/.cache/openchamber-fleet/<workspace-id>`.

Saving the derived configuration from the panel writes `scope: "checkout"`: the settings file is
still shared by clones, but each checkout computes its own replica id and root. `fleet init` on a
derived project persists the same checkout scope and the derived excludes. Pass `--scope name` to
`fleet init` when the project deliberately wants one shared replica id across checkouts. An existing
explicit scope is preserved; a later panel save cannot silently switch it.

```json
{
  "version": 1,
  "name": "my-project",
  "requires": ["linux"],
  "roots": {
    "notebook": "/home/philipp/replicas/my-project"
  },
  "excludes": ["target/", "node_modules/", ".direnv/"],
  "env": {},
  "shell": "bash"
}
```

| Key | Type | Meaning |
|---|---|---|
| `name` | `^[a-z0-9][a-z0-9._-]*$` | display/name identity; a name-scoped file also uses it as replica id |
| `scope` | `name` \| `checkout` | optional; `checkout` keeps replica id per working tree while settings stay shared |
| `hosts` | string[] | optional allowlist; omitted means every host in the registry |
| `requires` | string[] | optional capabilities; a host must carry every listed tag |
| `roots` | object | optional per-host replica roots; under `checkout` scope each value is a **base** and the derived workspace id is appended |
| `excludes` | string[] | baseline rsync-compatible patterns |
| `env` | object | environment variables passed to remote commands |
| `shell` | string | `bash`, `sh`, `dash` or `zsh` |

Host selection is the intersection of the two optional filters:

1. Start with `hosts` when present, otherwise with every registry host.
2. Keep only hosts that carry every tag in `requires`.
3. At least one host must remain.

`hosts` is an escape hatch, not the normal way to describe a project. It is useful when a project
must run on one specific machine. An explicit alias must exist in the registry and must satisfy
`requires`; an empty array is an error (omit the key to use every host). `roots` may only name a
host that survives the selection. `requires` is the preferred restriction: it says what the work
needs, so a machine added later with the same tags becomes eligible without editing the project.

`fleet init` registers the machine globally and writes no `hosts` allowlist for a new project, so
the project follows the registry. Migrating a legacy `fleet.json` preserves its explicit host list,
and `fleet init` in a project that already has an allowlist adds the named machine to it.

Adding a host to the registry extends every project without an allowlist; a project with one is
unchanged. Removing a host is refused while another project names it in `hosts` or `roots`;
implicit projects simply follow the remaining registry. Changing a tag is a global capability
change: a project whose `requires` no longer matches any host fails with an error naming the
missing tags.

Unknown keys are an error.

## Project identity

The project settings file is keyed by the repository's `remote.origin.url`, so clones and worktrees
share the same local project settings. Without a git remote, the canonical workspace path is used.
Moving a non-git directory therefore creates a new settings identity. A derived replica id also
includes the canonical checkout path, so two checkouts never share a replica by accident. A file
written from a derived configuration records `scope: "checkout"` and keeps that guarantee. An
explicit `fleet init --scope name` file uses its `name` and remains opt-in sharing.

The remote URL is a grouping heuristic, not a global repository identity: SSH and HTTPS spellings of
the same repository do not share settings, and identical relative URLs can collide. A change to
`origin` changes the settings identity; a move with the same `origin` keeps the settings but not the
derived replica. Use `--scope name` when a team intentionally wants one identity across checkouts.

## Default workspace for projectless chats

OpenChamber can open a chat without a project. Its location is then an internal chat-data
directory, not a repository. Fleet uses `defaults.json` for that case:

```json
{
  "version": 1,
  "directory": "/home/philipp/dev/nixfiles"
}
```

```bash
fleet default /home/philipp/dev/nixfiles   # set it
fleet default                              # show it
fleet default --clear                      # remove it
```

The default is a real project directory; Fleet loads that project's normal split or derived
configuration. It is consulted **only** for OpenChamber internal chat directories. A real project
without Fleet configuration derives its own workspace instead of borrowing another project.
`fleet_hosts` and `fleet_jobs` also work in a projectless chat without a default.

`fleet.json` is not part of this. It remains a legacy fallback for old checkouts and is never
written by `fleet init`.

## Scratch and ad-hoc transfers

A projectless chat can run without any workspace by selecting an explicit scratch target. Scratch is
a private remote directory per session, not a replica:

```text
~/.cache/openchamber-fleet/scratch/<session-hash>
```

It has no source tree and no normal sync lifecycle; the agent still records an empty manifest and
generation 0 as workspace state. Upload a file into scratch, run a command there, then download the
result. The same `scratch` id is stable for the session. A command may still access absolute paths
such as `/tmp`; scratch is the safe default working directory, not a sandbox. The agent's
`transfer.put` is a root-relative file write; "uploads only into scratch" is enforced by the CLI and
plugin, not by a separate agent identity. Scratch persists until its directory and agent state are
removed; there is no automatic quota or garbage collection in this release.

```text
fleet upload ./report.md --host workstation --to report.md
fleet run --scratch --host workstation -- python report.py
fleet download result.json --host workstation --dest ./result.json --scratch
```

Transfers are limited to one regular file. Directories, symlinks, devices, FIFOs and sockets are
refused. Each transfer verifies a SHA-256 digest, writes atomically, does not overwrite by default,
and streams in bounded memory. Uploads are accepted only for scratch; downloads can read scratch or
an existing replica. A transfer into a replica root is outside the sync manifest and therefore not
tracked by the next workspace sync.

The workspace's `status`, `sync plan`, `sync inspect`/recovery inspection and `fetch` paths are
read-only. A plan is a read-only preview, works even before the first apply, and never writes a
transaction journal. On a host without a replica these paths report that it does not exist; they
never create a root or a state entry. `sync apply`, an upload and an explicit `run` create the
replica.

## Resolution order

1. `--config <file>` (legacy full configuration)
2. `FLEET_CONFIG` (legacy full configuration)
3. the split project configuration above
4. `fleet.json` in the workspace (legacy full configuration, until a split project config exists)
5. for an OpenChamber internal chat directory only: the default project from `defaults.json`

The legacy shape is accepted for migration:

```json
{
  "name": "my-project",
  "hosts": {
    "workstation": {
      "ssh": "philipp@10.10.100.20",
      "port": 22,
      "root": "/home/philipp/replicas/my-project"
    }
  },
  "excludes": ["target/"]
}
```

`fleet init` writes the split format. When a legacy `fleet.json` exists and no split project
configuration does, it migrates instead of replacing: the name, hosts, replica roots, excludes,
environment and shell are preserved. Selecting an alias that already exists in the shared registry
only adds it to the project; `--force` replaces its SSH target but preserves an existing
`allow` list. A legacy alias also inherits the shared allowlist when one exists; if the legacy file
names a different SSH target than the shared registry, loading refuses until `fleet init --force`
migrates the conflict. `fleet init --workspace-file` is the
explicit opt-in for the legacy file and writes it at the workspace root.

The OpenChamber panel saves the split format locally and never writes to the repository. It loads
both documents independently, so a new project keeps the existing host registry and a project with a
missing host remains editable. A save carries the revision it loaded; a stale save is refused instead
of overwriting a concurrent change. Removing a host that another project names in `hosts` or `roots`
is refused. The host list shows whether a project follows the whole registry or an allowlist, which
hosts are eligible for its `requires`, and which explicit entries need attention.

## Excludes

Patterns use the rsync subset the agent implements:

| Pattern | Matches |
|---|---|
| `target/` | any directory named `target`, at any depth |
| `/dist` | `dist` at the workspace root only |
| `*.log` | basenames at any depth |
| `build/**` | everything below a `build` directory |
| `**/tmp/` | any directory named `tmp` at any depth |

A call may add patterns (`--exclude`, or `excludes` on the tool). The union is used for that
transaction and stored with the replica, so the next `exec`/`status` judges it against the set it
was synced with. Nothing is guessed from the project type; a plan names generated output it is about
to replicate, and the caller decides.

Patterns are compiled before `fleet init` or a panel save writes the project. An invalid exclusion
is refused instead of producing a configuration the tools reject on the next read.

## Replica root

The default is `~/.cache/openchamber-fleet/<project-name>`. A per-project `roots` entry overrides it
for one host.

The root must be a dedicated directory. The agent refuses `/`, system directories, the node's home
and any path with fewer than two segments, because commit deletes paths.

## Agent path

`FLEET_AGENT_PATH` (default `fleet-agent`) or `--agent-path` names the binary on the node. It must
be found in the SSH user's `PATH` or given as an absolute path without spaces.
