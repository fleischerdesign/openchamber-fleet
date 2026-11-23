/**
 * OpenCode plugin surface. Five tools, no dependencies, no daemon: the core does the work.
 *
 * The plugin is compiled to plain ESM, so it loads in the Bun runtime OpenCode uses and in Node.
 */

import { loadConfig } from '../config.js';
import type { HostConfig, WorkspaceConfig } from '../config.js';
import { FleetError, formatError } from '../errors.js';
import { cancelRun, execRemote } from '../exec.js';
import { fetchArtifacts } from '../fetch.js';
import { buildOutputHints } from '../presets.js';
import { statusReport } from '../status.js';
import { applyWorkspace, planWorkspace, verifyWorkspace } from '../sync.js';

interface ToolResult { content: string; metadata?: Record<string, unknown> }
interface ToolDefinition {
  name: string;
  description: string;
  options?: { codemode: boolean };
  input: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<ToolResult>;
}
interface ToolList { add: (tool: ToolDefinition) => void }
interface PluginContext { tool: { transform: (edit: (tools: ToolList) => void | Promise<void>) => Promise<void> } }

function configFromCwd(): WorkspaceConfig {
  return loadConfig(process.cwd());
}

function hostOf(config: WorkspaceConfig, input: Record<string, unknown>): HostConfig {
  const alias = input.host;
  if (typeof alias !== 'string') throw new FleetError('usage', 'host is required');
  const host = config.hosts[alias];
  if (!host) {
    throw new FleetError('usage', `unknown host ${JSON.stringify(alias)}`, { known: Object.keys(config.hosts).join(', ') });
  }
  return host;
}

function failure(error: unknown): ToolResult {
  return { content: formatError(error) };
}

function formatPlan(alias: string, result: { entries: { action: string; path: string }[]; digest: string }): string {
  const lines = [`${alias}: ${result.entries.length} change(s) ${result.digest}`];
  for (const entry of result.entries.slice(0, 40)) lines.push(`  ${entry.action} ${entry.path}`);
  if (result.entries.length > 40) lines.push(`  … ${result.entries.length - 40} more`);
  return lines.join('\n');
}

