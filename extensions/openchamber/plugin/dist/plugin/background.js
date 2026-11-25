/** Routes background work to the detached supervisor when it is available. */
import { AgentError } from '../v1/errors.js';
import { FleetJobRegistry } from './jobs.js';
import { SupervisedJobRegistry } from './supervised.js';
export class BackgroundJobs {
    ctx;
    inProcess;
    supervised;
    deletion = new AbortController();
    constructor(ctx, agentPath, options = {}) {
        this.ctx = ctx;
        this.inProcess = options.inProcess ?? new FleetJobRegistry(ctx, agentPath, options.executor);
        this.supervised = options.supervised ?? new SupervisedJobRegistry(ctx, options.supervisedOptions);
    }
    async start(input) {
        const detached = await this.supervised.start(input);
        if (detached)
            return detached;
        return this.inProcess.start(input);
    }
    async status(jobId, sessionID) {
        const detached = await this.supervised.status(jobId, sessionID);
        if (detached)
            return detached;
        return this.inProcess.status(jobId, sessionID).catch((error) => {
            if (error instanceof AgentError && error.code === 'OPERATION_UNKNOWN')
                return null;
            throw error;
        });
    }
    async list(sessionID) {
        const [detached, inProcess] = await Promise.all([
            this.supervised.list(sessionID),
            this.inProcess.list(sessionID),
        ]);
        const merged = new Map();
        for (const record of [...inProcess, ...detached])
            merged.set(record.key, record);
        return [...merged.values()].sort((left, right) => right.startedAt - left.startedAt).slice(0, 50);
    }
    async cancel(jobId, sessionID) {
        const detached = await this.supervised.status(jobId, sessionID);
        if (detached?.supervised === true) {
            const cancelled = await this.supervised.cancel(jobId, sessionID);
            if (cancelled)
                return cancelled;
        }
        return this.inProcess.cancel(jobId, sessionID);
    }
    async cancelSession(sessionID) {
        await this.supervised.cancelSession(sessionID);
        await this.inProcess.cancelSession(sessionID);
    }
    async recoverInterrupted() {
        await this.inProcess.recoverInterrupted();
        await this.supervised.recover();
    }
    watchSessionDeletion() {
        if (!this.ctx.event)
            return;
        void (async () => {
            try {
                for await (const event of this.ctx.event.subscribe({ types: ['session.deleted'], signal: this.deletion.signal })) {
                    const sessionID = event.data?.sessionID;
                    if (typeof sessionID === 'string')
                        await this.cancelSession(sessionID);
                }
            }
            catch {
                // Normal plugin cleanup aborts the subscription.
            }
        })();
    }
    async cleanup() {
        this.deletion.abort();
        await this.inProcess.cleanup();
        this.supervised.cleanup();
    }
}
//# sourceMappingURL=background.js.map