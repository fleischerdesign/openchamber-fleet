/** Official OpenCode V2 plugin surface over fleet.agent.v1. */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { compileExcludes, hostAllows, loadHostsOnlyConfig, loadSessionConfig, workspaceLabel } from '../config.js';
import type { HostConfig, HostOperation, WorkspaceConfig } from '../config.js';
import { FleetError, friendlyErrorMessage } from '../errors.js';
import { hostViews, selectHost } from '../hosts.js';
import { assertRelativePath } from '../paths.js';
import { commandLabelOf, exitLabelOf, stateLabelOf } from '../labels.js';
import { runWorkspace, syncForRun, syncOnlyState } from '../run.js';
import type { RunSyncMode } from '../run.js';
import { scratchConfig } from '../scratch.js';
import { replicaState } from '../status.js';
import { AgentError } from '../v1/errors.js';
import {
  transferSourceIdentity,
  transferTargetIdentity,
  connectSsh,
  downloadFile,
  execCommand,
  recoverWorkspace,
  status,
  syncWorkspace,
  uploadFile,
} from '../v1/operations.js';
import type { ExecProgress, SyncProgress, TransferProgress } from '../v1/operations.js';
import { BackgroundJobs } from './background.js';
import type { PermissionInput, PluginContext, StoredJob, ToolContext, ToolDefinition, ToolResult } from './types.js';

const string = { type: 'string' } as const;
const boolean = { type: 'boolean' } as const;
const stringArray = { type: 'array', items: string } as const;
const target = { type: 'string', enum: ['workspace', 'scratch'] } as const;

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

async function sessionDirectoryOf(ctx: PluginContext, context?: ToolContext): Promise<string> {
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
  return directory;
}

function configErrorOf(error: unknown): unknown {
  if (error instanceof FleetError) {
    return new AgentError(error.code === 'config-missing' ? 'CONFIG_MISSING' : 'CONFIG_INVALID', [
      error.message,
      error.details?.hint,
    ].filter(Boolean).join(' '));
  }
  return error;
}

async function workspaceOf(ctx: PluginContext, context?: ToolContext): Promise<WorkspaceConfig> {
  const directory = await sessionDirectoryOf(ctx, context);
  try {
    return loadSessionConfig(directory).config;
  } catch (error) {
    throw configErrorOf(error);
  }
}

/** `fleet_hosts` remains useful in a projectless chat without a default workspace. */
async function hostsWorkspaceOf(ctx: PluginContext, context?: ToolContext): Promise<WorkspaceConfig> {
  const directory = await sessionDirectoryOf(ctx, context);
  try {
    return loadSessionConfig(directory).config;
  } catch (error) {
    if (error instanceof FleetError && error.code === 'config-missing') {
      try {
        return loadHostsOnlyConfig(directory);
      } catch {
        // Fall through to the original missing-project message.
      }
    }
    throw configErrorOf(error);
  }
}

function targetOf(input: Record<string, unknown>): 'workspace' | 'scratch' | undefined {
  if (input.target === 'scratch') return 'scratch';
  if (input.target === 'workspace') return 'workspace';
  return undefined;
}

/** Resolve the explicit target; absent target means the session's project. */
async function workspaceOfTarget(
  ctx: PluginContext,
  context: ToolContext | undefined,
  target: 'workspace' | 'scratch' | undefined,
): Promise<WorkspaceConfig> {
  if (target === 'scratch') {
    const directory = await sessionDirectoryOf(ctx, context);
    try {
      return scratchConfig({
        seed: context?.sessionID ?? directory,
        directory,
      });
    } catch (error) {
      throw configErrorOf(error);
    }
  }
  try {
    return await workspaceOf(ctx, context);
  } catch (error) {
    if (error instanceof AgentError && error.code === 'CONFIG_MISSING' && target === undefined) {
      throw new AgentError(
        'TARGET_REQUIRED',
        'This chat has no project workspace. Pass target="scratch" for remote-only execution, or open a project / set a default workspace.',
      );
    }
    throw error;
  }
}

function hostOf(config: WorkspaceConfig, input: Record<string, unknown>, operation?: HostOperation): HostConfig {
  const alias = input.host;
  if (typeof alias !== 'string' || alias.length === 0) throw new AgentError('INVALID_REQUEST', 'host is required');
  const host = config.hosts[alias];
  if (!host) {
    throw new AgentError('INVALID_REQUEST', `unknown host ${JSON.stringify(alias)}; known: ${Object.keys(config.hosts).join(', ')}`);
  }
  if (operation !== undefined && !hostAllows(host, operation)) {
    throw new AgentError('HOST_NOT_ALLOWED', `host ${JSON.stringify(alias)} is not allowed for ${operation}`);
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
  const input: PermissionInput = {
    sessionID: sessionIDOf(context),
    agent: context?.agent,
    source: { type: 'tool', messageID: context?.messageID, id: context?.id },
    action,
    resources,
    metadata,
  };
  // The permission schema validates a present save field as an array; an
  // explicit undefined is rejected by the runtime.
  if (save !== undefined) input.save = save;
  await ctx.permission.assert(input);
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
    workspace: workspaceLabel(config),
    workspaceId: config.name,
    workspaceSource: config.source ?? 'file',
    host: host.alias,
    mode,
    modeLabel: mode === 'apply' ? 'Applied' : 'Planned',
    planDigest: result.planDigest,
    planToken: result.planToken ?? null,
    generation: result.generation ?? null,
    manifestDigest: result.manifestDigest ?? null,
    changes: result.changes.length,
    changesTruncated: result.changes.length > items.length,
    needed: result.needed.length,
    items,
  };
}

