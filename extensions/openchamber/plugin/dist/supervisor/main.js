/** Detached supervisor entry: lock, heartbeat, request loop and graceful shutdown. */
import crypto from 'node:crypto';
import { JobStore } from '../jobs/store.js';
import { configuredStateRoot, readServiceHeartbeat } from '../jobs/paths.js';
import { currentBootTime, lockActive } from '../jobs/health.js';
import { SUPERVISOR_PROTOCOL } from '../jobs/protocol.js';
import { SupervisorCore } from './core.js';
const SERVICE_FRESH_MS = 30_000;
const DEFAULT_IDLE_MS = 90_000;
function acquireLock(store, lock, now) {
    if (store.createLock(lock))
        return true;
    const existing = store.readLock();
    const existingInstance = existing?.instance;
    if (existing && lockActive(existing, now)) {
        store.log(`another supervisor is active: pid ${existing.pid}, instance ${existing.instance}`);
        return false;
    }
    if (existingInstance !== undefined)
        store.clearLock(existingInstance);
    if (store.createLock(lock))
        return true;
    store.log('could not acquire the supervisor lock');
    return false;
}
function idleMs() {
    const value = Number(process.env.FLEET_SUPERVISOR_IDLE_MS);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_IDLE_MS;
}
export async function runSupervisor() {
    process.umask(0o077);
    const stateRoot = configuredStateRoot();
    const store = new JobStore(stateRoot);
    store.ensure();
    const version = process.env.FLEET_SUPERVISOR_VERSION ?? 'unknown';
    const instance = crypto.randomUUID();
    const startedAt = Date.now();
    const bootTime = currentBootTime(startedAt);
    const lock = {
        protocol: SUPERVISOR_PROTOCOL,
        version,
        instance,
        pid: process.pid,
        startedAt,
        bootTime,
    };
    if (!acquireLock(store, lock, startedAt))
        return;
    store.log(`started instance ${instance} (pid ${process.pid})`);
    const core = new SupervisorCore({ store, instance, startedAt, version });
    await core.recover();
    let stopping = false;
    let sawService = false;
    let missingSince = null;
    const timers = [];
    const writeDiscovery = () => {
        if (!store.ownsLock(instance))
            return false;
        try {
            store.writeSupervisor({
                protocol: SUPERVISOR_PROTOCOL,
                version,
                instance,
                pid: process.pid,
                startedAt,
                bootTime,
                updatedAt: Date.now(),
                stateRoot,
                activeJobs: core.pendingCount(),
                drain: true,
                draining: core.isDraining(),
            });
            return true;
        }
        catch (error) {
            store.log(`could not write discovery: ${error instanceof Error ? error.message : String(error)}`);
            return true;
        }
    };
    const checkService = () => {
        const heartbeat = readServiceHeartbeat();
        const fresh = heartbeat !== null && Date.now() - heartbeat.updatedAt <= SERVICE_FRESH_MS;
        if (fresh) {
            sawService = true;
            missingSince = null;
            return;
        }
        if (!sawService)
            return;
        if (missingSince === null)
            missingSince = Date.now();
        if (Date.now() - missingSince >= idleMs() && core.idle()) {
            void stop('service heartbeat gone');
        }
    };
    const stop = async (reason) => {
        if (stopping)
            return;
        stopping = true;
        for (const timer of timers)
            clearInterval(timer);
        store.log(`stopping (${reason})`);
        try {
            await core.shutdown(2000);
        }
        catch (error) {
            store.log(`shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        store.removeSupervisor(instance);
        store.clearDrain(instance);
        store.releaseLock(instance);
        process.exit(0);
    };
    const firstHeartbeat = readServiceHeartbeat();
    sawService = firstHeartbeat !== null && Date.now() - firstHeartbeat.updatedAt <= SERVICE_FRESH_MS;
    writeDiscovery();
    timers.push(setInterval(() => { void core.tick(); }, 250));
    timers.push(setInterval(() => { core.persistActive(); }, 2000));
    timers.push(setInterval(() => {
        if (!writeDiscovery()) {
            void stop('lock lost');
            return;
        }
        if (store.readDrain()?.instance === instance)
            core.beginDrain();
        if (core.isDraining() && core.idle()) {
            void stop('drained');
            return;
        }
        checkService();
    }, 1000));
    process.on('SIGTERM', () => { void stop('SIGTERM'); });
    process.on('SIGINT', () => { void stop('SIGINT'); });
    process.on('SIGHUP', () => { });
    process.on('exit', () => {
        try {
            store.removeSupervisor(instance);
            store.clearDrain(instance);
            store.releaseLock(instance);
        }
        catch {
            // Best effort.
        }
    });
    process.on('uncaughtException', (error) => {
        store.log(`uncaught exception: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        void stop('uncaught exception');
    });
    process.on('unhandledRejection', (error) => {
        store.log(`unhandled rejection: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        void stop('unhandled rejection');
    });
}
//# sourceMappingURL=main.js.map