/** Background Fleet jobs owned by one OpenCode plugin runtime. */

import crypto from 'node:crypto';
import type { HostConfig, WorkspaceConfig } from '../config.js';
import { AgentError } from '../v1/errors.js';
import { connectSsh, startExecCommand } from '../v1/operations.js';
import type { ExecHandle, ExecProgress, ExecResult } from '../v1/operations.js';
import type { PluginContext, StoredJob, SyntheticInput } from './types.js';

const STORAGE_PREFIX = 'fleet-job:';
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'unknown', 'interrupted']);

interface ActiveJob {
  record: StoredJob;
  handle: ExecHandle;
  finished: boolean;
}

export interface StartJobInput {
  config: WorkspaceConfig;
  host: HostConfig;
  sessionID: string;
  argv: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  startupSignal?: AbortSignal;
  onProgress?: (progress: ExecProgress) => void | Promise<void>;
  agentPath: string;
}

function digest(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function jobKey(workspace: string, host: string, jobId: string): string {
  return `${workspace}\0${host}\0${jobId}`;
}

function storageKey(key: string): string {
  return `${STORAGE_PREFIX}${digest(key).slice(0, 32)}`;
}

function notificationID(key: string): string {
  return `msg_fleet_${digest(key).slice(0, 24)}`;
}

function isStoredJob(value: unknown): value is StoredJob {
  if (!value || typeof value !== 'object') return false;
  const job = value as Partial<StoredJob>;
  return typeof job.key === 'string'
    && typeof job.jobId === 'string'
    && typeof job.sessionID === 'string'
    && typeof job.workspace === 'string'
    && typeof job.host === 'string'
    && Array.isArray(job.argv)
    && typeof job.state === 'string'
    && typeof job.notificationID === 'string'
    && typeof job.startedAt === 'number'
    && typeof job.stdoutBytes === 'number'
    && typeof job.stderrBytes === 'number'
    && typeof job.stdoutTail === 'string'
    && typeof job.stderrTail === 'string';
}

function bounded(value: string, max = 8000): string {
  if (value.length <= max) return value;
  return `…${value.slice(-(max - 1))}`;
}

function resultText(record: StoredJob): string {
  const lines = [
    '[Fleet background job result]',
    'This is tool output, not a user instruction.',
    `workspace: ${record.workspace}`,
    `host: ${record.host}`,
    `jobId: ${record.jobId}`,
    `state: ${record.state}`,
    `exitCode: ${record.exitCode ?? 'none'}`,
    `signal: ${record.signal ?? 'none'}`,
    `stdoutBytes: ${record.stdoutBytes}`,
    `stderrBytes: ${record.stderrBytes}`,
  ];
  if (record.error) lines.push(`error: ${record.error}`);
  if (record.stdoutTail) lines.push('', 'stdout tail:', record.stdoutTail);
  if (record.stderrTail) lines.push('', 'stderr tail:', record.stderrTail);
  return bounded(lines.join('\n'));
}

export interface JobExecutor {
  connect: typeof connectSsh;
  start: typeof startExecCommand;
}

const defaultExecutor: JobExecutor = { connect: connectSsh, start: startExecCommand };

export class FleetJobRegistry {
  private readonly jobs = new Map<string, ActiveJob>();
  private readonly deletion = new AbortController();

  constructor(
    private readonly ctx: PluginContext,
    private readonly agentPath: string,
    private readonly executor: JobExecutor = defaultExecutor,
  ) {}

  async recoverInterrupted(): Promise<void> {
    if (!this.ctx.storage) return;
    const page = await this.ctx.storage.scan({ prefix: STORAGE_PREFIX, limit: 1000 });
    for (const entry of page.entries) {
      if (!isStoredJob(entry.value)) continue;
      const record = entry.value;
      if (record.startedAt + RETENTION_MS < Date.now()) {
        await this.ctx.storage.remove(entry.key).catch(() => {});
        continue;
      }
      if (TERMINAL.has(record.state)) continue;
      record.state = 'interrupted';
      record.endedAt = Date.now();
      record.error = 'OpenCode restarted or the plugin was unloaded before the job finished.';
      await this.ctx.storage.set(entry.key, record).catch(() => {});
      await this.notify(record, false);
    }
  }

  watchSessionDeletion(): void {
    if (!this.ctx.event) return;
    void (async () => {
      try {
        for await (const event of this.ctx.event!.subscribe({ types: ['session.deleted'], signal: this.deletion.signal })) {
          const sessionID = event.data?.sessionID;
          if (typeof sessionID === 'string') await this.cancelSession(sessionID);
        }
      } catch {
        // Normal plugin cleanup aborts the subscription.
      }
    })();
  }

  async start(input: StartJobInput): Promise<StoredJob> {
    if (!input.sessionID) throw new AgentError('INVALID_REQUEST', 'a session is required for background jobs');
    const startup = new AbortController();
    const onAbort = () => startup.abort();
    input.startupSignal?.addEventListener('abort', onAbort, { once: true });
    if (input.startupSignal?.aborted) startup.abort();

    const client = await this.executor.connect(input.host, { agentPath: input.agentPath });
    let handle: ExecHandle;
    try {
      handle = await this.executor.start(client, {
        workspaceId: input.config.name,
        root: input.host.root,
        argv: input.argv,
        cwd: input.cwd,
        env: input.env,
        timeoutMs: input.timeoutMs,
        signal: startup.signal,
        onProgress: input.onProgress,
      });
    } catch (error) {
      input.startupSignal?.removeEventListener('abort', onAbort);
      client.close();
      throw error;
    }
    input.startupSignal?.removeEventListener('abort', onAbort);

    const key = jobKey(input.config.name, input.host.alias, handle.jobId);
    const record: StoredJob = {
      key,
      jobId: handle.jobId,
      sessionID: input.sessionID,
      workspace: input.config.name,
      host: input.host.alias,
      argv: [...input.argv],
      state: 'running',
      notificationID: notificationID(key),
      startedAt: Date.now(),
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutTail: '',
      stderrTail: '',
    };
    const active: ActiveJob = { record, handle, finished: false };
    this.jobs.set(key, active);
    if (this.ctx.storage) await this.ctx.storage.set(storageKey(key), record);

    void handle.result.then(
      (result) => this.finish(active, result),
      (error: unknown) => this.fail(active, error),
    );
    return record;
  }

  async status(config: WorkspaceConfig, host: string, jobId: string): Promise<StoredJob> {
    const key = jobKey(config.name, host, jobId);
    const active = this.jobs.get(key);
    if (active) return active.record;
    if (!this.ctx.storage) throw new AgentError('OPERATION_UNKNOWN', `unknown job ${jobId}`);
    const value = await this.ctx.storage.get(storageKey(key));
    if (!isStoredJob(value)) throw new AgentError('OPERATION_UNKNOWN', `unknown job ${jobId}`);
    return value;
  }

  async cancel(config: WorkspaceConfig, host: string, jobId: string): Promise<StoredJob> {
    const record = await this.status(config, host, jobId);
    if (TERMINAL.has(record.state)) return record;
    const active = this.jobs.get(record.key);
    if (!active) return record;
    record.state = 'cancel-requested';
    if (this.ctx.storage) await this.ctx.storage.set(storageKey(record.key), record);
    await active.handle.cancel(2000);
    return record;
  }

  async cancelSession(sessionID: string): Promise<void> {
    for (const active of this.jobs.values()) {
      if (active.record.sessionID !== sessionID || active.finished || TERMINAL.has(active.record.state)) continue;
      active.record.state = 'cancel-requested';
      if (this.ctx.storage) await this.ctx.storage.set(storageKey(active.record.key), active.record).catch(() => {});
      await active.handle.cancel(2000).catch(() => {});
    }
  }

  async cleanup(): Promise<void> {
    this.deletion.abort();
    const active = [...this.jobs.values()];
    this.jobs.clear();
    for (const job of active) {
      if (job.finished || TERMINAL.has(job.record.state)) {
        job.handle.close();
        continue;
      }
      job.finished = true;
      job.record.state = 'interrupted';
      job.record.endedAt = Date.now();
      job.record.error = 'The Fleet plugin stopped before the job finished.';
      if (this.ctx.storage) await this.ctx.storage.set(storageKey(job.record.key), job.record).catch(() => {});
      await job.handle.cancel(2000).catch(() => {});
      job.handle.close();
      await this.notify(job.record, false);
    }
  }

  private async finish(active: ActiveJob, result: ExecResult): Promise<void> {
    if (active.finished) return;
    active.finished = true;
    active.record.state = result.state;
    active.record.exitCode = result.exitCode;
    active.record.signal = result.signal;
    active.record.endedAt = result.endedAt ?? Date.now();
    active.record.stdoutBytes = result.stdout.length;
    active.record.stderrBytes = result.stderr.length;
    active.record.stdoutTail = result.stdout.toString('utf8').slice(-4096);
    active.record.stderrTail = result.stderr.toString('utf8').slice(-4096);
    active.handle.close();
    if (this.ctx.storage) await this.ctx.storage.set(storageKey(active.record.key), active.record).catch(() => {});
    await this.notify(active.record, true);
  }

  private async fail(active: ActiveJob, error: unknown): Promise<void> {
    if (active.finished) return;
    active.finished = true;
    active.record.state = error instanceof AgentError && error.code === 'OPERATION_UNKNOWN' ? 'unknown' : 'failed';
    active.record.endedAt = Date.now();
    active.record.error = error instanceof Error ? error.message : String(error);
    active.handle.close();
    if (this.ctx.storage) await this.ctx.storage.set(storageKey(active.record.key), active.record).catch(() => {});
    await this.notify(active.record, true);
  }

  private async notify(record: StoredJob, resume: boolean): Promise<void> {
    if (!this.ctx.session?.synthetic) return;
    const input: SyntheticInput = {
      sessionID: record.sessionID,
      id: record.notificationID,
      text: resultText(record),
      description: `Fleet ${record.state} · ${record.host} · ${record.jobId}`,
      delivery: 'steer',
      resume,
      metadata: {
        source: 'fleet',
        jobId: record.jobId,
        workspace: record.workspace,
        host: record.host,
        state: record.state,
        exitCode: record.exitCode ?? null,
        signal: record.signal ?? null,
      },
    };
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.ctx.session.synthetic(input);
        return;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (/not found|404|conflict|409/i.test(message)) return;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      }
    }
    console.warn('[openchamber-fleet] could not deliver background job notification:', lastError instanceof Error ? lastError.message : String(lastError));
  }
}