interface ValidatedExec {
  readonly argv: string[];
  readonly cwd?: string;
  readonly env: Record<string, string>;
  readonly timeoutMs?: number;
  readonly command: string;
  readonly descriptor: string;
  readonly metadata: Record<string, unknown>;
}

function validateExec(config: WorkspaceConfig, host: HostConfig, input: Record<string, unknown>): ValidatedExec {
  if (!Array.isArray(input.argv) || input.argv.length === 0) {
    throw new AgentError('INVALID_REQUEST', 'argv must contain at least one command');
  }
  const argv = input.argv.map(String);
  const timeoutMs = typeof input.timeoutSeconds === 'number' && Number.isFinite(input.timeoutSeconds)
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
  let cwd: string | undefined;
  if (typeof input.cwd === 'string') {
    try {
      cwd = assertRelativePath(input.cwd);
    } catch (error) {
      throw new AgentError('INVALID_REQUEST', friendlyErrorMessage(error));
    }
  }
  const command = commandText(argv);
  const envDigest = createHash('sha256').update(JSON.stringify(Object.entries(env).sort(([left], [right]) => left.localeCompare(right)))).digest('hex');
  const descriptor = JSON.stringify({
    workspace: workspaceLabel(config),
    host: host.alias,
    cwd: cwd ?? '.',
    envKeys: Object.keys(env).sort(),
    envDigest,
    argv,
  });
  return {
    argv,
    ...(cwd === undefined ? {} : { cwd }),
    env,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    command,
    descriptor,
    metadata: {
      workspace: workspaceLabel(config),
      host: host.alias,
      argv,
      cwd: cwd ?? '.',
      envKeys: Object.keys(env).sort(),
    },
  };
}

async function assertShellPermission(
  ctx: PluginContext,
  context: ToolContext | undefined,
  exec: ValidatedExec,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const metadata = { ...exec.metadata, ...extra };
  await assertPermission(ctx, context, 'shell', [exec.command], metadata, [exec.command]);
}

function syncLabelOf(sync: { changes: number } | null | undefined): string {
  if (!sync) return 'Not synced';
  return sync.changes === 0 ? 'Up to date' : `${sync.changes} change${sync.changes === 1 ? '' : 's'}`;
}

function runOutput(
  config: WorkspaceConfig,
  host: HostConfig,
  argv: string[],
  background: boolean,
  state: string,
  sync: { changes: number; generation: number | null; planDigest: string; planToken: string | null; items: Array<{ action: string; path: string }>; changesTruncated: boolean } | null,
  exec: Awaited<ReturnType<typeof execCommand>> | null,
  jobId: string,
  supervised = false,
  target = 'workspace',
): Record<string, unknown> {
  const exitCode = exec?.exitCode ?? null;
  const signal = exec?.signal ?? null;
  const nextStep = state === 'sync-required'
    ? 'Review the changes, then run fleet_run with sync=apply or fleet_sync apply.'
    : state === 'sync-planned'
      ? 'Plan only: no command ran. Apply the sync when you are ready.'
      : background
        ? supervised
          ? 'The session resumes when the job finishes.'
          : 'The job is bound to this OpenCode runtime; a restart reports it as interrupted.'
        : state === 'succeeded'
          ? 'No action needed.'
          : state === 'cancelled'
            ? 'The job was cancelled.'
            : 'Inspect stderr or call fleet_job_status for a background job.';
  return {
    workspace: workspaceLabel(config),
    workspaceId: config.name,
    workspaceSource: config.source ?? 'file',
    target,
    host: host.alias,
    argv,
    commandLabel: commandLabelOf(argv),
    background,
    modeLabel: background ? (supervised ? 'Background job · detached' : 'Background job') : 'Foreground',
    state,
    stateLabel: stateLabelOf(state),
    exitCode,
    exitLabel: exitLabelOf(exitCode, signal, state),
    signal,
    jobId,
    supervised,
    syncLabel: target === 'scratch' ? 'Remote-only' : syncLabelOf(sync),
    syncChanges: sync?.changes ?? 0,
    syncGeneration: sync?.generation ?? null,
    syncPlanDigest: sync?.planDigest ?? null,
    syncPlanToken: sync?.planToken ?? null,
    syncItems: sync?.items ?? [],
    syncTruncated: sync?.changesTruncated ?? false,
    stdout: exec ? truncated(exec.stdout.toString('utf8')) : '',
    stderr: exec ? truncated(exec.stderr.toString('utf8')) : '',
    nextStep,
  };
}