export default {
  id: 'openchamber-fleet',
  async setup(ctx: PluginContext): Promise<void> {
    await ctx.tool.transform((tools) => {
      tools.add({
        name: 'fleet_status',
        description: 'Show declared hosts, the canonical revision, replica state and any running lease.',
        options: { codemode: false },
        input: {
          type: 'object',
          properties: { check: { type: 'boolean', description: 'Re-verify over SSH instead of trusting recorded state' } },
          additionalProperties: false,
        },
        async execute(input) {
          try {
            const config = configFromCwd();
            const report = await statusReport(config, { check: input.check === true });
            const lines = [`workspace ${report.workspace} at ${report.revision}`];
            for (const host of report.hosts) {
              lines.push(`${host.alias}: ${host.state}${host.lease ? ` (run ${host.lease.runId})` : ''}${host.changes === undefined ? '' : ` — ${host.changes} change(s)`}`);
            }
            return { content: lines.join('\n') };
          } catch (error) {
            return failure(error);
          }
        },
      });

      tools.add({
        name: 'fleet_sync',
        description: 'Replicate the workspace to a host. mode=plan shows changes, apply transfers and verifies.',
        options: { codemode: false },
        input: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            mode: { type: 'string', enum: ['plan', 'apply', 'verify'] },
            content: { type: 'boolean', description: 'Compare file contents, not just size and mtime' },
          },
          required: ['host', 'mode'],
          additionalProperties: false,
        },
        async execute(input) {
          try {
            const config = configFromCwd();
            const host = hostOf(config, input);
            const mode = input.mode;
            const checksum = input.content === true;
            if (mode === 'apply') {
              const result = await applyWorkspace(config, host, { checksum });
              return { content: `applied ${result.applied} change(s) to ${host.alias}\n${result.plan.revision}` };
            }
            if (mode === 'verify') {
              const result = await verifyWorkspace(config, host, { checksum });
              return {
                content: result.entries.length === 0
                  ? `${host.alias}: replica matches ${result.revision}`
                  : formatPlan(host.alias, { entries: result.entries, digest: '' }),
              };
            }
            if (mode !== 'plan') throw new FleetError('usage', 'mode must be plan, apply or verify');
            const plan = await planWorkspace(config, host, { checksum });
            const hints = buildOutputHints(plan.entries);
            const note = hints.length > 0
              ? `\nnote: generated output would be replicated: ${hints.join(', ')} — add it to excludes if a build produces it`
              : '';
            return { content: formatPlan(host.alias, plan) + note };
          } catch (error) {
            return failure(error);
          }
        },
      });

      tools.add({
        name: 'fleet_exec',
        description: 'Run a command in the synced replica on a host. Refuses to run on a stale replica unless allowStale.',
        options: { codemode: false },
        input: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            command: { type: 'string', description: 'Shell string, run through the configured shell' },
            argv: { type: 'array', items: { type: 'string' }, description: 'Argument vector; preferred over command' },
            timeoutSeconds: { type: 'number' },
            allowStale: { type: 'boolean' },
          },
          required: ['host'],
          additionalProperties: false,
        },
        async execute(input) {
          try {
            const config = configFromCwd();
            const host = hostOf(config, input);
            const argv = Array.isArray(input.argv) ? input.argv.map(String) : undefined;
            const command = typeof input.command === 'string' ? input.command : undefined;
            const timeout = typeof input.timeoutSeconds === 'number' ? input.timeoutSeconds : undefined;
            const result = await execRemote({
              config,
              host,
              argv,
              shell: command,
              timeoutMs: timeout === undefined ? undefined : timeout * 1000,
              allowStale: input.allowStale === true,
            });
            const header = `exit ${result.exitCode} in ${(result.durationMs / 1000).toFixed(1)}s (${host.alias})`;
            const text = result.output.trimEnd();
            const body = text.length > 0 ? text : '(no stdout)';
            const note = result.truncated ? `\n… truncated; full log: ${result.logPath}` : '';
            return { content: `${header}\n${body}${note}`, metadata: { exitCode: result.exitCode, runId: result.runId } };
          } catch (error) {
            return failure(error);
          }
        },
      });

      tools.add({
        name: 'fleet_fetch',
        description: 'Bring named artifacts from the replica to a local directory.',
        options: { codemode: false },
        input: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            paths: { type: 'array', items: { type: 'string' } },
            dest: { type: 'string' },
            overwrite: { type: 'boolean' },
            verify: { type: 'boolean' },
          },
          required: ['host', 'paths', 'dest'],
          additionalProperties: false,
        },
        async execute(input) {
          try {
            const config = configFromCwd();
            const host = hostOf(config, input);
            const paths = Array.isArray(input.paths) ? input.paths.map(String) : [];
            const dest = typeof input.dest === 'string' ? input.dest : '';
            const result = await fetchArtifacts({
              config,
              host,
              paths,
              dest,
              overwrite: input.overwrite === true,
              verify: input.verify === true,
            });
            return { content: `fetched ${result.paths.length} path(s), ${result.bytes} bytes` };
          } catch (error) {
            return failure(error);
          }
        },
      });

      tools.add({
        name: 'fleet_cancel',
        description: 'Signal the remote process of a recorded run.',
        options: { codemode: false },
        input: {
          type: 'object',
          properties: { host: { type: 'string' }, runId: { type: 'string' } },
          required: ['host', 'runId'],
          additionalProperties: false,
        },
        async execute(input) {
          try {
            const config = configFromCwd();
            const host = hostOf(config, input);
            const runId = typeof input.runId === 'string' ? input.runId : '';
            await cancelRun(host, runId);
            return { content: `sent SIGTERM for run ${runId}` };
          } catch (error) {
            return failure(error);
          }
        },
      });
    });
  },
};
