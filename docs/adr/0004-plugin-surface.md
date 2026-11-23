# ADR-0004: Five tools, one core, no daemon in the plugin

**Status:** accepted

## Context

OpenCode plugins can add tools through `ctx.tool.transform`. The alternative surfaces were a standalone MCP server, a CLI-only workflow, or a custom
OpenChamber panel.

## Decision

Ship an **OpenCode plugin** that registers exactly five tools, backed by the same core the CLI uses:

| Tool | Why it exists |
|---|---|
| `fleet_status` | the agent must be able to see replicas, revisions and drift before deciding |
| `fleet_sync` | plan first, apply second — never an unconditional mirror |
| `fleet_exec` | the actual work, with timeout and exit code |
| `fleet_fetch` | results, explicitly named |
| `fleet_cancel` | a bounded run that overran must be stoppable |

Rules:

- Tool input is JSON Schema. The plugin is compiled to plain ESM with no runtime dependency on
  OpenCode or Effect, so any OpenCode build that supports `tool.transform` can load it.
- The plugin is a thin adapter: validation, lease, call, format. It contains no transport logic.
- `fleet_sync` defaults to `plan`, not `apply`. A destructive default is a design error.
- `fleet_exec` caps the text it returns to the model (256 KiB) and points at the spill file; the
  full log always exists on disk.
- No daemon, no background watcher, no panel. The plugin does nothing until a tool is called.

## Consequences

- The same functionality is scriptable without an agent (`fleet` CLI) and usable from CI.
- A second editor integration is a small adapter over the CLI, not a rewrite.
- The tool surface is stable enough to document, and small enough to test exhaustively.

## Alternatives rejected

- **MCP server:** requires a running process and a client-specific configuration; the plugin path is
  native to OpenCode and needs none.
- **CLI only:** agents can call a CLI through bash, but then there is no plan/apply contract, no
  lease, and no structured result. The tools make the contract explicit.
- **Custom panel:** UI work that does not change what is possible, only how it looks.
