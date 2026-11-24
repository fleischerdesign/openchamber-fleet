# Configuration

Fleet keeps machine definitions and project settings separate:

```text
$XDG_CONFIG_HOME/openchamber-fleet/
  hosts.json                 # SSH targets, shared by projects
  workspaces/<project-id>.json   # project name, selected aliases, excludes
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

Tags are how an agent selects a machine without a UI choice: `fleet_hosts` lists them, and
`fleet_run` accepts `host: "auto"` plus required tags. They describe capability; they are not
authorization.

The registry must define at least one host. Unknown keys are an error. File mode is `0600`.

## Project configuration

A project selects aliases from the registry and owns its excludes and optional replica-root
overrides.

```json
{
  "version": 1,
  "name": "my-project",
  "hosts": ["workstation", "notebook"],
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
| `name` | `^[a-z0-9][a-z0-9._-]*$` | workspace identity; also the default replica directory name |
| `hosts` | string[] | selected host aliases, at least one |
| `roots` | object | optional per-host replica-root overrides |
| `excludes` | string[] | baseline rsync-compatible patterns |
| `env` | object | environment variables passed to remote commands |
| `shell` | string | `bash`, `sh`, `dash` or `zsh` |

Unknown keys are an error. A project must select at least one alias, and every selected alias must
exist in the registry.

## Project identity

The project file is keyed by the repository's `remote.origin.url`, so clones and worktrees share the
same local project settings. Without a git remote, the canonical workspace path is used. Moving a
non-git directory therefore creates a new project identity.

## Resolution order

1. `--config <file>` (legacy full configuration)
2. `FLEET_CONFIG` (legacy full configuration)
3. the split project configuration above
4. `fleet.json` in the workspace (legacy full configuration, until a split project config exists)

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
only adds it to the project; `--force` replaces its SSH target. `fleet init --workspace-file` is the
explicit opt-in for the legacy file and writes it at the workspace root.

The OpenChamber panel saves the split format locally and never writes to the repository. It loads
both documents independently, so a new project keeps the existing host registry and a project with a
missing host remains editable. A save carries the revision it loaded; a stale save is refused instead
of overwriting a concurrent change. Removing a host that another project still selects is refused.

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
