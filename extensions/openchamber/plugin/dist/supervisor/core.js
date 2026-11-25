/** The job state machine: claims requests, owns SSH handles, writes durable records. */
import { AgentError } from '../v1/errors.js';
import { connectSsh, startExecCommand } from '../v1/operations.js';
import { JobStore } from '../jobs/store.js';
import { MAX_ACTIVE_JOBS, isStartRequest, isTerminal, } from '../jobs/protocol.js';
const defaultExecutor = {
    connect: (host, options) => connectSsh(host, options),
    start: startExecCommand,
};
function messageOf(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
function tailOf(buffer) {
    return buffer.subarray(Math.max(0, buffer.length - 4096)).toString('utf8');
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export class SupervisorCore {
    store;
    executor;
    now;
    log;
    maxActive;
    supervisor;
    active = new Map();
    starting = new Set();
    pending = new Map();
    queued = [];
    ticking = false;
    stopping = false;
    draining = false;
    constructor(options) {
        this.store = options.store;
        this.executor = options.executor ?? defaultExecutor;
        this.now = options.now ?? (() => Date.now());
        this.log = options.log ?? (() => { });
        this.maxActive = options.maxActive ?? MAX_ACTIVE_JOBS;
        this.supervisor = {
            pid: process.pid,
            instance: options.instance,
            startedAt: options.startedAt,
            version: options.version,
        };
    }
    /** Mark every non-terminal record from an older supervisor instance as interrupted. */
    async recover() {
        this.store.ensure();
        const now = this.now();
        for (const record of this.store.listJobs()) {
            if (isTerminal(record.state))
                continue;
            this.write({
                ...record,
                state: 'interrupted',
                updatedAt: now,
                endedAt: now,
                error: 'The supervisor stopped before the job finished.',
            });
        }
        for (const jobId of this.store.listClaimedIds()) {
            const value = this.store.readClaimedRequest(jobId);
            this.failPending(jobId, value, 'The supervisor restarted before the job started.');
            this.store.deleteClaimed(jobId);
        }
        // Unclaimed requests are safe to process: no client was told they started.
        // A draining supervisor leaves exactly this state for its successor.
        for (const jobId of this.store.listCancelIds())
            this.store.deleteCancel(jobId);
        this.store.prune(now);
    }
    /** Stop accepting new spool requests; accepted work still finishes. */
    beginDrain() {
        if (this.draining || this.stopping)
            return;
        this.draining = true;
        this.log('drain requested: refusing new jobs until accepted work is finished');
    }
    isDraining() {
        return this.draining;
    }
    /** Process cancellations and start requests, then fill free execution slots. */
    async tick() {
        if (this.ticking || this.stopping)
            return;
        this.ticking = true;
        try {
            await this.processCancels();
            if (!this.draining)
                this.processRequests();
            this.pump();
        }
        catch (error) {
            this.log(`tick failed: ${messageOf(error)}`);
        }
        finally {
            this.ticking = false;
        }
    }
    /** Persist the output tails of running jobs without changing their state. */
    persistActive() {
        const now = this.now();
        for (const active of this.active.values()) {
            if (active.closed)
                continue;
            active.record.updatedAt = now;
            this.write(active.record);
        }
    }
    activeCount() {
        return this.active.size;
    }
    pendingCount() {
        return this.active.size + this.starting.size + this.queued.length;
    }
    idle() {
        return this.active.size === 0 && this.starting.size === 0 && this.queued.length === 0 && this.pending.size === 0;
    }
    /** Cancel active jobs, give them a grace period, then mark what remains interrupted. */
    async shutdown(graceMs = 2000) {
        this.stopping = true;
        const now = this.now();
        for (const active of this.active.values()) {
            if (active.closed)
                continue;
            active.record.state = 'cancel-requested';
            active.record.updatedAt = now;
            this.write(active.record);
            try {
                await active.handle.cancel(graceMs);
            }
            catch (error) {
                this.log(`cancel ${active.record.jobId} failed: ${messageOf(error)}`);
            }
        }
        const deadline = now + graceMs + 2000;
        while ((this.active.size > 0 || this.starting.size > 0) && this.now() < deadline) {
            await delay(100);
        }
        for (const active of this.active.values()) {
            if (active.closed)
                continue;
            active.closed = true;
            this.write({
                ...active.record,
                state: 'interrupted',
                updatedAt: this.now(),
                endedAt: this.now(),
                error: 'The supervisor stopped before the job finished.',
            });
            active.handle.close();
        }
        for (const jobId of new Set([...this.queued, ...this.pending.keys()])) {
            const record = this.store.readJob(jobId);
            if (!record || isTerminal(record.state))
                continue;
            this.write({
                ...record,
                state: 'interrupted',
                updatedAt: this.now(),
                endedAt: this.now(),
                error: 'The supervisor stopped before the job started.',
            });
        }
        this.active.clear();
        this.starting.clear();
        this.queued = [];
        this.pending.clear();
    }
    processRequests() {
        for (const jobId of this.store.listRequestIds()) {
            if (this.active.has(jobId) || this.starting.has(jobId) || this.pending.has(jobId) || this.store.readJob(jobId)) {
                this.store.deleteRequest(jobId);
                continue;
            }
            const claim = this.store.claimRequest(jobId);
            if (!claim.claimed)
                continue;
            if (!isStartRequest(claim.value) || claim.value.jobId !== jobId) {
                this.store.deleteClaimed(jobId);
                this.log(`discarded invalid start request ${jobId}`);
                continue;
            }
            const record = this.recordFor(claim.value, 'queued');
            try {
                this.store.writeJob(record);
            }
            catch (error) {
                const restored = this.store.restoreClaimed(jobId);
                this.log(`could not persist request ${jobId}: ${messageOf(error)}${restored ? '; restored for retry' : '; claim retained for recovery'}`);
                continue;
            }
            this.store.deleteClaimed(jobId);
            this.pending.set(jobId, claim.value);
            this.queued.push(jobId);
        }
    }
    pump() {
        while (!this.stopping && this.active.size + this.starting.size < this.maxActive) {
            const jobId = this.queued.shift();
            if (!jobId)
                break;
            const request = this.pending.get(jobId);
            const record = this.store.readJob(jobId);
            if (!request || !record || record.state !== 'queued') {
                this.pending.delete(jobId);
                continue;
            }
            this.starting.add(jobId);
            void this.startJob(record, request)
                .catch((error) => this.log(`start ${jobId} failed: ${messageOf(error)}`))
                .finally(() => {
                this.starting.delete(jobId);
                this.pump();
            });
        }
    }
    async startJob(record, request) {
        const now = this.now();
        this.write({ ...record, state: 'starting', updatedAt: now });
        let client;
        let handle;
        try {
            client = await this.executor.connect(record.host, {
                agentPath: request.agentPath,
                ...(request.sshEnv === undefined ? {} : { env: request.sshEnv }),
                ...(request.sshPath === undefined ? {} : { sshPath: request.sshPath }),
            });
            if (this.stopping) {
                client.close();
                return;
            }
            const progress = (update) => {
                const current = this.active.get(record.jobId)?.record;
                if (!current)
                    return;
                current.stdoutBytes = update.stdoutBytes;
                current.stderrBytes = update.stderrBytes;
                current.stdoutTail = update.stdoutTail;
                current.stderrTail = update.stderrTail;
            };
            handle = await this.executor.start(client, {
                workspaceId: record.workspace,
                root: record.host.root,
                argv: record.argv,
                ...(record.cwd === undefined ? {} : { cwd: record.cwd }),
                env: request.env,
                ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
                ...(request.expectedGeneration === undefined ? {} : { expectedGeneration: request.expectedGeneration }),
                onProgress: progress,
            });
            const current = this.store.readJob(record.jobId) ?? record;
            if (this.stopping || isTerminal(current.state)) {
                await handle.cancel(2000).catch(() => { });
                handle.close();
                return;
            }
            if (current.state === 'cancel-requested') {
                void handle.cancel(2000).catch((error) => this.log(`cancel ${record.jobId} failed: ${messageOf(error)}`));
            }
            const runningAt = this.now();
            const running = {
                ...current,
                state: current.state === 'cancel-requested' ? 'cancel-requested' : 'running',
                remoteJobId: handle.jobId,
                startedAt: runningAt,
                updatedAt: runningAt,
            };
            this.write(running);
            const active = { record: running, handle, closed: false };
            this.active.set(record.jobId, active);
            this.pending.delete(record.jobId);
            void handle.result.then((result) => this.finish(active, result), (error) => this.fail(active, error));
        }
        catch (error) {
            this.pending.delete(record.jobId);
            if (handle)
                handle.close();
            if (client)
                client.close();
            const current = this.store.readJob(record.jobId);
            if (!current || isTerminal(current.state))
                return;
            this.write({
                ...current,
                state: 'failed',
                updatedAt: this.now(),
                endedAt: this.now(),
                error: messageOf(error),
            });
            this.log(`job ${record.jobId} failed to start: ${messageOf(error)}`);
        }
    }
    finish(active, result) {
        if (active.closed)
            return;
        active.closed = true;
        const now = this.now();
        this.write({
            ...active.record,
            state: result.state,
            exitCode: result.exitCode,
            signal: result.signal,
            endedAt: now,
            updatedAt: now,
            stdoutBytes: result.stdout.length,
            stderrBytes: result.stderr.length,
            stdoutTail: tailOf(result.stdout),
            stderrTail: tailOf(result.stderr),
            error: undefined,
        });
        active.handle.close();
        this.active.delete(active.record.jobId);
        this.pump();
    }
    fail(active, error) {
        if (active.closed)
            return;
        active.closed = true;
        const state = error instanceof AgentError && error.code === 'OPERATION_UNKNOWN' ? 'unknown' : 'failed';
        this.write({
            ...active.record,
            state,
            updatedAt: this.now(),
            endedAt: this.now(),
            error: messageOf(error),
        });
        active.handle.close();
        this.active.delete(active.record.jobId);
        this.pump();
    }
    async processCancels() {
        for (const jobId of this.store.listCancelIds()) {
            try {
                const record = this.store.readJob(jobId);
                if (!record || isTerminal(record.state)) {
                    this.store.deleteCancel(jobId);
                    continue;
                }
                if (record.state === 'queued') {
                    this.queued = this.queued.filter((entry) => entry !== jobId);
                    this.pending.delete(jobId);
                    const now = this.now();
                    this.write({ ...record, state: 'cancelled', updatedAt: now, endedAt: now });
                    this.store.deleteCancel(jobId);
                    continue;
                }
                const active = this.active.get(jobId);
                if (active?.closed) {
                    this.store.deleteCancel(jobId);
                    continue;
                }
                const now = this.now();
                this.write({ ...record, state: 'cancel-requested', updatedAt: now });
                if (active) {
                    await active.handle.cancel(2000).catch((error) => this.log(`cancel ${jobId} failed: ${messageOf(error)}`));
                }
                this.store.deleteCancel(jobId);
            }
            catch (error) {
                this.log(`cancel request ${jobId} failed: ${messageOf(error)}`);
                this.store.deleteCancel(jobId);
            }
        }
    }
    failPending(jobId, value, error) {
        if (this.store.readJob(jobId))
            return;
        if (!isStartRequest(value) || value.jobId !== jobId) {
            this.log(`discarded invalid pending request ${jobId}`);
            return;
        }
        const now = this.now();
        this.write({
            ...this.recordFor(value, 'interrupted'),
            updatedAt: now,
            endedAt: now,
            error,
        });
    }
    recordFor(request, state) {
        return {
            version: 1,
            jobId: request.jobId,
            sessionID: request.sessionID,
            workspace: request.workspace,
            directory: request.directory,
            ...(request.target === undefined ? {} : { target: request.target }),
            host: request.host,
            argv: [...request.argv],
            ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
            state,
            startedAt: request.requestedAt,
            updatedAt: this.now(),
            stdoutBytes: 0,
            stderrBytes: 0,
            stdoutTail: '',
            stderrTail: '',
            supervisor: this.supervisor,
        };
    }
    write(record) {
        try {
            this.store.writeJob(record);
        }
        catch (error) {
            this.log(`could not persist job ${record.jobId}: ${messageOf(error)}`);
        }
    }
}
//# sourceMappingURL=core.js.map