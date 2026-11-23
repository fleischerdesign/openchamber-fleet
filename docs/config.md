# Configuration

One file, `fleet.json`, at the root of the workspace. It is required: a directory without it is not
a fleet workspace. Unknown keys are an error, not a warning — a typo must never silently disable a
protection.

## Example

```json
{
  "name": "my-project",
  "hosts": {
    "workstation": {
      "ssh": "philipp@10.10.100.20",
      "port": 22,
      "root": "~/.cache/openchamber-fleet/my-project"
    },
    "notebook": {
      "ssh": "philipp@10.10.100.30"
    }
  },
  "excludes": ["target/", "node_modules/", ".direnv/", "dist/"],
  "env": {
    "CARGO_TERM_COLOR": "never",
    "RUST_BACKTRACE": "1"
  }
}
```

## Keys

| Key | Type | Required | Meaning |
|---|---|---|---|
| `name` | string, `^[a-z0-9][a-z0-9._-]*$` | yes | workspace identity; part of the default replica path and of state keys |
| `hosts` | object of host definitions | yes, ≥ 1 | where work may run |
| `excludes` | array of strings | no, default `[]` | rsync exclude patterns, also used by the revision walk |
| `env` | object of string → string | no, default `{}` | variables visible to executed commands |
| `shell` | string | no, default `bash` | interpreter for `fleet exec --shell` |

### Host definition

| Key | Type | Required | Meaning |
|---|---|---|---|
| `ssh` | string `user@host` | yes | target; validated against `^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$` |
| `port` | integer 1–65535 | no, default 22 | SSH port |
| `root` | string, absolute or `~/…` | no | replica root; default `~/.cache/openchamber-fleet/<name>`; `/`, system directories and the home directory are refused |

A host alias is a local label. Renaming it changes state keys; nothing else.

## Excludes

`excludes` is the project baseline. A sync call may add patterns with `--exclude` (CLI) or
`excludes` (tool); the union is used for that transfer and recorded with the replica, so a later
`verify` and `exec` judge the replica against the set it was synced with. Nothing is guessed from
the project type: a plan names generated output that would be replicated, and the caller decides.

Patterns use rsync's interpretation for the subset we support, and the same patterns are passed to
rsync verbatim:

| Pattern | Matches |
|---|---|
| `target/` | any directory named `target`, at any depth |
| `/dist` | `dist` at the workspace root only |
| `*.log` | any file or directory whose basename matches, at any depth |
| `build/**` | everything under a root-level `build` |
| `**/tmp/` | any directory named `tmp` at any depth |

The walker and rsync must agree; `U-05`–`U-08` pin the semantics. A pattern that is not in this
subset is rejected at config load rather than silently misinterpreted.

## Environment

Only the keys in `env` are visible to a command, in addition to the fixed base:

```
HOME  PATH  LANG=C.UTF-8  TZ=UTC  UMASK=0022
```

`PATH` is a fixed value (`/run/current-system/sw/bin:/usr/local/bin:/usr/bin:/bin`); a command that
needs more must set it through `env`. This is deliberate: inheriting the controller's `PATH` is how one machine's
toolchain silently leaks into another's build.

## Defaults that matter

- Deletion is **on** (`sync --apply` mirrors the canonical tree), but excluded paths are never
  deleted.
- `fleet exec` refuses to run on a stale replica. `--allow-stale` opts out per call and is printed
  in the run record.
- Output returned to a model is capped at 256 KiB; the full log is always in the state directory.
