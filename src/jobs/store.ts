/** The file spool: one atomic JSON file per job, request, cancel marker and heartbeat. */

import fs from 'node:fs';
import path from 'node:path';
import { ensurePrivateDir, listJsonFiles, readJsonFile, removeFile, writeJsonAtomic } from './io.js';
import {
  JOB_RETENTION_MS,
  isJobRecord,
  isSupervisorDiscovery,
  isSupervisorLock,
  isTerminal,
  type JobRecord,
  type StartRequest,
  type SupervisorDiscovery,
  type SupervisorLock,
} from './protocol.js';

const LOG_LIMIT = 2 * 1024 * 1024;
const LOG_KEEP = 1024 * 1024;

export class JobStore {
  constructor(readonly root: string) {}

  private get jobsDir(): string {
    return path.join(this.root, 'jobs');
  }

  private get requestsDir(): string {
    return path.join(this.root, 'requests');
  }

  private get claimedDir(): string {
    return path.join(this.root, 'requests', 'claimed');
  }

  private get abortedDir(): string {
    return path.join(this.root, 'requests', 'aborted');
  }

  private get cancelDir(): string {
    return path.join(this.root, 'cancel');
  }

  private get supervisorPath(): string {
    return path.join(this.root, 'supervisor.json');
  }

  private get lockPath(): string {
    return path.join(this.root, 'supervisor.lock');
  }

  private get logPath(): string {
    return path.join(this.root, 'supervisor.log');
  }

  ensure(): void {
    ensurePrivateDir(this.root);
    ensurePrivateDir(this.jobsDir);
    ensurePrivateDir(this.requestsDir);
    ensurePrivateDir(this.claimedDir);
    ensurePrivateDir(this.abortedDir);
    ensurePrivateDir(this.cancelDir);
    for (const directory of [this.jobsDir, this.requestsDir, this.claimedDir, this.abortedDir, this.cancelDir]) {
      for (const entry of fs.readdirSync(directory)) {
        if (!entry.startsWith('.') || !entry.includes('.tmp-')) continue;
        removeFile(path.join(directory, entry));
      }
    }
    for (const entry of fs.readdirSync(this.abortedDir)) {
      removeFile(path.join(this.abortedDir, entry));
    }
  }

  // ---- discovery and lock -------------------------------------------------

  readSupervisor(): SupervisorDiscovery | null {
    const value = readJsonFile(this.supervisorPath);
    return isSupervisorDiscovery(value) ? value : null;
  }

  writeSupervisor(record: SupervisorDiscovery): void {
    writeJsonAtomic(this.supervisorPath, record);
  }

  removeSupervisor(instance?: string): void {
    if (instance === undefined) {
      removeFile(this.supervisorPath);
      return;
    }
    const current = this.readSupervisor();
    if (current?.instance === instance) removeFile(this.supervisorPath);
  }

  readLock(): SupervisorLock | null {
    const value = readJsonFile(this.lockPath);
    return isSupervisorLock(value) ? value : null;
  }

