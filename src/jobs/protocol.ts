/** Shared types and validation for detached Fleet jobs. */

import crypto from 'node:crypto';

export const SUPERVISOR_PROTOCOL = 1;
export const JOB_RECORD_VERSION = 1;
export const JOB_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const HEARTBEAT_STALE_MS = 30_000;
export const RECONCILE_GRACE_MS = 10_000;
export const START_TIMEOUT_MS = 20_000;
export const MAX_ACTIVE_JOBS = 8;
export const DEFAULT_POLL_MS = 1_000;

export const TERMINAL_STATES: ReadonlySet<string> = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
  'unknown',
]);

export type JobState =
  | 'queued'
  | 'starting'
  | 'running'
  | 'cancel-requested'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'unknown';

export interface JobHost {
  readonly alias: string;
  readonly ssh: string;
  readonly port: number;
  readonly root: string;
}

export interface JobSupervisor {
  readonly pid: number;
  readonly instance: string;
  readonly startedAt: number;
  readonly version: string;
}

export interface JobRecord {
  readonly version: number;
  readonly jobId: string;
  readonly sessionID: string;
  readonly workspace: string;
  readonly directory: string;
  readonly host: JobHost;
  readonly argv: string[];
  readonly cwd?: string;
  state: string;
  remoteJobId?: string;
  startedAt: number;
  updatedAt: number;
  endedAt?: number;
  exitCode?: number | null;
  signal?: number | null;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTail: string;
  stderrTail: string;
  error?: string;
  readonly supervisor: JobSupervisor;
}

export interface StartRequest {
  readonly version: number;
  readonly jobId: string;
  readonly sessionID: string;
  readonly workspace: string;
  readonly directory: string;
  readonly host: JobHost;
  readonly argv: string[];
  readonly cwd?: string;
  readonly env: Record<string, string>;
  readonly timeoutMs?: number;
  /** Replica generation the caller synchronized against. */
  readonly expectedGeneration?: number;
  readonly agentPath: string;
  readonly sshPath?: string;
  readonly sshEnv?: Record<string, string>;
  readonly requestedAt: number;
}

export interface SupervisorDiscovery {
  readonly protocol: number;
  readonly version: string;
  readonly instance: string;
  readonly pid: number;
  readonly startedAt: number;
  readonly bootTime: number;
  readonly updatedAt: number;
  readonly stateRoot: string;
  readonly activeJobs: number;
}

export interface SupervisorLock {
  readonly protocol: number;
  readonly version: string;
  readonly instance: string;
  readonly pid: number;
  readonly startedAt: number;
  readonly bootTime: number;
}

export interface RuntimePointer {
  readonly version: number;
  readonly stateRoot: string;
  readonly servicePid: number;
  readonly updatedAt: number;
}

export interface ServiceHeartbeat {
  readonly pid: number;
  readonly updatedAt: number;
}

export const JOB_ID = /^job-[a-f0-9]{16,64}$/;
export const INSTANCE_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function newJobId(): string {
  return `job-${crypto.randomBytes(12).toString('hex')}`;
}

export function jobKey(workspace: string, host: string, jobId: string): string {
  return `${workspace}\0${host}\0${jobId}`;
}

export function isTerminal(state: string): boolean {
  return TERMINAL_STATES.has(state);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isHost(value: unknown): value is JobHost {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.alias)
    && isNonEmptyString(value.ssh)
    && isInteger(value.port)
    && value.port >= 1
    && value.port <= 65535
    && isNonEmptyString(value.root);
}

function isSupervisor(value: unknown): value is JobSupervisor {
  if (!isRecord(value)) return false;
  return isInteger(value.pid)
    && value.pid > 0
    && isNonEmptyString(value.instance)
    && isInteger(value.startedAt)
    && isNonEmptyString(value.version);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0);
}

function isEnv(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([key, entry]) => key.length > 0 && typeof entry === 'string');
}

export function isJobRecord(value: unknown): value is JobRecord {
  if (!isRecord(value)) return false;
  return value.version === JOB_RECORD_VERSION
    && typeof value.jobId === 'string' && JOB_ID.test(value.jobId)
    && isNonEmptyString(value.sessionID)
    && isNonEmptyString(value.workspace)
    && isNonEmptyString(value.directory)
    && isHost(value.host)
    && isStringArray(value.argv)
    && typeof value.state === 'string'
    && isInteger(value.startedAt)
    && isInteger(value.updatedAt)
    && isInteger(value.stdoutBytes)
    && isInteger(value.stderrBytes)
    && typeof value.stdoutTail === 'string'
    && typeof value.stderrTail === 'string'
    && isSupervisor(value.supervisor)
    && (value.cwd === undefined || typeof value.cwd === 'string')
    && (value.remoteJobId === undefined || typeof value.remoteJobId === 'string')
    && (value.endedAt === undefined || isInteger(value.endedAt))
    && (value.exitCode === undefined || value.exitCode === null || isInteger(value.exitCode))
    && (value.signal === undefined || value.signal === null || isInteger(value.signal))
    && (value.error === undefined || typeof value.error === 'string');
}

export function isStartRequest(value: unknown): value is StartRequest {
  if (!isRecord(value)) return false;
  return value.version === JOB_RECORD_VERSION
    && typeof value.jobId === 'string' && JOB_ID.test(value.jobId)
    && isNonEmptyString(value.sessionID)
    && isNonEmptyString(value.workspace)
    && isNonEmptyString(value.directory)
    && isHost(value.host)
    && isStringArray(value.argv)
    && (value.cwd === undefined || typeof value.cwd === 'string')
    && isEnv(value.env)
    && (value.timeoutMs === undefined || (isInteger(value.timeoutMs) && value.timeoutMs > 0))
    && (value.expectedGeneration === undefined || isInteger(value.expectedGeneration))
    && isNonEmptyString(value.agentPath)
    && (value.sshPath === undefined || isNonEmptyString(value.sshPath))
    && (value.sshEnv === undefined || isEnv(value.sshEnv))
    && isInteger(value.requestedAt);
}

export function isSupervisorDiscovery(value: unknown): value is SupervisorDiscovery {
  if (!isRecord(value)) return false;
  return value.protocol === SUPERVISOR_PROTOCOL
    && isNonEmptyString(value.version)
    && isNonEmptyString(value.instance)
    && isInteger(value.pid) && value.pid > 0
    && isInteger(value.startedAt)
    && isInteger(value.bootTime)
    && isInteger(value.updatedAt)
    && isNonEmptyString(value.stateRoot)
    && isInteger(value.activeJobs);
}

export function isSupervisorLock(value: unknown): value is SupervisorLock {
  if (!isRecord(value)) return false;
  return value.protocol === SUPERVISOR_PROTOCOL
    && isNonEmptyString(value.version)
    && isNonEmptyString(value.instance)
    && isInteger(value.pid) && value.pid > 0
    && isInteger(value.startedAt)
    && isInteger(value.bootTime);
}

export function isRuntimePointer(value: unknown): value is RuntimePointer {
  if (!isRecord(value)) return false;
  return value.version === 1
    && isNonEmptyString(value.stateRoot)
    && isInteger(value.servicePid)
    && isInteger(value.updatedAt);
}

export function isServiceHeartbeat(value: unknown): value is ServiceHeartbeat {
  if (!isRecord(value)) return false;
  return isInteger(value.pid) && value.pid > 0 && isInteger(value.updatedAt);
}