function execOutput(
  config: WorkspaceConfig,
  host: HostConfig,
  argv: string[],
  background: boolean,
  result: Awaited<ReturnType<typeof execCommand>>,
  supervised = false,
): Record<string, unknown> {
  return {
    workspace: workspaceLabel(config),
    workspaceId: config.name,
    workspaceSource: config.source ?? 'file',
    host: host.alias,
    argv,
    commandLabel: commandLabelOf(argv),
    background,
    modeLabel: background ? (supervised ? 'Background job · detached' : 'Background job') : 'Foreground',
    supervised,
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
    argv: record.argv,
    commandLabel: commandLabelOf(record.argv),
    state: record.state,
    stateLabel: stateLabelOf(record.state),
    runLabel: record.supervised === true ? 'Detached supervisor' : 'OpenCode runtime',
    supervised: record.supervised === true,
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
    const registry = new BackgroundJobs(ctx, agentPath());
    await registry.recoverInterrupted();
    registry.watchSessionDeletion();

    await ctx.tool.transform((tools) => {
      tools.add({
        name: 'fleet_status',
        description: 'Show the effective workspace and whether a host replica is ready, synchronized, or needs recovery. Read-only: it never creates a workspace.',
        options: { codemode: false },
        input: schema({ host: string, target }, ['host']),
        output: output({
          workspace: string,
          workspaceId: string,
          workspaceSource: string,
          target: string,
          host: string,
          generation: { type: 'number' },
          manifestDigest: string,
          recovery: boolean,
          statusLabel: string,
          nextStep: string,
        }, ['workspace', 'target', 'host', 'generation', 'manifestDigest', 'recovery', 'statusLabel', 'nextStep']),
        async execute(input, context) {
          const selected = targetOf(input) ?? 'workspace';
          const config = await workspaceOfTarget(ctx, context, targetOf(input));
          const host = hostOf(config, input, selected === 'scratch' ? 'scratch' : 'workspace');
          const info = await withClient(host, context, (client) => status(client, config.name, host.root, context?.signal));
          const state = selected === 'scratch'
            && info.generation === 0
            && info.recovery !== true
            && info.state !== 'UNMANAGED'
            ? { label: 'Remote-only', nextStep: 'Upload files into scratch or run a command with fleet_exec.' }
            : replicaState(info);
          return jsonResult({
            workspace: workspaceLabel(config),
            workspaceId: config.name,
            workspaceSource: config.source ?? 'file',
            target: selected,
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
          planToken: string,
        }, ['host', 'mode']),
        output: output({
          workspace: string,
          workspaceId: string,
          workspaceSource: string,
          host: string,
          mode: string,
          modeLabel: string,
          planDigest: string,
          planToken: { type: ['string', 'null'] },
          generation: { type: ['number', 'null'] },
          manifestDigest: { type: ['string', 'null'] },
          changes: { type: 'number' },
          changesTruncated: boolean,
          needed: { type: 'number' },
          items: { type: 'array', items: schema({ action: string, path: string }, ['action', 'path']) },
        }, ['workspace', 'host', 'mode', 'modeLabel', 'planDigest', 'planToken', 'changes', 'needed', 'items']),
        async execute(input, context) {
          const config = await workspaceOf(ctx, context);
          const host = hostOf(config, input, 'workspace');
          if (input.mode !== 'plan' && input.mode !== 'apply') {
            throw new AgentError('INVALID_REQUEST', 'mode must be plan or apply');
          }
          if (input.planToken !== undefined && (typeof input.planToken !== 'string' || input.planToken.length === 0)) {
            throw new AgentError('INVALID_REQUEST', 'planToken must be a non-empty string');
          }
          const mode = input.mode;
          const extra = Array.isArray(input.excludes) ? input.excludes.map(String) : [];
          const excludes = [...new Set([...config.excludes, ...extra])];
          if (mode === 'apply') {
            const descriptor = JSON.stringify({
              workspaceId: config.name,
              host: host.alias,
              ssh: host.ssh,
              port: host.port,
              root: host.root,
              mode,
              excludes,
              planToken: typeof input.planToken === 'string' ? input.planToken : null,
            });
            await assertPermission(ctx, context, 'fleet.sync', [descriptor], {
              workspace: workspaceLabel(config),
              host: host.alias,
              mode,
              excludes,
            }, [descriptor]);
          }
          const progress = progressReporter(context);
          const result = await withClient(host, context, (client) => syncWorkspace(client, compileExcludes(excludes), {
            workspaceId: config.name,
            source: config.dir,
            root: host.root,
            hostIdentity: `${host.ssh}:${host.port}`,
            excludes,
            mode,
            ...(typeof input.planToken === 'string' ? { planToken: input.planToken } : {}),
            signal: context?.signal,
            onProgress: (update: SyncProgress) => progress({ ...update, workspace: workspaceLabel(config), host: host.alias }),
          }), { closeOnAbort: false });
          return jsonResult(syncOutput(config, host, mode, result), { host: host.alias, mode, planDigest: result.planDigest });
        },
      });

      tools.add({
        name: 'fleet_exec',
        description: 'Low-level remote execution without syncing. Use target="scratch" in a projectless chat. Prefer fleet_run for normal work; use this only when the replica is intentionally current. background=true returns a jobId, ends the turn, and resumes this session automatically.',
        options: { codemode: false, permission: 'shell' },
        input: schema({
          host: string,
          target,
          argv: { type: 'array', items: string, minItems: 1 },
          cwd: string,
          env: { type: 'object', additionalProperties: string },
          timeoutSeconds: { type: 'number', minimum: 1 },
          background: boolean,
        }, ['host', 'argv']),
        output: output({
          workspace: string,
          workspaceId: string,
          workspaceSource: string,
          target: string,
          host: string,
          argv: stringArray,
          commandLabel: string,
          background: boolean,
          supervised: boolean,
          modeLabel: string,
          jobId: string,
          state: string,
          stateLabel: string,
          exitCode: { type: ['number', 'null'] },
          exitLabel: string,
          signal: { type: ['number', 'null'] },
          stdout: string,
          stderr: string,
        }, ['workspace', 'target', 'host', 'argv', 'commandLabel', 'background', 'supervised', 'modeLabel', 'jobId', 'state', 'stateLabel', 'exitLabel']),
        async execute(input, context) {
          const selected = targetOf(input) ?? 'workspace';
          const config = await workspaceOfTarget(ctx, context, targetOf(input));
          const host = hostOf(config, input, selected === 'scratch' ? 'scratch' : 'workspace');
          const exec = validateExec(config, host, input);
          const metadata = { ...exec.metadata, target: selected, background: input.background === true };
          const descriptor = JSON.stringify({
            ...JSON.parse(exec.descriptor),
            workspaceId: config.name,
            ssh: host.ssh,
            port: host.port,
            root: host.root,
            target: selected,
          });
          await assertPermission(ctx, context, 'fleet.exec', [descriptor], metadata, [descriptor]);
          await assertShellPermission(ctx, context, exec, { target: selected, background: input.background === true });

          if (input.background === true) {
            const record = await registry.start({
              config,
              host,
              sessionID: sessionIDOf(context),
              argv: exec.argv,
              cwd: exec.cwd,
              env: exec.env,
              timeoutMs: exec.timeoutMs,
              target: selected,
              startupSignal: context?.signal,
              agentPath: agentPath(),
            });
            return jsonResult({
              workspace: workspaceLabel(config),
              target: selected,
              host: host.alias,
              argv: exec.argv,
              commandLabel: commandLabelOf(exec.argv),
              background: true,
              supervised: record.supervised === true,
              modeLabel: record.supervised === true ? 'Background job · detached' : 'Background job',
              jobId: record.jobId,
              state: record.state,
              stateLabel: stateLabelOf(record.state),
              exitCode: null,
              exitLabel: exitLabelOf(null, null, record.state),
              signal: null,
              stdout: '',
              stderr: '',
            }, { host: host.alias, jobId: record.jobId, background: true, supervised: record.supervised === true });
          }

          const progress = progressReporter(context);
          const result = await withClient(host, context, (client) => execCommand(client, {
            workspaceId: config.name,
            root: host.root,
            argv: exec.argv,
            cwd: exec.cwd,
            env: exec.env,
            timeoutMs: exec.timeoutMs,
            signal: context?.signal,
            onProgress: (update: ExecProgress) => progress({ ...update, workspace: workspaceLabel(config), host: host.alias }),
          }), { closeOnAbort: false });
          return jsonResult({ ...execOutput(config, host, exec.argv, false, result), target: selected }, {
            host: host.alias,
            jobId: result.jobId,
            exitCode: result.exitCode,
            state: result.state,
          });
        },
      });

      tools.add({
        name: 'fleet_run',
        description: 'Run argv on a host. With target="workspace" (the default in a project chat) it synchronizes the workspace first when needed. With target="scratch" it runs in a private per-session remote scratch directory without any sync; in a projectless chat without a default, target is required. background=true returns a jobId and resumes this session when the job finishes.',
        options: { codemode: false, permission: 'shell' },
        input: schema({
          host: string,
          target,
          tags: stringArray,
          argv: { type: 'array', items: string, minItems: 1 },
          cwd: string,
          env: { type: 'object', additionalProperties: string },
          timeoutSeconds: { type: 'number', minimum: 1 },
          background: boolean,
          sync: { type: 'string', enum: ['auto', 'never', 'plan', 'apply'] },
          excludes: stringArray,
        }, ['argv']),
        output: output({
          workspace: string,
          workspaceId: string,
          workspaceSource: string,
          target: string,
          host: string,
          argv: stringArray,
          commandLabel: string,
          background: boolean,
          supervised: boolean,
          modeLabel: string,
          state: string,
          stateLabel: string,
          exitCode: { type: ['number', 'null'] },
          exitLabel: string,
          signal: { type: ['number', 'null'] },
          jobId: string,
          syncLabel: string,
          syncChanges: { type: 'number' },
          syncGeneration: { type: ['number', 'null'] },
          syncPlanDigest: { type: ['string', 'null'] },
          syncPlanToken: { type: ['string', 'null'] },
          syncItems: { type: 'array', items: schema({ action: string, path: string }, ['action', 'path']) },
          syncTruncated: boolean,
          stdout: string,
          stderr: string,
          nextStep: string,
        }, ['workspace', 'target', 'host', 'argv', 'commandLabel', 'background', 'supervised', 'modeLabel', 'state', 'stateLabel', 'exitCode', 'exitLabel', 'jobId', 'syncLabel', 'syncChanges', 'syncGeneration', 'syncPlanDigest', 'syncItems', 'syncTruncated', 'stdout', 'stderr', 'nextStep']),
        async execute(input, context) {
          const selected = targetOf(input) ?? 'workspace';
          const config = await workspaceOfTarget(ctx, context, targetOf(input));
          const host = selectHost(config, {
            ...(typeof input.host === 'string' ? { host: input.host } : {}),
            ...(Array.isArray(input.tags) ? { tags: input.tags.map(String) } : {}),
            operation: selected === 'scratch' ? 'scratch' : 'workspace',
          });
          const exec = validateExec(config, host, input);
          const extra = Array.isArray(input.excludes) ? input.excludes.map(String) : [];
          const excludes = selected === 'scratch' ? [] : [...new Set([...config.excludes, ...extra])];
          if (input.sync !== undefined && input.sync !== 'auto' && input.sync !== 'never' && input.sync !== 'plan' && input.sync !== 'apply') {
            throw new AgentError('INVALID_REQUEST', 'sync must be one of auto, never, plan or apply');
          }
          const syncMode: RunSyncMode = input.sync === 'never' || input.sync === 'plan' || input.sync === 'apply'
            ? input.sync
            : 'auto';
          if (selected === 'scratch' && (syncMode === 'plan' || syncMode === 'apply')) {
            throw new AgentError('INVALID_REQUEST', 'scratch has no source tree; sync=plan/apply requires target="workspace"');
          }
          const background = input.background === true;
          const metadata = {
            ...exec.metadata,
            target: selected,
            sync: syncMode,
            excludes,
            background,
          };
          const descriptor = JSON.stringify({
            ...JSON.parse(exec.descriptor),
            workspaceId: config.name,
            ssh: host.ssh,
            port: host.port,
            root: host.root,
            target: selected,
            sync: syncMode,
            excludes,
          });
          await assertPermission(ctx, context, 'fleet.run', [descriptor], metadata, [descriptor]);

          const progress = progressReporter(context);
          const common = {
            ...(exec.cwd === undefined ? {} : { cwd: exec.cwd }),
            env: exec.env,
            ...(exec.timeoutMs === undefined ? {} : { timeoutMs: exec.timeoutMs }),
            sync: syncMode,
            excludes: extra,
            signal: context?.signal,
            onSyncProgress: (update: SyncProgress) => progress({ ...update, workspace: workspaceLabel(config), host: host.alias }),
          };

          if (background) {
            await assertShellPermission(ctx, context, exec, { target: selected, background: true, sync: syncMode, excludes });
            const prepared = selected === 'scratch'
              ? { sync: null, required: false }
              : await withClient(host, context, (client) => syncForRun(client, config, host, {
                ...common,
                argv: exec.argv,
              }), { closeOnAbort: false });
            const syncOnly = syncOnlyState(syncMode, prepared.required);
            if (syncOnly !== null) {
              return jsonResult(runOutput(
                config,
                host,
                exec.argv,
                true,
                syncOnly,
                prepared.sync,
                null,
                '',
                false,
                selected,
              ));
            }
            const record = await registry.start({
              config,
              host,
              sessionID: sessionIDOf(context),
              argv: exec.argv,
              cwd: exec.cwd,
              env: exec.env,
              timeoutMs: exec.timeoutMs,
              ...(typeof prepared.sync?.generation === 'number' ? { expectedGeneration: prepared.sync.generation } : {}),
              target: selected,
              startupSignal: context?.signal,
              agentPath: agentPath(),
            });
            return jsonResult(runOutput(
              config,
              host,
              exec.argv,
              true,
              record.state,
              prepared.sync,
              null,
              record.jobId,
              record.supervised === true,
              selected,
            ), {
              host: host.alias,
              target: selected,
              jobId: record.jobId,
              background: true,
              supervised: record.supervised === true,
              state: record.state,
            });
          }

          await assertShellPermission(ctx, context, exec, { target: selected, background: false, sync: syncMode, excludes });
          const result = selected === 'scratch'
            ? await withClient(host, context, (client) => execCommand(client, {
              workspaceId: config.name,
              root: host.root,
              argv: exec.argv,
              cwd: exec.cwd,
              env: exec.env,
              timeoutMs: exec.timeoutMs,
              signal: context?.signal,
              onProgress: (update: ExecProgress) => progress({ ...update, workspace: workspaceLabel(config), host: host.alias }),
            }), { closeOnAbort: false }).then((exec) => ({ state: exec.state, sync: null, exec }))
            : await withClient(host, context, (client) => runWorkspace(client, config, host, {
              ...common,
              argv: exec.argv,
              onExecProgress: (update: ExecProgress) => progress({ ...update, workspace: workspaceLabel(config), host: host.alias }),
            }), { closeOnAbort: false });
          return jsonResult(runOutput(config, host, exec.argv, false, result.state, result.sync, result.exec, result.exec?.jobId ?? '', false, selected), {
            host: host.alias,
            target: selected,
            state: result.state,
            changes: result.sync?.changes ?? 0,
          });
        },
      });

      tools.add({
        name: 'fleet_hosts',
        description: 'List configured hosts and their tags. Use it to choose a host or pass tags to fleet_run/host=auto. In a projectless chat this also works without a workspace; target="scratch" lists only hosts allowed for scratch and defaults operation to scratch.',
        options: { codemode: false },
        input: schema({
          tags: stringArray,
          target,
          operation: { type: 'string', enum: ['workspace', 'scratch', 'transfer'] },
        }),
        output: output({
          workspace: string,
          target: string,
          hosts: { type: 'array', items: schema({ alias: string, tags: stringArray, tagsLabel: string, operations: stringArray, operationsLabel: string }, ['alias', 'tags', 'tagsLabel', 'operations', 'operationsLabel']) },
          items: { type: 'array', items: schema({ alias: string, tags: stringArray, tagsLabel: string, operations: stringArray, operationsLabel: string }, ['alias', 'tags', 'tagsLabel', 'operations', 'operationsLabel']) },
          selected: { type: ['string', 'null'] },
        }, ['workspace', 'target', 'hosts', 'items', 'selected']),
        async execute(input, context) {
          const selectedTarget = targetOf(input);
          const config = selectedTarget === 'scratch'
            ? await workspaceOfTarget(ctx, context, 'scratch')
            : await hostsWorkspaceOf(ctx, context);
          const operation = input.operation === 'workspace' || input.operation === 'scratch' || input.operation === 'transfer'
            ? input.operation
            : selectedTarget === 'scratch'
              ? 'scratch'
              : selectedTarget === 'workspace'
                ? 'workspace'
                : undefined;
          const views = hostViews(config).filter((view) => operation === undefined || view.operations.includes(operation));
          let selected: string | null = null;
          if (Array.isArray(input.tags) && input.tags.length > 0) {
            try {
              selected = selectHost(config, {
                tags: input.tags.map(String),
                ...(operation === undefined ? {} : { operation }),
              }).alias;
            } catch {
              selected = null;
            }
          }
          return jsonResult({ workspace: workspaceLabel(config), target: selectedTarget ?? 'workspace', hosts: views, items: views, selected });
        },
      });

      tools.add({
        name: 'fleet_jobs',
        description: 'List this session\'s background jobs, newest first.',
        options: { codemode: false },
        input: schema({}),
        output: output({
          jobs: { type: 'array', items: schema({
            jobId: string,
            target: string,
            host: string,
            commandLabel: string,
            state: string,
            stateLabel: string,
            runLabel: string,
            exitLabel: string,
          }, ['jobId', 'target', 'host', 'commandLabel', 'state', 'stateLabel', 'runLabel', 'exitLabel']) },
          items: { type: 'array', items: schema({
            jobId: string,
            target: string,
            host: string,
            commandLabel: string,
            state: string,
            stateLabel: string,
            runLabel: string,
            exitLabel: string,
          }, ['jobId', 'target', 'host', 'commandLabel', 'state', 'stateLabel', 'runLabel', 'exitLabel']) },
        }, ['jobs', 'items']),
        async execute(_input, context) {
          const jobs = await registry.list(sessionIDOf(context));
          const rows = jobs.map((record) => ({
            jobId: record.jobId,
            target: record.target ?? 'workspace',
            host: record.host,
            commandLabel: commandLabelOf(record.argv),
            state: record.state,
            stateLabel: stateLabelOf(record.state),
            runLabel: record.supervised === true ? 'Detached' : 'Runtime',
            exitLabel: exitLabelOf(record.exitCode ?? null, record.signal ?? null, record.state),
          }));
          return jsonResult({ jobs: rows, items: rows });
        },
      });

      tools.add({
        name: 'fleet_fetch',
        description: 'Copy one artifact from the selected workspace or scratch space to a local directory, verifying its digest before writing. For arbitrary single files use fleet_download.',
        options: { codemode: false, permission: 'edit' },
        input: schema({
          host: string,
          target,
          artifact: string,
          dest: string,
          overwrite: boolean,
        }, ['host', 'artifact', 'dest']),
        output: output({
          workspace: string,
          target: string,
          host: string,
          artifact: string,
          file: string,
          bytes: { type: 'number' },
          digest: string,
          statusLabel: string,
        }, ['workspace', 'target', 'host', 'artifact', 'file', 'bytes', 'digest', 'statusLabel']),
        async execute(input, context) {
          const selected = targetOf(input) ?? 'workspace';
          const config = await workspaceOfTarget(ctx, context, targetOf(input));
          const host = hostOf(config, input, 'transfer');
          if (typeof input.artifact !== 'string' || typeof input.dest !== 'string') {
            throw new AgentError('INVALID_REQUEST', 'artifact and dest are required');
          }
          const artifact = input.artifact;
          const dest = path.resolve(config.dir, input.dest);
          let targetIdentity: ReturnType<typeof transferTargetIdentity>;
          try {
            targetIdentity = transferTargetIdentity(path.join(dest, path.basename(artifact)));
          } catch (error) {
            throw new AgentError('PATH_UNSAFE', friendlyErrorMessage(error));
          }
          const target = targetIdentity.path;
          await assertPermission(ctx, context, 'edit', [target], {
            workspace: workspaceLabel(config),
            target: selected,
            host: host.alias,
            artifact,
            destination: target,
          }, [`${path.dirname(target)}/*`]);
          await assertPermission(ctx, context, 'fleet.download', [`${host.alias}@${host.ssh}:${host.port}:${host.root}:${artifact}->${target}`], {
            workspace: workspaceLabel(config),
            target: selected,
            host: host.alias,
            artifact,
            destination: target,
          });
          const relative = path.relative(config.dir, target);
          if (relative.startsWith('..') || path.isAbsolute(relative)) {
            await assertPermission(ctx, context, 'external_directory', [`${path.dirname(target)}/*`], {
              workspace: workspaceLabel(config),
              target: selected,
              host: host.alias,
              destination: target,
            }, [`${path.dirname(target)}/*`]);
          }
          const progress = progressReporter(context);
          const result = await withClient(host, context, (client) => downloadFile(client, {
            workspaceId: config.name,
            root: host.root,
            path: artifact,
            dest: target,
            expectedTarget: target,
            ...(targetIdentity.dev === null ? {} : { expectedParentDev: targetIdentity.dev }),
            ...(targetIdentity.ino === null ? {} : { expectedParentIno: targetIdentity.ino }),
            overwrite: input.overwrite === true,
            signal: context?.signal,
            onProgress: (update: TransferProgress) => progress({ ...update, workspace: workspaceLabel(config), host: host.alias }),
          }));
          return jsonResult({ workspace: workspaceLabel(config), target: selected, host: host.alias, artifact, statusLabel: 'Verified', ...result });
        },
      });

      tools.add({
        name: 'fleet_upload',
        description: 'Upload one local regular file into the session scratch space on a host. Use this for files outside the workspace, such as /tmp artifacts. It never needs a project config and never syncs a workspace.',
        options: { codemode: false, permission: 'fleet.upload' },
        input: schema({
          host: string,
          localPath: string,
          remotePath: string,
          overwrite: boolean,
        }, ['host', 'localPath', 'remotePath']),
        output: output({
          workspace: string,
          target: string,
          host: string,
          source: string,
          destination: string,
          bytes: { type: 'number' },
          digest: string,
          statusLabel: string,
        }, ['workspace', 'target', 'host', 'source', 'destination', 'bytes', 'digest', 'statusLabel']),
        async execute(input, context) {
          if (typeof input.localPath !== 'string' || typeof input.remotePath !== 'string') {
            throw new AgentError('INVALID_REQUEST', 'localPath and remotePath are required');
          }
          const config = await workspaceOfTarget(ctx, context, 'scratch');
          const host = hostOf(config, input, 'transfer');
          let sourceIdentity: ReturnType<typeof transferSourceIdentity>;
          try {
            sourceIdentity = transferSourceIdentity(path.resolve(config.dir, input.localPath));
          } catch (error) {
            throw new AgentError('PATH_UNSAFE', friendlyErrorMessage(error));
          }
          const source = sourceIdentity.path;
          let remotePath: string;
          try {
            remotePath = assertRelativePath(input.remotePath);
          } catch (error) {
            throw new AgentError('INVALID_REQUEST', friendlyErrorMessage(error));
          }
          await assertPermission(ctx, context, 'read', [source], {
            workspace: workspaceLabel(config),
            target: 'scratch',
            host: host.alias,
            source,
            destination: remotePath,
          });
          await assertPermission(ctx, context, 'fleet.upload', [`${host.alias}@${host.ssh}:${host.port}:${host.root}:${source}->${remotePath}`], {
            workspace: workspaceLabel(config),
            target: 'scratch',
            host: host.alias,
            source,
            destination: remotePath,
          });
          const relative = path.relative(config.dir, source);
          if (relative.startsWith('..') || path.isAbsolute(relative)) {
            await assertPermission(ctx, context, 'external_directory', [`${path.dirname(source)}/*`], {
              workspace: workspaceLabel(config),
              target: 'scratch',
              host: host.alias,
              source,
            });
          }
          const progress = progressReporter(context);
          const result = await withClient(host, context, (client) => uploadFile(client, {
            workspaceId: config.name,
            root: host.root,
            path: remotePath,
            source,
            expectedDev: sourceIdentity.dev,
            expectedIno: sourceIdentity.ino,
            overwrite: input.overwrite === true,
            signal: context?.signal,
            onProgress: (update: TransferProgress) => progress({ ...update, workspace: workspaceLabel(config), host: host.alias }),
          }));
          return jsonResult({
            workspace: workspaceLabel(config),
            target: 'scratch',
            host: host.alias,
            source,
            destination: remotePath,
            bytes: result.bytes,
            digest: result.digest,
            statusLabel: 'Verified',
          }, { host: host.alias, bytes: result.bytes, digest: result.digest });
        },
      });

      tools.add({
        name: 'fleet_download',
        description: 'Download one regular file from the selected workspace or session scratch space to a local path. The remote path must stay below that workspace root or scratch root; use an absolute remote path only through the workspace that owns it.',
        options: { codemode: false, permission: 'edit' },
        input: schema({
          host: string,
          target,
          remotePath: string,
          localPath: string,
          overwrite: boolean,
        }, ['host', 'remotePath', 'localPath']),
        output: output({
          workspace: string,
          target: string,
          host: string,
          source: string,
          file: string,
          bytes: { type: 'number' },
          digest: string,
          statusLabel: string,
        }, ['workspace', 'target', 'host', 'source', 'file', 'bytes', 'digest', 'statusLabel']),
        async execute(input, context) {
          if (typeof input.remotePath !== 'string' || typeof input.localPath !== 'string') {
            throw new AgentError('INVALID_REQUEST', 'remotePath and localPath are required');
          }
          const selected = targetOf(input) ?? 'workspace';
          const config = await workspaceOfTarget(ctx, context, targetOf(input));
          const host = hostOf(config, input, 'transfer');
          let remotePath: string;
          try {
            remotePath = assertRelativePath(input.remotePath);
          } catch (error) {
            throw new AgentError('INVALID_REQUEST', friendlyErrorMessage(error));
          }
          let targetIdentity: ReturnType<typeof transferTargetIdentity>;
          try {
            targetIdentity = transferTargetIdentity(path.resolve(config.dir, input.localPath));
          } catch (error) {
            throw new AgentError('PATH_UNSAFE', friendlyErrorMessage(error));
          }
          const destination = targetIdentity.path;
          await assertPermission(ctx, context, 'edit', [destination], {
            workspace: workspaceLabel(config),
            target: selected,
            host: host.alias,
            source: remotePath,
            destination,
          }, [`${path.dirname(destination)}/*`]);
          await assertPermission(ctx, context, 'fleet.download', [`${host.alias}@${host.ssh}:${host.port}:${host.root}:${remotePath}->${destination}`], {
            workspace: workspaceLabel(config),
            target: selected,
            host: host.alias,
            source: remotePath,
            destination,
          });
          const relative = path.relative(config.dir, destination);
          if (relative.startsWith('..') || path.isAbsolute(relative)) {
            await assertPermission(ctx, context, 'external_directory', [`${path.dirname(destination)}/*`], {
              workspace: workspaceLabel(config),
              target: selected,
              host: host.alias,
              destination,
            });
          }
          const progress = progressReporter(context);
          const result = await withClient(host, context, (client) => downloadFile(client, {
            workspaceId: config.name,
            root: host.root,
            path: remotePath,
            dest: destination,
            expectedTarget: destination,
            ...(targetIdentity.dev === null ? {} : { expectedParentDev: targetIdentity.dev }),
            ...(targetIdentity.ino === null ? {} : { expectedParentIno: targetIdentity.ino }),
            overwrite: input.overwrite === true,
            signal: context?.signal,
            onProgress: (update: TransferProgress) => progress({ ...update, workspace: workspaceLabel(config), host: host.alias }),
          }));
          return jsonResult({
            workspace: workspaceLabel(config),
            target: selected,
            host: host.alias,
            source: remotePath,
            file: result.file,
            bytes: result.bytes,
            digest: result.digest,
            statusLabel: 'Verified',
          }, { host: host.alias, bytes: result.bytes, digest: result.digest });
        },
      });

      tools.add({
        name: 'fleet_job_status',
        description: 'Show the state and bounded output tail of a background Fleet job. The job record carries its own host and target.',
        options: { codemode: false },
        input: schema({ jobId: string }, ['jobId']),
        output: output({
          workspace: string, target: string, host: string, jobId: string, state: string, stateLabel: string,
          runLabel: string, supervised: boolean,
          exitCode: { type: ['number', 'null'] }, exitLabel: string, signal: { type: ['number', 'null'] },
          startedAt: { type: 'number' }, endedAt: { type: ['number', 'null'] },
          stdoutBytes: { type: 'number' }, stderrBytes: { type: 'number' },
          stdoutTail: string, stderrTail: string, error: { type: ['string', 'null'] },
        }, ['workspace', 'host', 'jobId', 'state', 'stateLabel', 'runLabel', 'supervised', 'exitLabel', 'startedAt', 'stdoutBytes', 'stderrBytes']),
        async execute(input, context) {
          if (typeof input.jobId !== 'string') throw new AgentError('INVALID_REQUEST', 'jobId is required');
          const job = await registry.status(input.jobId, sessionIDOf(context));
          if (!job) throw new AgentError('JOB_NOT_FOUND', `unknown job ${input.jobId}`);
          return jsonResult(storedJobOutput(job));
        },
      });

      tools.add({
        name: 'fleet_job_cancel',
        description: 'Request cancellation of a background Fleet job by id. The final state reports the real outcome.',
        options: { codemode: false, permission: 'fleet.job.cancel' },
        input: schema({ jobId: string }, ['jobId']),
        output: output({
          workspace: string, target: string, host: string, jobId: string, state: string, stateLabel: string,
          runLabel: string, supervised: boolean,
          exitCode: { type: ['number', 'null'] }, exitLabel: string, signal: { type: ['number', 'null'] },
          startedAt: { type: 'number' }, endedAt: { type: ['number', 'null'] },
          stdoutBytes: { type: 'number' }, stderrBytes: { type: 'number' },
          stdoutTail: string, stderrTail: string, error: { type: ['string', 'null'] },
        }, ['workspace', 'host', 'jobId', 'state', 'stateLabel', 'runLabel', 'supervised', 'exitLabel', 'startedAt', 'stdoutBytes', 'stderrBytes']),
        async execute(input, context) {
          if (typeof input.jobId !== 'string') throw new AgentError('INVALID_REQUEST', 'jobId is required');
          const job = await registry.status(input.jobId, sessionIDOf(context));
          if (!job) throw new AgentError('JOB_NOT_FOUND', `unknown job ${input.jobId}`);
          await assertPermission(ctx, context, 'fleet.job.cancel', [`${job.workspace}@${job.host}:${input.jobId}`], {
            workspace: job.workspace,
            host: job.host,
            jobId: input.jobId,
          });
          const cancelled = await registry.cancel(input.jobId, sessionIDOf(context));
          if (!cancelled) throw new AgentError('JOB_NOT_FOUND', `unknown job ${input.jobId}`);
          return jsonResult(storedJobOutput(cancelled));
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
          const host = hostOf(config, input, 'workspace');
          if (input.mode !== undefined && input.mode !== 'abort' && input.mode !== 'recover') {
            throw new AgentError('INVALID_REQUEST', 'mode must be recover or abort');
          }
          const mode = input.mode === 'abort' ? 'abort' : 'recover';
          const descriptor = JSON.stringify({
            workspaceId: config.name,
            host: host.alias,
            ssh: host.ssh,
            port: host.port,
            root: host.root,
            mode,
          });
          await assertPermission(ctx, context, 'fleet.recover', [descriptor], {
            workspace: workspaceLabel(config),
            host: host.alias,
            mode,
          }, [descriptor]);
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
            workspace: workspaceLabel(config),
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
