/** Liveness checks for the detached supervisor, shared by the plugin and the service. */

import os from 'node:os';
import type { JobStore } from './store.js';
import {
  HEARTBEAT_STALE_MS,
  SUPERVISOR_PROTOCOL,
  type SupervisorDiscovery,
  type SupervisorLock,
} from './protocol.js';

const BOOT_TOLERANCE_MS = 10_000;
const CLOCK_SKEW_MS = 5_000;

export function currentBootTime(now = Date.now()): number {
  return Math.round(now - os.uptime() * 1000);
}

export function sameBoot(left: number, right: number): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= BOOT_TOLERANCE_MS;
}

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function supervisorHealthy(record: SupervisorDiscovery | null, now = Date.now()): record is SupervisorDiscovery {
  if (!record || record.protocol !== SUPERVISOR_PROTOCOL) return false;
  if (!sameBoot(record.bootTime, currentBootTime(now))) return false;
  if (record.updatedAt > now + CLOCK_SKEW_MS) return false;
  if (now - record.updatedAt > HEARTBEAT_STALE_MS) return false;
  return pidAlive(record.pid);
}

export function readHealthySupervisor(store: JobStore, now = Date.now()): SupervisorDiscovery | null {
  const record = store.readSupervisor();
  return supervisorHealthy(record, now) ? record : null;
}

export type SupervisorVersionDecision = 'start' | 'reuse' | 'replace' | 'defer';

/** Decide whether a healthy supervisor can serve this build, must wait, or may be retired. */
export function supervisorVersionDecision(
  record: SupervisorDiscovery | null,
  version: string,
): SupervisorVersionDecision {
  if (!record) return 'start';
  if (record.draining === true) return 'defer';
  if (record.version === version) return 'reuse';
  return (record.activeJobs ?? 0) > 0 ? 'defer' : 'replace';
}

/** A lock without discovery is a supervisor that is still starting; do not spawn a second. */
export function lockActive(lock: SupervisorLock | null, now = Date.now()): lock is SupervisorLock {
  if (!lock || lock.protocol !== SUPERVISOR_PROTOCOL) return false;
  if (!sameBoot(lock.bootTime, currentBootTime(now))) return false;
  return pidAlive(lock.pid);
}
