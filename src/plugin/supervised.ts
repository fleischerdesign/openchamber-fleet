/** The plugin half of detached jobs: write requests, read records, notify, cancel. */

import { JobStore } from '../jobs/store.js';
import { readHealthySupervisor } from '../jobs/health.js';
import { readRuntimePointer, resolveStateRoot } from '../jobs/paths.js';
import {
  DEFAULT_POLL_MS,
  RECONCILE_GRACE_MS,
  isTerminal,
  jobKey,
  newJobId,
  type JobRecord,
  type StartRequest,
} from '../jobs/protocol.js';
import { AgentError } from '../v1/errors.js';
import type { StartJobInput } from './jobs.js';
import { isStoredJob, markNotified, notificationID, notifyJob, storageKey } from './notify.js';
import type { PluginContext, StoredJob } from './types.js';

export interface SupervisedJobOptions {
  readonly store?: JobStore;
  readonly now?: () => number;
  readonly pollMs?: number;
  readonly graceMs?: number;
  readonly startupWaitMs?: number;
  readonly startTimeoutMs?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingSession(error: unknown): boolean {
  return /not found|404|unknown session|no such session/i.test(messageOf(error));
}

function disabled(): boolean {
  const value = process.env.FLEET_SUPERVISOR;
  return value === 'off' || value === '0' || value === 'false';
}

export class SupervisedJobRegistry {
  private readonly store: JobStore;
  private readonly now: () => number;
  private readonly pollMs: number;
  private readonly graceMs: number;
  private readonly startupWaitMs: number;
  private readonly startTimeoutMs: number;
  private readonly watching = new Set<string>();
  private readonly unhealthySince = new Map<string, number>();
  private readonly backoffUntil = new Map<string, number>();
  private readonly checkedSessions = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private stopped = false;

  constructor(
    private readonly ctx: PluginContext,
    options: SupervisedJobOptions = {},
  ) {
    this.store = options.store ?? new JobStore(resolveStateRoot());
    this.now = options.now ?? (() => Date.now());
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    this.graceMs = options.graceMs ?? RECONCILE_GRACE_MS;
    this.startupWaitMs = options.startupWaitMs ?? 6000;
    this.startTimeoutMs = options.startTimeoutMs ?? 20_000;
  }

  /** Wait briefly for a supervisor; the service starts one at OpenChamber startup. */
  async available(waitMs = 0): Promise<boolean> {
    if (disabled()) return false;
    const deadline = this.now() + waitMs;
    for (;;) {
      if (this.healthy()) return true;
      if (this.now() >= deadline) return false;
      await delay(100);
    }
  }

  async start(input: StartJobInput): Promise<StoredJob | null> {
    if (!input.sessionID) throw new AgentError('INVALID_REQUEST', 'a session is required for background jobs');
    if (!(await this.available(this.startupWait()))) return null;

    const jobId = newJobId();
    const requestedAt = this.now();
    const sshEnv: Record<string, string> = {};
    if (process.env.SSH_AUTH_SOCK) sshEnv.SSH_AUTH_SOCK = process.env.SSH_AUTH_SOCK;
    if (process.env.SSH_AGENT_PID) sshEnv.SSH_AGENT_PID = process.env.SSH_AGENT_PID;
    const request: StartRequest = {
      version: 1,
      jobId,
      sessionID: input.sessionID,
      workspace: input.config.name,
      directory: this.ctx.location?.directory ?? input.config.dir,
      host: {
        alias: input.host.alias,
        ssh: input.host.ssh,
        port: input.host.port,
        root: input.host.root,
      },
      argv: [...input.argv],
      ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
      env: input.env ?? {},
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(input.expectedGeneration === undefined ? {} : { expectedGeneration: input.expectedGeneration }),
      agentPath: input.agentPath,
      ...(process.env.FLEET_SSH_PATH ? { sshPath: process.env.FLEET_SSH_PATH } : {}),
      ...(Object.keys(sshEnv).length === 0 ? {} : { sshEnv }),
      requestedAt,
    };
    try {
      this.store.ensure();
      this.store.createRequest(request);
    } catch {
      // A broken spool is a reason to use the runtime-bound path, not to fail the job.
      return null;
    }

    const deadline = this.now() + this.startTimeoutMs;
    for (;;) {
      const record = this.store.readJob(jobId);
      if (record) {
        if (isTerminal(record.state)) {
          const stored = this.stored(record);
          // The tool result carries this failure; do not wake the session a second time.
          await markNotified(this.ctx, stored);
          return stored;
        }
        // Watch even while queued or starting: the supervisor may finish before the next poll.
        this.watch(jobId);
        if (record.state === 'running') return this.stored(record);
      }
      if (input.startupSignal?.aborted) {
        if (this.store.abortRequest(jobId)) throw new AgentError('CANCELLED', 'operation cancelled');
      }
      if (this.now() >= deadline) break;
      await delay(100);
    }

    const current = this.store.readJob(jobId);
    if (current) {
      this.watch(jobId);
      return this.stored(current);
    }

    if (this.store.abortRequest(jobId)) {
      // The request never reached a supervisor; the caller can still run it in-process.
      return null;
    }
    // The supervisor claimed the request. Its record write is immediate; wait for it rather
    // than starting a second, runtime-bound job.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const record = this.store.readJob(jobId);
      if (record) {
        this.watch(jobId);
        return this.stored(record);
      }
      await delay(100);
    }
    throw new AgentError('SUPERVISOR_UNAVAILABLE', 'the detached supervisor claimed the job but wrote no record');
  }

