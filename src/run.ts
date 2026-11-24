/** Agent-facing run: synchronize when needed, then execute in one operation. */

import { compileExcludes } from './config.js';
import type { HostConfig, WorkspaceConfig } from './config.js';
import { AgentError } from './v1/errors.js';
import {
  execCommand,
  syncWorkspace,
} from './v1/operations.js';
import type {
  ExecOptions,
  ExecProgress,
  ExecResult,
  SyncProgress,
  SyncSummary,
} from './v1/operations.js';
import type { AgentClient } from './v1/client.js';

export type RunSyncMode = 'auto' | 'never' | 'plan' | 'apply';

export interface RunOptions {
  readonly argv: string[];
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly timeoutMs?: number;
  readonly sync?: RunSyncMode;
  readonly excludes?: readonly string[];
  readonly adopt?: boolean;
  readonly signal?: AbortSignal;
  readonly onSyncProgress?: (progress: SyncProgress) => void | Promise<void>;
  readonly onExecProgress?: (progress: ExecProgress) => void | Promise<void>;
  readonly beforeExec?: () => void | Promise<void>;
  readonly retryDelayMs?: number;
}

export interface RunSyncSummary {
  readonly mode: 'plan' | 'apply';
  readonly planDigest: string;
  readonly changes: number;
  readonly changesTruncated: boolean;
  readonly needed: number;
  readonly generation: number | null;
  readonly manifestDigest: string | null;
  readonly items: Array<{ action: string; path: string }>;
}

export interface SyncRunResult {
  readonly sync: RunSyncSummary | null;
  readonly required: boolean;
}

export interface RunResult {
  readonly state: string;
  readonly sync: RunSyncSummary | null;
  readonly exec: ExecResult | null;
}

export interface RunOperations {
  readonly sync: typeof syncWorkspace;
  readonly exec: typeof execCommand;
}

const defaultOperations: RunOperations = {
  sync: syncWorkspace,
  exec: execCommand,
};

function isBusy(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'WORKSPACE_BUSY' || code === 'lease-busy';
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ms <= 0) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new AgentError('CANCELLED', 'operation cancelled'));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function summaryOf(mode: 'plan' | 'apply', result: SyncSummary): RunSyncSummary {
  const items = result.changes.slice(0, 200);
  return {
    mode,
    planDigest: result.planDigest,
    changes: result.changes.length,
    changesTruncated: result.changes.length > items.length,
    needed: result.needed.length,
    generation: result.generation ?? null,
    manifestDigest: result.manifestDigest ?? null,
    items,
  };
}

function excludesOf(config: WorkspaceConfig, extra: readonly string[] | undefined): string[] {
  return [...new Set([...config.excludes, ...(extra ?? [])])];
}

/**
 * Synchronize before a run. `auto` and `apply` apply changes; `plan` reports whether a run would
 * need a sync and leaves the replica untouched; `never` skips the scan entirely.
 */
export async function syncForRun(
  client: AgentClient,
  config: WorkspaceConfig,
  host: HostConfig,
  options: RunOptions,
  operations: Pick<RunOperations, 'sync'> = defaultOperations,
): Promise<SyncRunResult> {
  const requested = options.sync ?? 'auto';
  if (requested === 'never') return { sync: null, required: false };
  const mode = requested === 'plan' ? 'plan' : 'apply';
  const excludes = excludesOf(config, options.excludes);
  const attempts = 3;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = await operations.sync(client, compileExcludes(excludes), {
        workspaceId: config.name,
        source: config.dir,
        root: host.root,
        excludes,
        mode,
        adopt: options.adopt === true,
        signal: options.signal,
        onProgress: options.onSyncProgress,
      });
      const sync = summaryOf(mode, result);
      return { sync, required: mode === 'plan' && sync.changes > 0 };
    } catch (error) {
      if (attempt < attempts - 1 && isBusy(error)) {
        await sleep((options.retryDelayMs ?? 500) * 2 ** attempt, options.signal);
        continue;
      }
      throw error;
    }
  }
}

/**
 * The agent's normal execution path: synchronize the workspace (unless the caller explicitly says
 * no), then run the command. The agent never has to call a separate sync tool for routine work.
 */
export async function runWorkspace(
  client: AgentClient,
  config: WorkspaceConfig,
  host: HostConfig,
  options: RunOptions,
  operations: RunOperations = defaultOperations,
): Promise<RunResult> {
  const { sync, required } = await syncForRun(client, config, host, options, operations);
  if (required) return { state: 'sync-required', sync, exec: null };
  await options.beforeExec?.();

  const execOptions: ExecOptions = {
    workspaceId: config.name,
    root: host.root,
    argv: options.argv,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onExecProgress === undefined ? {} : { onProgress: options.onExecProgress }),
  };

  const attempts = 3;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const exec = await operations.exec(client, execOptions);
      return { state: exec.state, sync, exec };
    } catch (error) {
      if (attempt < attempts - 1 && isBusy(error)) {
        await sleep((options.retryDelayMs ?? 500) * 2 ** attempt, options.signal);
        continue;
      }
      throw error;
    }
  }
}
