/** Routes background work to the detached supervisor when it is available. */

import type { HostConfig, WorkspaceConfig } from '../config.js';
import { AgentError } from '../v1/errors.js';
import { FleetJobRegistry, type JobExecutor, type StartJobInput } from './jobs.js';
import { SupervisedJobRegistry, type SupervisedJobOptions } from './supervised.js';
import type { PluginContext, StoredJob } from './types.js';

export interface BackgroundJobsOptions {
  readonly inProcess?: FleetJobRegistry;
  readonly supervised?: SupervisedJobRegistry;
  readonly supervisedOptions?: SupervisedJobOptions;
  readonly executor?: JobExecutor;
}

export class BackgroundJobs {
  private readonly inProcess: FleetJobRegistry;
  private readonly supervised: SupervisedJobRegistry;
  private readonly deletion = new AbortController();

  constructor(
    private readonly ctx: PluginContext,
    agentPath: string,
    options: BackgroundJobsOptions = {},
  ) {
    this.inProcess = options.inProcess ?? new FleetJobRegistry(ctx, agentPath, options.executor);
    this.supervised = options.supervised ?? new SupervisedJobRegistry(ctx, options.supervisedOptions);
  }

  async start(input: StartJobInput): Promise<StoredJob> {
    const detached = await this.supervised.start(input);
    if (detached) return detached;
    return this.inProcess.start(input);
  }

  async status(jobId: string, sessionID: string): Promise<StoredJob | null> {
    const detached = await this.supervised.status(jobId, sessionID);
    if (detached) return detached;
    return this.inProcess.status(jobId, sessionID).catch((error: unknown) => {
      if (error instanceof AgentError && error.code === 'OPERATION_UNKNOWN') return null;
      throw error;
    });
  }

  async list(sessionID: string): Promise<StoredJob[]> {
    const [detached, inProcess] = await Promise.all([
      this.supervised.list(sessionID),
      this.inProcess.list(sessionID),
    ]);
    const merged = new Map<string, StoredJob>();
    for (const record of [...inProcess, ...detached]) merged.set(record.key, record);
    return [...merged.values()].sort((left, right) => right.startedAt - left.startedAt).slice(0, 50);
  }

  async cancel(jobId: string, sessionID: string): Promise<StoredJob> {
    const detached = await this.supervised.status(jobId, sessionID);
    if (detached?.supervised === true) {
      const cancelled = await this.supervised.cancel(jobId, sessionID);
      if (cancelled) return cancelled;
    }
    return this.inProcess.cancel(jobId, sessionID);
  }

  async cancelSession(sessionID: string): Promise<void> {
    await this.supervised.cancelSession(sessionID);
    await this.inProcess.cancelSession(sessionID);
  }

  async recoverInterrupted(): Promise<void> {
    await this.inProcess.recoverInterrupted();
    await this.supervised.recover();
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

  async cleanup(): Promise<void> {
    this.deletion.abort();
    await this.inProcess.cleanup();
    this.supervised.cleanup();
  }
}
