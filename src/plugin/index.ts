/** Official OpenCode V2 plugin surface over fleet.agent.v1. */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { compileExcludes, loadConfig } from '../config.js';
import type { HostConfig, WorkspaceConfig } from '../config.js';
import { FleetError, friendlyErrorMessage } from '../errors.js';
import { replicaState } from '../status.js';
import { AgentError } from '../v1/errors.js';
import {
  canonicalArtifactTarget,
  connectSsh,
  execCommand,
  fetchArtifact,
  recoverWorkspace,
  status,
  syncWorkspace,
} from '../v1/operations.js';
import type { ExecProgress, FetchProgress, SyncProgress } from '../v1/operations.js';
import { FleetJobRegistry } from './jobs.js';
import type { PluginContext, StoredJob, ToolContext, ToolDefinition, ToolResult } from './types.js';

const string = { type: 'string' } as const;
const boolean = { type: 'boolean' } as const;
const stringArray = { type: 'array', items: string } as const;

function schema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', properties, required, additionalProperties: false };
}

function output(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return schema(properties, required);
}

function jsonResult(value: unknown, metadata?: Record<string, unknown>): ToolResult {
  return { content: JSON.stringify(value), output: value, metadata };
}

function truncated(value: string, max = 64 * 1024): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n…[truncated]`;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function commandText(argv: string[]): string {
  return argv.map(shellQuote).join(' ');
}

function agentPath(): string {
  return process.env.FLEET_AGENT_PATH ?? 'fleet-agent';
}

async function workspaceOf(ctx: PluginContext, context?: ToolContext): Promise<WorkspaceConfig> {
  let directory = ctx.location?.directory ?? process.cwd();
  const sessionID = context?.sessionID;
  if (sessionID && ctx.session) {
    try {
      const info = await ctx.session.get({ sessionID });
      const value = info?.location?.directory;
      if (typeof value === 'string' && value.startsWith('/')) directory = value;
    } catch {
      // The location or server cwd remains a useful, explicit fallback.
    }
  }
  try {
    return loadConfig(directory);
  } catch (error) {
    if (error instanceof FleetError) {
      throw new AgentError(error.code === 'config-missing' ? 'CONFIG_MISSING' : 'CONFIG_INVALID', [
        error.message,
        error.details?.hint,
      ].filter(Boolean).join(' '));
    }
    throw error;
  }
}

function hostOf(config: WorkspaceConfig, input: Record<string, unknown>): HostConfig {
  const alias = input.host;
  if (typeof alias !== 'string' || alias.length === 0) throw new AgentError('INVALID_REQUEST', 'host is required');
  const host = config.hosts[alias];
  if (!host) {
    throw new AgentError('INVALID_REQUEST', `unknown host ${JSON.stringify(alias)}; known: ${Object.keys(config.hosts).join(', ')}`);
  }
  return host;
}

function sessionIDOf(context?: ToolContext): string {
  if (!context?.sessionID) throw new AgentError('INVALID_REQUEST', 'this operation requires an OpenCode session');
  return context.sessionID;
}

async function assertPermission(
  ctx: PluginContext,
  context: ToolContext | undefined,
  action: string,
  resources: string[],
  metadata: Record<string, unknown>,
  save?: string[],
): Promise<void> {
  if (!ctx.permission) return;
  await ctx.permission.assert({
    sessionID: sessionIDOf(context),
    agent: context?.agent,
    source: { type: 'tool', messageID: context?.messageID, id: context?.id },
    action,
    resources,
    save,
    metadata,
  });
}

function progressReporter(context?: ToolContext): (update: Record<string, unknown>) => Promise<void> {
  let last = 0;
  return async (update) => {
    const now = Date.now();
    if (now - last < 200 && update.phase !== 'done') return;
    last = now;
    await context?.progress?.(update);
  };
}

async function withClient<T>(
  host: HostConfig,
  context: ToolContext | undefined,
  run: (client: Awaited<ReturnType<typeof connectSsh>>) => Promise<T>,
  options: { closeOnAbort?: boolean } = {},
): Promise<T> {
  const client = await connectSsh(host, { agentPath: agentPath() });
  if (context?.signal?.aborted) {
    client.close();
    throw new AgentError('CANCELLED', 'operation cancelled');
  }
  const onAbort = () => client.close();
  if (options.closeOnAbort !== false) context?.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await run(client);
  } catch (error) {
    if (error instanceof AgentError) {
      throw new AgentError(error.code, friendlyErrorMessage(error), error.retryable, error.details);
    }
    throw error;
  } finally {
    context?.signal?.removeEventListener('abort', onAbort);
    client.close();
  }
}

function syncOutput(
  config: WorkspaceConfig,
  host: HostConfig,
  mode: 'plan' | 'apply',
  result: Awaited<ReturnType<typeof syncWorkspace>>,
): Record<string, unknown> {
  const items = result.changes.slice(0, 200);
  return {
    workspace: config.name,
    host: host.alias,
    mode,
    modeLabel: mode === 'apply' ? 'Applied' : 'Planned',
    planDigest: result.planDigest,
    generation: result.generation ?? null,
    manifestDigest: result.manifestDigest ?? null,
    changes: result.changes.length,
    changesTruncated: result.changes.length > items.length,
    needed: result.needed.length,
    items,
  };
}

const STATE_LABELS: Record<string, string> = {
  running: 'Running',
  'cancel-requested': 'Cancelling',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
  unknown: 'Unknown',
};

function stateLabelOf(state: string): string {
  return STATE_LABELS[state] ?? state;
}

function exitLabelOf(exitCode: number | null, signal: number | null, state: string): string {
  if (typeof exitCode === 'number') return `Exit code ${exitCode}`;
  if (typeof signal === 'number') return `Signal ${signal}`;
  if (state === 'running' || state === 'cancel-requested') return 'Still running';
  return 'No exit code';
}

function commandLabelOf(argv: string[]): string {
  const executable = (argv[0] ?? 'command').split('/').pop() || 'command';
  const safe = executable.replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, 48);
  const count = argv.length - 1;
  return count > 0 ? `${safe} · ${count} arg${count === 1 ? '' : 's'}` : safe;
}

function execOutput(
  config: WorkspaceConfig,
  host: HostConfig,
  argv: string[],
  background: boolean,
  result: Awaited<ReturnType<typeof execCommand>>,
): Record<string, unknown> {
  return {
    workspace: config.name,
    host: host.alias,
    argv,
    commandLabel: commandLabelOf(argv),
    background,
    modeLabel: background ? 'Background job' : 'Foreground',
    jobId: result.jobId,
    state: result.state,
    stateLabel: stateLabelOf(result.state),
    exitCode: result.exitCode,
    exitLabel: exitLabelOf(result.exitCode, result.signal, result.state),
    signal: result.signal,
    stdout: truncated(result.stdout.toString('utf8')),
    stderr: truncated(result.stderr.toString('utf8')),
  };
}

function storedJobOutput(record: StoredJob): Record<string, unknown> {
  return {
    workspace: record.workspace,
    host: record.host,
    jobId: record.jobId,
    state: record.state,
    stateLabel: stateLabelOf(record.state),
    exitCode: record.exitCode ?? null,
    exitLabel: exitLabelOf(record.exitCode ?? null, record.signal ?? null, record.state),
    signal: record.signal ?? null,
    startedAt: record.startedAt,
    endedAt: record.endedAt ?? null,
    stdoutBytes: record.stdoutBytes,
    stderrBytes: record.stderrBytes,
    stdoutTail: record.stdoutTail,
    stderrTail: record.stderrTail,
    error: record.error ?? null,
  };
}

export default {
  id: 'openchamber-fleet',
  async setup(ctx: PluginContext): Promise<() => Promise<void>> {
    const registry = new FleetJobRegistry(ctx, agentPath());
    await registry.recoverInterrupted();
    registry.watchSessionDeletion();

    await ctx.tool.transform((tools) => {
      tools.add({
        name: 'fleet_status',
        description: 'Show whether a configured Fleet host is ready, synchronized, or needs recovery.',
        options: { codemode: false },
        input: schema({ host: string }, ['host']),
        output: output({
          workspace: string,
          host: string,
          generation: { type: 'number' },
          manifestDigest: string,
          recovery: boolean,
          statusLabel: string,
          nextStep: string,
        }, ['workspace', 'host', 'generation', 'manifestDigest', 'recovery', 'statusLabel', 'nextStep']),
        async execute(input, context) {
          const config = await workspaceOf(ctx, context);
          const host = hostOf(config, input);
          const info = await withClient(host, context, (client) => status(client, config.name, host.root, context?.signal));
          const state = replicaState(info);
          return jsonResult({
            workspace: config.name,
            host: host.alias,
            generation: info.generation,
            manifestDigest: info.manifestDigest,
            recovery: info.recovery === true,
            statusLabel: state.label,
            nextStep: state.nextStep,
          });
        },
      });

      tools.add({
        name: 'fleet_sync',
        description: 'Plan or apply workspace replication to a configured Fleet host. Use mode=plan before apply when changes need review.',
        options: { codemode: false },
        input: schema({
          host: string,
          mode: { type: 'string', enum: ['plan', 'apply'] },
          excludes: stringArray,
          adopt: boolean,
        }, ['host', 'mode']),
        output: output({
          workspace: string,
          host: string,
          mode: string,
          modeLabel: string,
          planDigest: string,
          generation: { type: ['number', 'null'] },
          manifestDigest: { type: ['string', 'null'] },
          changes: { type: 'number' },
          changesTruncated: boolean,
          needed: { type: 'number' },
          items: { type: 'array', items: schema({ action: string, path: string }, ['action', 'path']) },
        }, ['workspace', 'host', 'mode', 'modeLabel', 'planDigest', 'changes', 'needed', 'items']),
        async execute(input, context) {
          const config = await workspaceOf(ctx, context);
          const host = hostOf(config, input);
          const mode = input.mode === 'apply' ? 'apply' : 'plan';
          const extra = Array.isArray(input.excludes) ? input.excludes.map(String) : [];
          const excludes = [...new Set([...config.excludes, ...extra])];
          if (mode === 'apply') {
            await assertPermission(ctx, context, 'fleet.sync', [`${config.name}@${host.alias}`], {
              workspace: config.name,
              host: host.alias,
              mode,
              excludes,
              adopt: input.adopt === true,
            }, [`${config.name}@${host.alias}`]);
          }
          const progress = progressReporter(context);
          const result = await withClient(host, context, (client) => syncWorkspace(client, compileExcludes(excludes), {
            workspaceId: config.name,
            source: config.dir,
            root: host.root,
            excludes,
            mode,
            adopt: input.adopt === true,
            signal: context?.signal,
            onProgress: (update: SyncProgress) => progress({ ...update, workspace: config.name, host: host.alias }),
          }), { closeOnAbort: false });
          return jsonResult(syncOutput(config, host, mode, result), { host: host.alias, mode, planDigest: result.planDigest });
        },
      });

      tools.add({
        name: 'fleet_exec',
        description: 'Run argv in the synced replica. background=true returns a jobId, ends the turn, and resumes this session automatically when the job finishes.',
        options: { codemode: false, permission: 'shell' },
        input: schema({
          host: string,
          argv: { type: 'array', items: string, minItems: 1 },
          cwd: string,
          env: { type: 'object', additionalProperties: string },
          timeoutSeconds: { type: 'number', minimum: 1 },
          background: boolean,
        }, ['host', 'argv']),
        output: output({
          workspace: string,
          host: string,
          argv: stringArray,
          commandLabel: string,
          background: boolean,
          modeLabel: string,
          jobId: string,
          state: string,
          stateLabel: string,
          exitCode: { type: ['number', 'null'] },
          exitLabel: string,
          signal: { type: ['number', 'null'] },
          stdout: string,
          stderr: string,
        }, ['workspace', 'host', 'argv', 'commandLabel', 'background', 'modeLabel', 'jobId', 'state', 'stateLabel', 'exitLabel']),
        async execute(input, context) {
          const config = await workspaceOf(ctx, context);
          const host = hostOf(config, input);
          if (!Array.isArray(input.argv) || input.argv.length === 0) {
            throw new AgentError('INVALID_REQUEST', 'argv must contain at least one command');
          }
          const argv = input.argv.map(String);
          const timeout = typeof input.timeoutSeconds === 'number' && Number.isFinite(input.timeoutSeconds)
            ? input.timeoutSeconds * 1000
            : undefined;
          const inputEnv = input.env && typeof input.env === 'object'
            ? Object.fromEntries(Object.entries(input.env).map(([key, value]) => [key, String(value)]))
            : {};
          const unsafeEnv = Object.keys(inputEnv).filter((key) => /^(PATH|LD_.*|DYLD_.*|NODE_OPTIONS|PYTHONPATH|BASH_ENV|ENV|GIT_SSH_COMMAND|GIT_ASKPASS|SSH_ASKPASS|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|PERL5OPT|RUBYOPT|PYTHONSTARTUP)$/.test(key));
          if (unsafeEnv.length > 0) {
            throw new AgentError('INVALID_REQUEST', `execution-sensitive environment variables must be declared in the project config: ${unsafeEnv.join(', ')}`);
          }
          const env = { ...config.env, ...inputEnv };
          const cwd = typeof input.cwd === 'string' ? input.cwd : undefined;
          const command = commandText(argv);
          const envDigest = createHash('sha256').update(JSON.stringify(Object.entries(env).sort(([left], [right]) => left.localeCompare(right)))).digest('hex');
          const descriptor = JSON.stringify({ host: host.alias, cwd: cwd ?? '.', envKeys: Object.keys(env).sort(), envDigest, argv });
          const metadata = {
            workspace: config.name,
            host: host.alias,
            argv,
            cwd: cwd ?? '.',
            envKeys: Object.keys(env).sort(),
            background: input.background === true,
          };
          await assertPermission(ctx, context, 'fleet.exec', [descriptor], metadata, [descriptor]);
          await assertPermission(ctx, context, 'shell', [command], metadata, [command]);

          if (input.background === true) {
            const record = await registry.start({
              config,
              host,
              sessionID: sessionIDOf(context),
              argv,
              cwd,
              env,
              timeoutMs: timeout,
              startupSignal: context?.signal,
              agentPath: agentPath(),
            });
            return jsonResult({
              workspace: config.name,
              host: host.alias,
              argv,
              commandLabel: commandLabelOf(argv),
              background: true,
              modeLabel: 'Background job',
              jobId: record.jobId,
              state: record.state,
              stateLabel: stateLabelOf(record.state),
              exitCode: null,
              exitLabel: exitLabelOf(null, null, record.state),
              signal: null,
              stdout: '',
              stderr: '',
            }, { host: host.alias, jobId: record.jobId, background: true });
          }

          const progress = progressReporter(context);
          const result = await withClient(host, context, (client) => execCommand(client, {
            workspaceId: config.name,
            root: host.root,
            argv,
            cwd,
            env,
            timeoutMs: timeout,
            signal: context?.signal,
            onProgress: (update: ExecProgress) => progress({ ...update, workspace: config.name, host: host.alias }),
          }), { closeOnAbort: false });
          return jsonResult(execOutput(config, host, argv, false, result), {
            host: host.alias,
            jobId: result.jobId,
            exitCode: result.exitCode,
            state: result.state,
          });
        },
      });

      tools.add({
        name: 'fleet_fetch',
        description: 'Copy one named artifact from the replica to a local directory, verifying its digest before writing.',
        options: { codemode: false, permission: 'edit' },
        input: schema({
          host: string,
          artifact: string,
          dest: string,
          overwrite: boolean,
        }, ['host', 'artifact', 'dest']),
        output: output({
          workspace: string,
          host: string,
          artifact: string,
          file: string,
          bytes: { type: 'number' },
          digest: string,
          statusLabel: string,
        }, ['workspace', 'host', 'artifact', 'file', 'bytes', 'digest', 'statusLabel']),
        async execute(input, context) {
          const config = await workspaceOf(ctx, context);
          const host = hostOf(config, input);
          if (typeof input.artifact !== 'string' || typeof input.dest !== 'string') {
            throw new AgentError('INVALID_REQUEST', 'artifact and dest are required');
          }
          const artifact = input.artifact;
          const dest = path.resolve(config.dir, input.dest);
          const target = canonicalArtifactTarget(dest, artifact);
          await assertPermission(ctx, context, 'edit', [target], {
            workspace: config.name,
            host: host.alias,
            artifact,
            target,
          }, [`${path.dirname(target)}/*`]);
          const relative = path.relative(config.dir, target);
          if (relative.startsWith('..') || path.isAbsolute(relative)) {
            await assertPermission(ctx, context, 'external_directory', [`${path.dirname(target)}/*`], {
              workspace: config.name,
              host: host.alias,
              target,
            }, [`${path.dirname(target)}/*`]);
          }
          const progress = progressReporter(context);
          const result = await withClient(host, context, (client) => fetchArtifact(client, {
            workspaceId: config.name,
            root: host.root,
            artifact,
            dest,
            overwrite: input.overwrite === true,
            expectedTarget: target,
            signal: context?.signal,
            onProgress: (update: FetchProgress) => progress({ ...update, workspace: config.name, host: host.alias }),
          }));
          return jsonResult({ workspace: config.name, host: host.alias, artifact, statusLabel: 'Verified', ...result });
        },
      });

      tools.add({
        name: 'fleet_job_status',
        description: 'Show the state and bounded output tail of a background Fleet job started by this OpenCode runtime.',
        options: { codemode: false },
        input: schema({ host: string, jobId: string }, ['host', 'jobId']),
        output: output({
          workspace: string, host: string, jobId: string, state: string, stateLabel: string,
          exitCode: { type: ['number', 'null'] }, exitLabel: string, signal: { type: ['number', 'null'] },
          startedAt: { type: 'number' }, endedAt: { type: ['number', 'null'] },
          stdoutBytes: { type: 'number' }, stderrBytes: { type: 'number' },
          stdoutTail: string, stderrTail: string, error: { type: ['string', 'null'] },
        }, ['workspace', 'host', 'jobId', 'state', 'stateLabel', 'exitLabel', 'startedAt', 'stdoutBytes', 'stderrBytes']),
        async execute(input, context) {
          const config = await workspaceOf(ctx, context);
          const host = hostOf(config, input);
          if (typeof input.jobId !== 'string') throw new AgentError('INVALID_REQUEST', 'jobId is required');
          return jsonResult(storedJobOutput(await registry.status(config, host.alias, input.jobId, sessionIDOf(context))));
        },
      });

      tools.add({
        name: 'fleet_job_cancel',
        description: 'Request cancellation of a background Fleet job. The final state reports the real outcome.',
        options: { codemode: false, permission: 'fleet.job.cancel' },
        input: schema({ host: string, jobId: string }, ['host', 'jobId']),
        output: output({
          workspace: string, host: string, jobId: string, state: string, stateLabel: string,
          exitCode: { type: ['number', 'null'] }, exitLabel: string, signal: { type: ['number', 'null'] },
          startedAt: { type: 'number' }, endedAt: { type: ['number', 'null'] },
          stdoutBytes: { type: 'number' }, stderrBytes: { type: 'number' },
          stdoutTail: string, stderrTail: string, error: { type: ['string', 'null'] },
        }, ['workspace', 'host', 'jobId', 'state', 'stateLabel', 'exitLabel', 'startedAt', 'stdoutBytes', 'stderrBytes']),
        async execute(input, context) {
          const config = await workspaceOf(ctx, context);
          const host = hostOf(config, input);
          if (typeof input.jobId !== 'string') throw new AgentError('INVALID_REQUEST', 'jobId is required');
          await assertPermission(ctx, context, 'fleet.job.cancel', [`${config.name}@${host.alias}:${input.jobId}`], {
            workspace: config.name,
            host: host.alias,
            jobId: input.jobId,
          });
          return jsonResult(storedJobOutput(await registry.cancel(config, host.alias, input.jobId, sessionIDOf(context))));
        },
      });

      tools.add({
        name: 'fleet_recover',
        description: 'Inspect and resolve a Fleet workspace left in RECOVERY. Default mode=recover completes an interrupted apply; mode=abort only works before apply.',
        options: { codemode: false, permission: 'fleet.recover' },
        input: schema({ host: string, mode: { type: 'string', enum: ['recover', 'abort'] } }, ['host']),
        output: output({
          workspace: string,
          host: string,
          state: string,
          txnId: { type: ['string', 'null'] },
          phase: { type: ['string', 'null'] },
          generation: { type: ['number', 'null'] },
          manifestDigest: { type: ['string', 'null'] },
          recovered: boolean,
          resultLabel: string,
          nextStep: string,
        }, ['workspace', 'host', 'state', 'recovered', 'resultLabel', 'nextStep']),
        async execute(input, context) {
          const config = await workspaceOf(ctx, context);
          const host = hostOf(config, input);
          const mode = input.mode === 'abort' ? 'abort' : 'recover';
          await assertPermission(ctx, context, 'fleet.recover', [`${config.name}@${host.alias}`], {
            workspace: config.name,
            host: host.alias,
            mode,
          }, [`${config.name}@${host.alias}`]);
          const result = await withClient(host, context, (client) => recoverWorkspace(
            client,
            config.name,
            host.root,
            mode,
            context?.signal,
          ), { closeOnAbort: false });
          const recovered = result.recovered === true;
          const ready = result.state === 'READY';
          const resultLabel = ready
            ? recovered
              ? mode === 'abort' ? 'Recovery aborted' : 'Recovered'
              : 'Nothing to recover'
            : 'Recovery still needed';
          return jsonResult({
            workspace: config.name,
            host: host.alias,
            state: result.state,
            txnId: result.txnId ?? null,
            phase: result.phase ?? null,
            generation: result.generation ?? null,
            manifestDigest: result.manifestDigest ?? null,
            recovered,
            resultLabel,
            nextStep: ready
              ? recovered ? 'The replica is ready; continue with fleet_sync.' : 'No action needed.'
              : 'Inspect the workspace and retry fleet_recover.',
          });
        },
      });
    });

    return () => registry.cleanup();
  },
};