  async status(jobId: string, sessionID: string): Promise<StoredJob | null> {
    const record = this.store.readJob(jobId);
    if (!record) return null;
    if (record.sessionID !== sessionID) throw new AgentError('PERMISSION_DENIED', 'job belongs to another session');
    if (!isTerminal(record.state)) this.watch(jobId);
    return this.stored(record);
  }

  async list(sessionID: string): Promise<StoredJob[]> {
    let jobs: JobRecord[];
    try {
      jobs = this.store.listJobs();
    } catch {
      return [];
    }
    return jobs
      .filter((record) => record.sessionID === sessionID)
      .map((record) => this.stored(record))
      .slice(0, 50);
  }

  async cancel(jobId: string, sessionID: string): Promise<StoredJob | null> {
    const record = this.store.readJob(jobId);
    if (!record) return null;
    if (record.sessionID !== sessionID) throw new AgentError('PERMISSION_DENIED', 'job belongs to another session');
    if (isTerminal(record.state)) return this.stored(record);

    if (!this.healthy()) {
      const now = this.now();
      const interrupted: JobRecord = {
        ...record,
        state: 'interrupted',
        updatedAt: now,
        endedAt: now,
        error: 'The detached supervisor is not running; the remote job could not be cancelled.',
      };
      try {
        this.store.writeJob(interrupted);
      } catch {
        // The in-memory view is still the honest one.
      }
      this.watch(jobId);
      return this.stored(interrupted);
    }

    try {
      this.store.writeCancel(jobId);
    } catch (error) {
      throw new AgentError('SUPERVISOR_UNAVAILABLE', `could not write the cancellation request: ${messageOf(error)}`);
    }
    const deadline = this.now() + 3000;
    for (;;) {
      const current = this.store.readJob(jobId);
      if (current && (current.state === 'cancel-requested' || isTerminal(current.state))) return this.stored(current);
      if (this.now() >= deadline) break;
      await delay(100);
    }
    const current = this.store.readJob(jobId) ?? record;
    return this.stored(isTerminal(current.state) ? current : { ...current, state: 'cancel-requested' });
  }

  async cancelSession(sessionID: string): Promise<void> {
    let jobs: JobRecord[];
    try {
      jobs = this.store.listJobs();
    } catch {
      return;
    }
    const healthy = this.healthy();
    for (const record of jobs) {
      if (record.sessionID !== sessionID || isTerminal(record.state)) continue;
      if (healthy) {
        try {
          this.store.writeCancel(record.jobId);
        } catch {
          // Best effort during session deletion.
        }
        continue;
      }
      const now = this.now();
      try {
        this.store.writeJob({
          ...record,
          state: 'interrupted',
          updatedAt: now,
          endedAt: now,
          error: 'The session was deleted while its detached supervisor was unavailable.',
        });
      } catch {
        // Best effort during session deletion.
      }
    }
  }

  /** Start watching records; terminal, undelivered results are notified immediately. */
  async recover(): Promise<void> {
    this.stopped = false;
    try {
      this.store.prune(this.now());
    } catch {
      // A missing spool has nothing to reconcile.
    }
    this.ensureTimer();
    await this.tick();
  }

  /** Stop watching. Detached jobs are deliberately not cancelled. */
  cleanup(): void {
    this.stopped = true;
    this.stopTimer();
    this.watching.clear();
    this.unhealthySince.clear();
    this.backoffUntil.clear();
    this.checkedSessions.clear();
  }

