/** The file spool: one atomic JSON file per job, request, cancel marker and heartbeat. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ensurePrivateDir, listJsonFiles, readJsonFile, removeFile, writeJsonAtomic } from './io.js';
import { JOB_RETENTION_MS, isJobRecord, isSupervisorDiscovery, isSupervisorDrain, isSupervisorLock, isTerminal, } from './protocol.js';
const LOG_LIMIT = 2 * 1024 * 1024;
const LOG_KEEP = 1024 * 1024;
export class JobStore {
    root;
    constructor(root) {
        this.root = root;
    }
    get jobsDir() {
        return path.join(this.root, 'jobs');
    }
    get requestsDir() {
        return path.join(this.root, 'requests');
    }
    get claimedDir() {
        return path.join(this.root, 'requests', 'claimed');
    }
    get abortedDir() {
        return path.join(this.root, 'requests', 'aborted');
    }
    get cancelDir() {
        return path.join(this.root, 'cancel');
    }
    get supervisorPath() {
        return path.join(this.root, 'supervisor.json');
    }
    get lockPath() {
        return path.join(this.root, 'supervisor.lock');
    }
    get drainPath() {
        return path.join(this.root, 'supervisor.drain.json');
    }
    get logPath() {
        return path.join(this.root, 'supervisor.log');
    }
    ensure() {
        ensurePrivateDir(this.root);
        ensurePrivateDir(this.jobsDir);
        ensurePrivateDir(this.requestsDir);
        ensurePrivateDir(this.claimedDir);
        ensurePrivateDir(this.abortedDir);
        ensurePrivateDir(this.cancelDir);
        for (const directory of [this.jobsDir, this.requestsDir, this.claimedDir, this.abortedDir, this.cancelDir]) {
            for (const entry of fs.readdirSync(directory)) {
                if (!entry.startsWith('.') || !entry.includes('.tmp-'))
                    continue;
                removeFile(path.join(directory, entry));
            }
        }
        for (const entry of fs.readdirSync(this.abortedDir)) {
            removeFile(path.join(this.abortedDir, entry));
        }
    }
    // ---- discovery and lock -------------------------------------------------
    readSupervisor() {
        const value = readJsonFile(this.supervisorPath);
        return isSupervisorDiscovery(value) ? value : null;
    }
    writeSupervisor(record) {
        writeJsonAtomic(this.supervisorPath, record);
    }
    removeSupervisor(instance) {
        if (instance === undefined) {
            removeFile(this.supervisorPath);
            return;
        }
        const current = this.readSupervisor();
        if (current?.instance === instance)
            removeFile(this.supervisorPath);
    }
    readLock() {
        const value = readJsonFile(this.lockPath);
        return isSupervisorLock(value) ? value : null;
    }
    createLock(lock) {
        ensurePrivateDir(this.root);
        const temporary = `${this.lockPath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
        try {
            fs.writeFileSync(temporary, `${JSON.stringify(lock, null, 2)}\n`, { mode: 0o600 });
            // link is an atomic publish that also fails if a lock already exists.
            // The lock file is therefore never visible with a partial body.
            fs.linkSync(temporary, this.lockPath);
        }
        catch (error) {
            if (error.code === 'EEXIST')
                return false;
            throw error;
        }
        finally {
            removeFile(temporary);
        }
        try {
            fs.chmodSync(this.lockPath, 0o600);
        }
        catch {
            // Windows.
        }
        return true;
    }
    releaseLock(instance) {
        const current = this.readLock();
        if (current?.instance === instance)
            removeFile(this.lockPath);
    }
    clearLock(instance) {
        if (instance === undefined) {
            removeFile(this.lockPath);
            return;
        }
        if (this.readLock()?.instance === instance)
            removeFile(this.lockPath);
    }
    ownsLock(instance) {
        return this.readLock()?.instance === instance;
    }
    requestDrain(instance) {
        writeJsonAtomic(this.drainPath, {
            instance,
            requestedAt: Date.now(),
        });
    }
    readDrain() {
        const value = readJsonFile(this.drainPath);
        return isSupervisorDrain(value) ? value : null;
    }
    clearDrain(instance) {
        if (instance === undefined) {
            removeFile(this.drainPath);
            return;
        }
        if (this.readDrain()?.instance === instance)
            removeFile(this.drainPath);
    }
    // ---- requests -----------------------------------------------------------
    createRequest(request) {
        writeJsonAtomic(this.requestPath(request.jobId), request);
    }
    listRequestIds() {
        return listJsonFiles(this.requestsDir)
            .map((file) => file.slice(0, -'.json'.length))
            .filter((id) => !id.includes('/'));
    }
    readRequest(jobId) {
        return readJsonFile(this.requestPath(jobId));
    }
    readClaimedRequest(jobId) {
        return readJsonFile(this.claimedPath(jobId));
    }
    claimRequest(jobId) {
        try {
            fs.renameSync(this.requestPath(jobId), this.claimedPath(jobId));
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return { claimed: false, value: null };
            throw error;
        }
        return { claimed: true, value: readJsonFile(this.claimedPath(jobId)) };
    }
    abortRequest(jobId) {
        const target = path.join(this.abortedDir, `${jobId}.json`);
        try {
            fs.renameSync(this.requestPath(jobId), target);
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return false;
            throw error;
        }
        removeFile(target);
        return true;
    }
    deleteRequest(jobId) {
        removeFile(this.requestPath(jobId));
    }
    hasClaimed(jobId) {
        try {
            return fs.lstatSync(this.claimedPath(jobId)).isFile();
        }
        catch {
            return false;
        }
    }
    listClaimedIds() {
        return listJsonFiles(this.claimedDir).map((file) => file.slice(0, -'.json'.length));
    }
    deleteClaimed(jobId) {
        removeFile(this.claimedPath(jobId));
    }
    requestPath(jobId) {
        return path.join(this.requestsDir, `${jobId}.json`);
    }
    claimedPath(jobId) {
        return path.join(this.claimedDir, `${jobId}.json`);
    }
    // ---- cancellation -------------------------------------------------------
    writeCancel(jobId) {
        writeJsonAtomic(path.join(this.cancelDir, `${jobId}.json`), { jobId, requestedAt: Date.now() });
    }
    listCancelIds() {
        return listJsonFiles(this.cancelDir).map((file) => file.slice(0, -'.json'.length));
    }
    deleteCancel(jobId) {
        removeFile(path.join(this.cancelDir, `${jobId}.json`));
    }
    // ---- job records --------------------------------------------------------
    readJob(jobId) {
        const value = readJsonFile(path.join(this.jobsDir, `${jobId}.json`));
        return isJobRecord(value) ? value : null;
    }
    writeJob(record) {
        writeJsonAtomic(path.join(this.jobsDir, `${record.jobId}.json`), record);
    }
    listJobs() {
        const jobs = [];
        for (const file of listJsonFiles(this.jobsDir)) {
            const value = readJsonFile(path.join(this.jobsDir, file));
            if (isJobRecord(value))
                jobs.push(value);
        }
        return jobs.sort((left, right) => right.startedAt - left.startedAt);
    }
    prune(now = Date.now()) {
        let removed = 0;
        for (const job of this.listJobs()) {
            if (!isTerminal(job.state))
                continue;
            const ended = job.endedAt ?? job.startedAt;
            if (ended + JOB_RETENTION_MS >= now)
                continue;
            removeFile(path.join(this.jobsDir, `${job.jobId}.json`));
            removed += 1;
        }
        return removed;
    }
    // ---- operator log -------------------------------------------------------
    log(message) {
        const line = `[${new Date().toISOString()}] ${message}\n`;
        try {
            fs.appendFileSync(this.logPath, line, { mode: 0o600 });
            const stat = fs.statSync(this.logPath);
            if (stat.size <= LOG_LIMIT)
                return;
            const content = fs.readFileSync(this.logPath);
            const tail = content.subarray(Math.max(0, content.length - LOG_KEEP));
            const temporary = `${this.logPath}.tmp-${process.pid}`;
            fs.writeFileSync(temporary, tail, { mode: 0o600 });
            fs.renameSync(temporary, this.logPath);
        }
        catch {
            // Logging must never change a job's outcome.
        }
    }
}
//# sourceMappingURL=store.js.map