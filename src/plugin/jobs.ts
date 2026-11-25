/** Background Fleet jobs owned by one OpenCode plugin runtime. */

import type { HostConfig, WorkspaceConfig } from '../config.js';
import { jobKey } from '../jobs/protocol.js';
import { AgentError } from '../v1/errors.js';
import { connectSsh, startExecCommand } from '../v1/operations.js';
import type { ExecHandle, ExecProgress, ExecResult } from '../v1/operations.js';
import { STORAGE_PREFIX, isStoredJob, notificationID, notifyJob, storageKey } from './notify.js';
import type { PluginContext, StoredJob } from './types.js';

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
  target?: 'workspace' | 'scratch';
  sessionID: string;
  argv: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  expectedGeneration?: number;
  startupSignal?: AbortSignal;
  onProgress?: (progress: ExecProgress) => void | Promise<void>;
  agentPath: string;
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
    const location = this.ctx.location?.directory;
    let after: string | undefined;
    do {
      const page = await this.ctx.storage.scan({ prefix: STORAGE_PREFIX, limit: 1000, after });
      for (const entry of page.entries) {
        if (!isStoredJob(entry.value)) continue;
        const record = entry.value;
        if (record.supervised === true) continue;
        if (location && record.directory !== location) continue;
        if (record.startedAt + RETENTION_MS < Date.now()) {
          await this.ctx.storage.remove(entry.key).catch(() => {});
          continue;
        }
        if (TERMINAL.has(record.state)) {
          if (record.notified !== true) await notifyJob(this.ctx, record, true);
          continue;
        }
        record.state = 'interrupted';
        record.endedAt = Date.now();
        record.notified = false;
        record.error = 'OpenCode restarted or the plugin was unloaded before the job finished.';
        await this.ctx.storage.set(entry.key, record).catch(() => {});
        await notifyJob(this.ctx, record, false);
      }
      after = page.next;
    } while (after);
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
        ...(input.expectedGeneration === undefined ? {} : { expectedGeneration: input.expectedGeneration }),
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
      directory: this.ctx.location?.directory ?? input.config.dir,
      ...(input.target === undefined ? {} : { target: input.target }),
      host: input.host.alias,
      argv: [...input.argv],
      state: 'running',
      supervised: false,
      notified: false,
      notificationID: notificationID(key),
      startedAt: Date.now(),
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutTail: '',
      stderrTail: '',
    };
    const active: ActiveJob = { record, handle, finished: false };
    this.jobs.set(key, active);
    if (this.ctx.storage) {
      try {
        await this.ctx.storage.set(storageKey(key), record);
      } catch (error) {
        active.finished = true;
        this.jobs.delete(key);
        await handle.cancel(2000).catch(() => {});
        handle.close();
        throw error;
      }
    }

    void handle.result.then(
      (result) => this.finish(active, result),
      (error: unknown) => this.fail(active, error),
    );
    return record;
  }

  async status(jobId: string, sessionID: string): Promise<StoredJob> {
    for (const active of this.jobs.values()) {
      if (active.record.jobId !== jobId) continue;
      if (active.record.sessionID !== sessionID) throw new AgentError('PERMISSION_DENIED', 'job belongs to another session');
      return active.record;
    }
    if (this.ctx.storage) {
      let after: string | undefined;
      do {
        const page = await this.ctx.storage.scan({ prefix: STORAGE_PREFIX, limit: 1000, after });
        for (const entry of page.entries) {
          if (!isStoredJob(entry.value) || entry.value.jobId !== jobId) continue;
          if (entry.value.sessionID !== sessionID) throw new AgentError('PERMISSION_DENIED', 'job belongs to another session');
          return entry.value;
        }
        after = page.next;
      } while (after);
    }
    throw new AgentError('OPERATION_UNKNOWN', `unknown job ${jobId}`);
  }

  async list(sessionID: string): Promise<StoredJob[]> {
    const records = new Map<string, StoredJob>();
    if (this.ctx.storage) {
      let after: string | undefined;
      do {
        const page = await this.ctx.storage.scan({ prefix: STORAGE_PREFIX, limit: 1000, after });
        for (const entry of page.entries) {
          if (!isStoredJob(entry.value)) continue;
          const record = entry.value;
          if (record.sessionID !== sessionID) continue;
          if (record.startedAt + RETENTION_MS < Date.now()) continue;
          records.set(record.key, record);
        }
        after = page.next;
      } while (after);
    }
    for (const active of this.jobs.values()) {
      if (active.record.sessionID !== sessionID) continue;
      records.set(active.record.key, active.record);
    }
    return [...records.values()].sort((left, right) => right.startedAt - left.startedAt).slice(0, 50);
  }

  async cancel(jobId: string, sessionID: string): Promise<StoredJob> {
    const record = await this.status(jobId, sessionID);
    if (TERMINAL.has(record.state)) return record;
    const active = this.jobs.get(record.key);
    if (!active) return record;
    record.state = 'cancel-requested';
    await active.handle.cancel(2000);
    if (this.ctx.storage) await this.ctx.storage.set(storageKey(record.key), record).catch((error) => {
      console.warn('[openchamber-fleet] cancellation succeeded but job state could not be persisted:', error instanceof Error ? error.message : String(error));
    });
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
        await this.persist(job.record);
        continue;
      }
      job.finished = true;
      job.record.state = 'interrupted';
      job.record.endedAt = Date.now();
      job.record.error = 'The Fleet plugin stopped before the job finished.';
      job.record.notified = false;
      if (this.ctx.storage) await this.ctx.storage.set(storageKey(job.record.key), job.record).catch(() => {});
      await job.handle.cancel(2000).catch(() => {});
      job.handle.close();
      await notifyJob(this.ctx, job.record, false);
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
    active.record.notified = false;
    active.handle.close();
    if (await this.persist(active.record)) this.jobs.delete(active.record.key);
    await notifyJob(this.ctx, active.record, true);
  }

  private async fail(active: ActiveJob, error: unknown): Promise<void> {
    if (active.finished) return;
    active.finished = true;
    active.record.state = error instanceof AgentError && error.code === 'OPERATION_UNKNOWN' ? 'unknown' : 'failed';
    active.record.endedAt = Date.now();
    active.record.error = error instanceof Error ? error.message : String(error);
    active.record.notified = false;
    active.handle.close();
    if (await this.persist(active.record)) this.jobs.delete(active.record.key);
    await notifyJob(this.ctx, active.record, true);
  }

  private async persist(record: StoredJob): Promise<boolean> {
    if (!this.ctx.storage) return true;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.ctx.storage.set(storageKey(record.key), record);
        return true;
      } catch (error) {
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
      }
    }
    console.warn('[openchamber-fleet] could not persist terminal job state:', record.jobId);
    return false;
  }
}
