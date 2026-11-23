/**
 * OpenCode plugin surface over fleet.agent.v1. Four tools, no daemon: each call opens a session,
 * performs one operation and closes it.
 */

import { compileExcludes, loadConfig } from '../config.js';
import type { HostConfig, WorkspaceConfig } from '../config.js';
import { AgentError } from '../v1/errors.js';
import {
  connectSsh,
  execCommand,
  fetchArtifact,
  status,
  syncWorkspace,
} from '../v1/operations.js';

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
  if (typeof alias !== 'string') throw new Error('host is required');
  const host = config.hosts[alias];
  if (!host) throw new Error(`unknown host ${JSON.stringify(alias)}; known: ${Object.keys(config.hosts).join(', ')}`);
  return host;
}

function failure(error: unknown): ToolResult {
  if (error instanceof AgentError) {
    return { content: `${error.code}: ${error.message}${error.retryable ? ' (retryable)' : ''}` };
  }
  return { content: error instanceof Error ? error.message : String(error) };
}

function agentPath(input: Record<string, unknown>): string {
  return typeof input.agentPath === 'string' ? input.agentPath : process.env.FLEET_AGENT_PATH ?? 'fleet-agent';
}

export default {
  id: 'openchamber-fleet',
  async setup(ctx: PluginContext): Promise<void> {
    await ctx.tool.transform((tools) => {
      tools.add({
        name: 'fleet_status',
        description: 'Show the replica generation and recovery state of a host.',
        options: { codemode: false },
        input: {
          type: 'object',
          properties: { host: { type: 'string' } },
          required: ['host'],
          additionalProperties: false,
        },
        async execute(input) {
          try {
            const config = configFromCwd();
            const host = hostOf(config, input);
            const client = await connectSsh(host, { agentPath: agentPath(input) });
            try {
              const info = await status(client, config.name, host.root);
              return { content: `${config.name}@${host.alias}: generation ${info.generation} ${info.manifestDigest}${info.recovery ? ' RECOVERY' : ''}` };
            } finally {
              client.close();
            }
          } catch (error) {
            return failure(error);
          }
        },
      });

      tools.add({
        name: 'fleet_sync',
        description: 'Replicate the workspace to a host. mode=plan shows changes, apply transfers and commits.',
        options: { codemode: false },
        input: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            mode: { type: 'string', enum: ['plan', 'apply'] },
            excludes: {
              type: 'array',
              items: { type: 'string' },
              description: 'Additional excludes for this call, e.g. ["dist/", "target/"]',
            },
            adopt: { type: 'boolean', description: 'Take over an existing unmanaged directory' },
          },
          required: ['host', 'mode'],
          additionalProperties: false,
        },
        async execute(input) {
          try {
            const config = configFromCwd();
            const host = hostOf(config, input);
            const extra = Array.isArray(input.excludes) ? input.excludes.map(String) : [];
            const excludes = [...new Set([...config.excludes, ...extra])];
            const client = await connectSsh(host, { agentPath: agentPath(input) });
            try {
              const result = await syncWorkspace(client, compileExcludes(excludes), {
                workspaceId: config.name,
                source: config.dir,
                root: host.root,
                excludes,
                mode: input.mode === 'apply' ? 'apply' : 'plan',
                adopt: input.adopt === true,
              });
              const lines = [`${host.alias}: ${result.changes.length} change(s) ${result.planDigest}`];
              for (const change of result.changes.slice(0, 40)) lines.push(`  ${change.action} ${change.path}`);
              if (result.generation !== undefined) lines.push(`generation ${result.generation}`);
              return { content: lines.join('\n') };
            } finally {
              client.close();
            }
          } catch (error) {
            return failure(error);
          }
        },
      });

      tools.add({
        name: 'fleet_exec',
        description: 'Run a command in the synced replica on a host and return its output and exit code.',
        options: { codemode: false },
        input: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            argv: { type: 'array', items: { type: 'string' } },
            cwd: { type: 'string' },
            env: { type: 'object', additionalProperties: { type: 'string' } },
            timeoutSeconds: { type: 'number' },
          },
          required: ['host', 'argv'],
          additionalProperties: false,
        },
        async execute(input) {
          try {
            const config = configFromCwd();
            const host = hostOf(config, input);
            const argv = Array.isArray(input.argv) ? input.argv.map(String) : [];
            const timeout = typeof input.timeoutSeconds === 'number' ? input.timeoutSeconds : undefined;
            const env = input.env && typeof input.env === 'object' ? Object.fromEntries(Object.entries(input.env).map(([key, value]) => [key, String(value)])) : {};
            const client = await connectSsh(host, { agentPath: agentPath(input) });
            try {
              const result = await execCommand(client, {
                workspaceId: config.name,
                root: host.root,
                argv,
                cwd: typeof input.cwd === 'string' ? input.cwd : undefined,
                env,
                timeoutMs: timeout === undefined ? undefined : timeout * 1000,
              });
              const header = `exit ${result.exitCode ?? `signal ${result.signal}`} (${host.alias})`;
              const stdout = result.stdout.toString().trimEnd();
              const stderr = result.stderr.toString().trimEnd();
              const body = stdout.length > 0 ? stdout : '(no stdout)';
              const note = stderr.length > 0 ? `\nstderr:\n${stderr}` : '';
              return {
                content: `${header}\n${body}${note}`,
                metadata: { exitCode: result.exitCode, state: result.state, jobId: result.jobId },
              };
            } finally {
              client.close();
            }
          } catch (error) {
            return failure(error);
          }
        },
      });

      tools.add({
        name: 'fleet_fetch',
        description: 'Copy one named artifact from the replica to a local directory, verifying its digest.',
        options: { codemode: false },
        input: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            artifact: { type: 'string' },
            dest: { type: 'string' },
            overwrite: { type: 'boolean' },
          },
          required: ['host', 'artifact', 'dest'],
          additionalProperties: false,
        },
        async execute(input) {
          try {
            const config = configFromCwd();
            const host = hostOf(config, input);
            const client = await connectSsh(host, { agentPath: agentPath(input) });
            try {
              const result = await fetchArtifact(client, {
                workspaceId: config.name,
                root: host.root,
                artifact: String(input.artifact),
                dest: String(input.dest),
                overwrite: input.overwrite === true,
              });
              return { content: `fetched ${result.file} (${result.bytes} bytes) ${result.digest}` };
            } finally {
              client.close();
            }
          } catch (error) {
            return failure(error);
          }
        },
      });
    });
  },
};
