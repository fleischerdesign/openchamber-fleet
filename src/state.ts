/** Controller-side state: one JSON file, atomic writes, file leases, run records. */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FleetError } from './errors.js';

export const LEASE_TTL_MS = 30 * 60 * 1000;

export interface WorkspaceState {
  revision?: string;
  excludes?: string[];
  planDigest?: string;
  appliedAt?: string;
  verifiedAt?: string;
}

export interface FleetState {
  version: 1;
  workspaces: Record<string, WorkspaceState>;
}

export interface Lease {
  runId: string;
  pid: number;
  startedAt: string;
  expiresAt: string;
}

export interface RunRecord {
  runId: string;
  kind: 'sync' | 'exec' | 'fetch';
  host: string;
  workspace: string;
  revision?: string;
  planDigest?: string;
  command?: string;
  exitCode?: number | null;
  startedAt: string;
  endedAt?: string;
  outputBytes?: number;
  user?: string;
  controller?: string;
  allowStale?: boolean;
}

export function stateDir(): string {
  return process.env.FLEET_STATE_DIR ?? path.join(os.homedir(), '.local', 'state', 'openchamber-fleet');
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* best effort on exotic filesystems */ }
}

export function stateFile(): string {
  return path.join(stateDir(), 'state.json');
}

export function readState(): FleetState {
  const file = stateFile();
  if (!fs.existsSync(file)) return { version: 1, workspaces: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new FleetError('state-corrupt', `state file ${file} is not valid JSON: ${reason}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new FleetError('state-corrupt', `state file ${file} must contain an object`);
  }
  const candidate = parsed as Partial<FleetState>;
  if (candidate.version !== 1 || typeof candidate.workspaces !== 'object' || candidate.workspaces === null) {
    throw new FleetError('state-corrupt', `state file ${file} has an unsupported shape`);
  }
  return candidate as FleetState;
}

export function updateState(mutate: (state: FleetState) => FleetState | void): FleetState {
  ensureDir(stateDir());
  const release = acquireFileLock(path.join(stateDir(), 'state.lock'));
  try {
    const state = readState();
    const next = mutate(state) ?? state;
    writeJsonAtomic(stateFile(), next, 0o600);
    return next;
  } finally {
    release();
  }
}

export function writeJsonAtomic(file: string, value: unknown, mode = 0o600): void {
  ensureDir(path.dirname(file));
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode });
  fs.renameSync(temporary, file);
}

function acquireFileLock(lockPath: string): () => void {
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return () => { try { fs.unlinkSync(lockPath); } catch { /* already gone */ } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() > deadline) {
        throw new FleetError('lease-busy', 'state file is locked by another process', { lock: lockPath });
      }
      sleep(25);
    }
  }
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function newRunId(): string {
  return crypto.randomBytes(6).toString('hex');
}

export function leaseFile(host: string, workspace: string): string {
  return path.join(stateDir(), 'leases', `${host}--${workspace}.lock`);
}

export function readLease(host: string, workspace: string): Lease | null {
  const file = leaseFile(host, workspace);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Lease;
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface AcquireLeaseOptions {
  host: string;
  workspace: string;
  runId?: string;
  ttlMs?: number;
  waitMs?: number;
}

export interface LeaseHandle {
  runId: string;
  release(): void;
}

/**
 * Acquire the workspace lease or fail. Reclaims only an expired lease whose owner is gone.
 */
export function acquireLease(options: AcquireLeaseOptions): LeaseHandle {
  const { host, workspace } = options;
  const runId = options.runId ?? newRunId();
  const ttlMs = options.ttlMs ?? LEASE_TTL_MS;
  const waitMs = options.waitMs ?? 0;
  ensureDir(path.join(stateDir(), 'leases'));
  const file = leaseFile(host, workspace);
  const deadline = Date.now() + waitMs;

  for (;;) {
    const lease: Lease = {
      runId,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    };
    try {
      const fd = fs.openSync(file, 'wx', 0o600);
      fs.writeSync(fd, JSON.stringify(lease));
      fs.closeSync(fd);
      return {
        runId,
        release: (): void => {
          const current = readLease(host, workspace);
          if (current?.runId === runId) {
            try { fs.unlinkSync(file); } catch { /* already gone */ }
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const current = readLease(host, workspace);
      const expired = current === null || Date.parse(current.expiresAt) < Date.now();
      const gone = current === null || !pidAlive(current.pid);
      if (expired && gone) {
        try { fs.unlinkSync(file); } catch { /* raced with another reclaimer */ }
        continue;
      }
      if (Date.now() < deadline) {
        sleep(Math.min(100, Math.max(1, deadline - Date.now())));
        continue;
      }
      throw new FleetError('lease-busy', `${host}/${workspace} is held by run ${current?.runId ?? 'unknown'}`, {
        runId: current?.runId ?? 'unknown',
        ageMs: current ? Date.now() - Date.parse(current.startedAt) : 0,
      });
    }
  }
}

export function recordRun(record: RunRecord): void {
  const dir = path.join(stateDir(), 'runs');
  ensureDir(dir);
  writeJsonAtomic(path.join(dir, `${record.runId}.json`), record, 0o600);
}

export function readRun(runId: string): RunRecord {
  const file = path.join(stateDir(), 'runs', `${runId}.json`);
  if (!fs.existsSync(file)) throw new FleetError('artifact-missing', `no run ${runId}`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as RunRecord;
}

export function runLogPath(runId: string): string {
  const dir = path.join(stateDir(), 'runs');
  ensureDir(dir);
  return path.join(dir, `${runId}.log`);
}

export function recordWorkspace(key: string, entry: WorkspaceState): void {
  updateState((state) => {
    state.workspaces[key] = { ...(state.workspaces[key] ?? {}), ...entry };
  });
}
