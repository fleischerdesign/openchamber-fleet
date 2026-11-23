# Configuration

One file, `fleet.json`, at the root of the canonical workspace. Unknown keys are an error.

```json
{
  "name": "my-project",
  "hosts": {
    "workstation": { "ssh": "philipp@10.10.100.20", "port": 22 },
    "notebook": { "ssh": "philipp@10.10.100.30", "root": "/home/philipp/replicas/my-project" }
  },
  "excludes": ["target/", "node_modules/", ".direnv/"]
}
```

| Key | Type | Meaning |
|---|---|---|
| `name` | `^[a-z0-9][a-z0-9._-]*$` | workspace identity; also the default replica directory name |
| `hosts` | object, ≥ 1 | SSH targets |
| `hosts.<alias>.ssh` | `user@host` | required |
| `hosts.<alias>.port` | integer | default 22 |
| `hosts.<alias>.root` | absolute or `~/…` | replica root; default `~/.cache/openchamber-fleet/<name>` |
| `excludes` | string[] | baseline rsync-compatible patterns |

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

## Replica root

The root must be a dedicated directory. The agent refuses `/`, system directories, the node's home
and any path with fewer than two segments, because commit deletes paths.

## Agent path

`FLEET_AGENT_PATH` (default `fleet-agent`) or `--agent-path` names the binary on the node. It must
be found in the SSH user's `PATH` or given as an absolute path without spaces.