  createLock(lock: SupervisorLock): boolean {
    ensurePrivateDir(this.root);
    let descriptor: number;
    try {
      descriptor = fs.openSync(this.lockPath, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(lock, null, 2)}\n`);
    } finally {
      fs.closeSync(descriptor);
    }
    try {
      fs.chmodSync(this.lockPath, 0o600);
    } catch {
      // Windows.
    }
    return true;
  }

  releaseLock(instance: string): void {
    const current = this.readLock();
    if (current?.instance === instance) removeFile(this.lockPath);
  }

  clearLock(): void {
    removeFile(this.lockPath);
  }

  ownsLock(instance: string): boolean {
    return this.readLock()?.instance === instance;
  }

  // ---- requests -----------------------------------------------------------

  createRequest(request: StartRequest): void {
    writeJsonAtomic(this.requestPath(request.jobId), request);
  }

  listRequestIds(): string[] {
    return listJsonFiles(this.requestsDir)
      .map((file) => file.slice(0, -'.json'.length))
      .filter((id) => !id.includes('/'));
  }

  readRequest(jobId: string): unknown {
    return readJsonFile(this.requestPath(jobId));
  }

  readClaimedRequest(jobId: string): unknown {
    return readJsonFile(this.claimedPath(jobId));
  }

  claimRequest(jobId: string): { claimed: boolean; value: unknown } {
    try {
      fs.renameSync(this.requestPath(jobId), this.claimedPath(jobId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { claimed: false, value: null };
      throw error;
    }
    return { claimed: true, value: readJsonFile(this.claimedPath(jobId)) };
  }

  abortRequest(jobId: string): boolean {
    const target = path.join(this.abortedDir, `${jobId}.json`);
    try {
      fs.renameSync(this.requestPath(jobId), target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
    removeFile(target);
    return true;
  }

  deleteRequest(jobId: string): void {
    removeFile(this.requestPath(jobId));
  }

  hasClaimed(jobId: string): boolean {
    try {
      return fs.lstatSync(this.claimedPath(jobId)).isFile();
    } catch {
      return false;
    }
  }

  listClaimedIds(): string[] {
    return listJsonFiles(this.claimedDir).map((file) => file.slice(0, -'.json'.length));
  }

  deleteClaimed(jobId: string): void {
    removeFile(this.claimedPath(jobId));
  }

  private requestPath(jobId: string): string {
    return path.join(this.requestsDir, `${jobId}.json`);
  }

  private claimedPath(jobId: string): string {
    return path.join(this.claimedDir, `${jobId}.json`);
  }

  // ---- cancellation -------------------------------------------------------

  writeCancel(jobId: string): void {
    writeJsonAtomic(path.join(this.cancelDir, `${jobId}.json`), { jobId, requestedAt: Date.now() });
  }

  listCancelIds(): string[] {
    return listJsonFiles(this.cancelDir).map((file) => file.slice(0, -'.json'.length));
  }

  deleteCancel(jobId: string): void {
    removeFile(path.join(this.cancelDir, `${jobId}.json`));
  }

  // ---- job records --------------------------------------------------------

  readJob(jobId: string): JobRecord | null {
    const value = readJsonFile(path.join(this.jobsDir, `${jobId}.json`));
    return isJobRecord(value) ? value : null;
  }

  writeJob(record: JobRecord): void {
    writeJsonAtomic(path.join(this.jobsDir, `${record.jobId}.json`), record);
  }

  listJobs(): JobRecord[] {
    const jobs: JobRecord[] = [];
    for (const file of listJsonFiles(this.jobsDir)) {
      const value = readJsonFile(path.join(this.jobsDir, file));
      if (isJobRecord(value)) jobs.push(value);
    }
    return jobs.sort((left, right) => right.startedAt - left.startedAt);
  }

  prune(now = Date.now()): number {
    let removed = 0;
    for (const job of this.listJobs()) {
      if (!isTerminal(job.state)) continue;
      const ended = job.endedAt ?? job.startedAt;
      if (ended + JOB_RETENTION_MS >= now) continue;
      removeFile(path.join(this.jobsDir, `${job.jobId}.json`));
      removed += 1;
    }
    return removed;
  }

  // ---- operator log -------------------------------------------------------

  log(message: string): void {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    try {
      fs.appendFileSync(this.logPath, line, { mode: 0o600 });
      const stat = fs.statSync(this.logPath);
      if (stat.size <= LOG_LIMIT) return;
      const content = fs.readFileSync(this.logPath);
      const tail = content.subarray(Math.max(0, content.length - LOG_KEEP));
      const temporary = `${this.logPath}.tmp-${process.pid}`;
      fs.writeFileSync(temporary, tail, { mode: 0o600 });
      fs.renameSync(temporary, this.logPath);
    } catch {
      // Logging must never change a job's outcome.
    }
  }
}