  private async tick(): Promise<void> {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      const healthy = this.healthy();
      let jobs: JobRecord[];
      try {
        jobs = this.store.listJobs();
      } catch {
        jobs = [];
      }
      const directory = this.ctx.location?.directory;
      const seen = new Set<string>();
      for (const record of jobs) {
        if (directory && record.directory !== directory) continue;
        seen.add(record.jobId);
        if (!isTerminal(record.state) && directory && this.ctx.session?.get && !this.checkedSessions.has(record.sessionID)) {
          try {
            await this.ctx.session.get({ sessionID: record.sessionID });
            this.checkedSessions.add(record.sessionID);
          } catch (error) {
            this.checkedSessions.add(record.sessionID);
            if (isMissingSession(error)) {
              if (healthy) {
                try {
                  this.store.writeCancel(record.jobId);
                } catch {
                  // The grace path below handles an unavailable supervisor.
                }
              } else {
                const now = this.now();
                try {
                  this.store.writeJob({
                    ...record,
                    state: 'interrupted',
                    updatedAt: now,
                    endedAt: now,
                    error: 'The session was deleted while its detached job was running.',
                  });
                } catch {
                  // The normal grace path reports it as interrupted.
                }
              }
              this.watching.add(record.jobId);
              continue;
            }
          }
        }
        if (isTerminal(record.state)) {
          this.unhealthySince.delete(record.jobId);
          const stored = this.stored(record);
          if (await this.ledgerNotified(stored)) {
            this.watching.delete(record.jobId);
            this.backoffUntil.delete(record.jobId);
            continue;
          }
          if (this.now() < (this.backoffUntil.get(record.jobId) ?? 0)) {
            this.watching.add(record.jobId);
            continue;
          }
          const delivered = await notifyJob(this.ctx, stored, record.state !== 'interrupted');
          if (delivered) {
            this.watching.delete(record.jobId);
            this.backoffUntil.delete(record.jobId);
          } else {
            this.watching.add(record.jobId);
            this.backoffUntil.set(record.jobId, this.now() + 5000);
          }
          continue;
        }

        this.watching.add(record.jobId);
        if (healthy) {
          this.unhealthySince.delete(record.jobId);
          continue;
        }
        const since = this.unhealthySince.get(record.jobId) ?? this.now();
        this.unhealthySince.set(record.jobId, since);
        if (this.now() - since < this.graceMs) continue;
        const now = this.now();
        const interrupted: JobRecord = {
          ...record,
          state: 'interrupted',
          updatedAt: now,
          endedAt: now,
          error: 'The detached supervisor is not running; the job cannot continue.',
        };
        try {
          this.store.writeJob(interrupted);
        } catch (error) {
          console.warn('[openchamber-fleet] could not persist interrupted job:', messageOf(error));
          continue;
        }
        const stored = this.stored(interrupted);
        const delivered = await notifyJob(this.ctx, stored, false);
        this.watching.delete(record.jobId);
        this.unhealthySince.delete(record.jobId);
        if (!delivered) {
          this.watching.add(record.jobId);
          this.backoffUntil.set(record.jobId, this.now() + 5000);
        }
      }
      for (const jobId of [...this.watching]) {
        if (!seen.has(jobId)) this.watching.delete(jobId);
      }
      for (const jobId of [...this.unhealthySince.keys()]) {
        if (!seen.has(jobId)) this.unhealthySince.delete(jobId);
      }
      for (const jobId of [...this.backoffUntil.keys()]) {
        if (!seen.has(jobId)) this.backoffUntil.delete(jobId);
      }
    } finally {
      this.ticking = false;
      if (this.watching.size === 0 && this.backoffUntil.size === 0) this.stopTimer();
    }
  }

  private watch(jobId: string): void {
    this.watching.add(jobId);
    this.ensureTimer();
  }

  private ensureTimer(): void {
    if (this.stopped || this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollMs);
    this.timer.unref?.();
  }

  private stopTimer(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Wait only when a service pointer suggests a supervisor is starting; npm-only users fall through. */
  private startupWait(): number {
    if (process.env.FLEET_STATE_DIR) return this.startupWaitMs;
    try {
      if (readRuntimePointer()) return this.startupWaitMs;
    } catch {
      // No pointer: no extension service to wait for.
    }
    return 0;
  }

  private healthy(): boolean {
    try {
      return readHealthySupervisor(this.store, this.now()) !== null;
    } catch {
      return false;
    }
  }

  private async ledgerNotified(record: StoredJob): Promise<boolean> {
    if (!this.ctx.storage) return false;
    try {
      const value = await this.ctx.storage.get(storageKey(record.key));
      return isStoredJob(value) && value.notified === true;
    } catch {
      return false;
    }
  }

  private stored(record: JobRecord): StoredJob {
    const key = jobKey(record.workspace, record.host.alias, record.jobId);
    return {
      key,
      jobId: record.jobId,
      sessionID: record.sessionID,
      workspace: record.workspace,
      directory: record.directory,
      host: record.host.alias,
      argv: [...record.argv],
      state: record.state,
      supervised: true,
      ...(record.remoteJobId === undefined ? {} : { remoteJobId: record.remoteJobId }),
      exitCode: record.exitCode ?? null,
      signal: record.signal ?? null,
      notificationID: notificationID(key),
      startedAt: record.startedAt,
      updatedAt: record.updatedAt,
      ...(record.endedAt === undefined ? {} : { endedAt: record.endedAt }),
      stdoutBytes: record.stdoutBytes,
      stderrBytes: record.stderrBytes,
      stdoutTail: record.stdoutTail,
      stderrTail: record.stderrTail,
      ...(record.error === undefined ? {} : { error: record.error }),
      notified: false,
    };
  }
}
