/** High-level operations over a connected agent. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AgentClient } from './client.js';
import { AgentError } from './errors.js';
import { scanWorkspace, sha256File } from './workspace.js';
import { spawnTransport, sshTransport } from './transport.js';
const PAGE = 5000;
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'unknown']);
const DEFAULT_EXEC_WAIT_MS = 24 * 60 * 60 * 1000;
export async function connectSsh(host, options = {}) {
    return AgentClient.connect(sshTransport(host, options.agentPath ?? 'fleet-agent'), {
        capabilities: ['workspace.sync@1', 'exec@1', 'artifact@1'],
    });
}
/** Test/in-process transport: run the agent binary directly. */
export function connectProcess(command, args = ['stdio']) {
    return AgentClient.connect(spawnTransport(command, args), {
        capabilities: ['workspace.sync@1', 'exec@1', 'artifact@1'],
    });
}
function operationId() {
    return crypto.randomBytes(6).toString('hex');
}
function throwIfAborted(signal) {
    if (signal?.aborted)
        throw new AgentError('CANCELLED', 'operation cancelled');
}
async function report(onProgress, progress) {
    if (!onProgress)
        return;
    try {
        await onProgress(progress);
    }
    catch {
        // Progress reporting is observational and must never change the operation's outcome.
    }
}
function delay(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new AgentError('CANCELLED', 'operation cancelled'));
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(new AgentError('CANCELLED', 'operation cancelled'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
export async function openWorkspace(client, workspaceId, root, adopt = false, signal) {
    throwIfAborted(signal);
    const result = (await client.request('workspace.open', { workspaceId, root, adopt }));
    throwIfAborted(signal);
    return result;
}
export async function status(client, workspaceId, root, signal) {
    await openWorkspace(client, workspaceId, root, false, signal);
    const result = (await client.request('workspace.status', { workspaceId }));
    throwIfAborted(signal);
    return result;
}
async function fetchPlanPages(client, txnId, kind, signal) {
    const items = [];
    let offset = 0;
    for (;;) {
        throwIfAborted(signal);
        const page = (await client.request('sync.planPage', { txnId, kind, offset, limit: PAGE }));
        items.push(...page.items);
        if (!page.more)
            break;
        offset += page.items.length;
    }
    return items;
}
export async function syncWorkspace(client, matcher, options) {
    throwIfAborted(options.signal);
    await report(options.onProgress, { phase: 'scanning' });
    const scanned = await scanWorkspace(options.source, matcher);
    throwIfAborted(options.signal);
    await report(options.onProgress, { phase: 'scanning', entries: scanned.entries.length });
    const blobs = new Map();
    for (const entry of scanned.entries) {
        if (entry.type === 'file' && entry.digest) {
            blobs.set(entry.digest, { file: path.join(options.source, entry.path), size: entry.size });
        }
    }
    await report(options.onProgress, { phase: 'opening' });
    const workspace = await openWorkspace(client, options.workspaceId, options.root, options.adopt === true, options.signal);
    if (workspace.recovery) {
        throw new AgentError('RECOVERY_REQUIRED', 'workspace has an unfinished transaction; inspect it with fleet recover', true);
    }
    throwIfAborted(options.signal);
    const lease = operationId();
    await client.request('workspace.lease', { workspaceId: options.workspaceId, operationId: lease, ttlMs: 600_000 });
    let txnId;
    try {
        throwIfAborted(options.signal);
        const begin = (await client.request('sync.begin', {
            workspaceId: options.workspaceId,
            leaseId: lease,
            baseGeneration: workspace.generation,
            policy: { excludes: options.excludes, preserve: [], deleteManaged: true },
        }));
        txnId = begin.txnId;
        for (let offset = 0; offset < scanned.entries.length; offset += PAGE) {
            throwIfAborted(options.signal);
            await client.request('sync.entries', {
                txnId,
                entries: scanned.entries.slice(offset, offset + PAGE),
                more: offset + PAGE < scanned.entries.length,
            });
            await report(options.onProgress, {
                phase: 'planning',
                entries: Math.min(offset + PAGE, scanned.entries.length),
            });
        }
        const plan = (await client.request('sync.plan', { txnId }));
        const changes = (await fetchPlanPages(client, txnId, 'changes', options.signal));
        const needed = (await fetchPlanPages(client, txnId, 'needed', options.signal));
        await report(options.onProgress, {
            phase: 'planning',
            changes: changes.length,
            needed: needed.length,
            digest: plan.planDigest,
        });
        if (options.mode === 'plan') {
            await client.request('sync.abort', { txnId });
            await report(options.onProgress, { phase: 'done', changes: changes.length, digest: plan.planDigest });
            return { planDigest: plan.planDigest, changes, needed };
        }
        let uploaded = 0;
        for (const digest of needed) {
            throwIfAborted(options.signal);
            const blob = blobs.get(digest);
            if (!blob)
                throw new AgentError('BLOB_MISSING', `no local file for ${digest}`);
            const put = (await client.request('blob.put', { txnId, digest, size: blob.size }));
            const bytes = await fs.promises.readFile(blob.file);
            if (`sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}` !== digest) {
                throw new AgentError('BLOB_CORRUPT', `local file ${blob.file} changed during upload`);
            }
            await client.upload(put.streamId, bytes);
            uploaded += bytes.length;
            await report(options.onProgress, {
                phase: 'uploading',
                bytes: uploaded,
                needed: needed.length,
                digest,
            });
        }
        await report(options.onProgress, { phase: 'committing', digest: plan.planDigest });
        const committed = (await client.request('sync.commit', { txnId, planDigest: plan.planDigest }, 1_800_000));
        await report(options.onProgress, {
            phase: 'done',
            changes: changes.length,
            bytes: uploaded,
            digest: committed.manifestDigest,
        });
        return { planDigest: plan.planDigest, changes, needed, generation: committed.generation, manifestDigest: committed.manifestDigest };
    }
    finally {
        if (txnId) {
            try {
                await client.request('sync.abort', { txnId });
            }
            catch { /* committed or already aborted */ }
        }
        try {
            await client.request('workspace.release', { leaseId: lease });
        }
        catch { /* connection gone */ }
    }
}
export async function inspectRecovery(client, workspaceId, root, signal) {
    await openWorkspace(client, workspaceId, root, false, signal);
    const result = (await client.request('sync.inspect', { workspaceId }));
    throwIfAborted(signal);
    return result;
}
export async function recoverWorkspace(client, workspaceId, root, mode = 'recover', signal) {
    const inspected = await inspectRecovery(client, workspaceId, root, signal);
    if (inspected.state === 'READY')
        return inspected;
    if (!inspected.txnId)
        throw new AgentError('OPERATION_UNKNOWN', 'recovery state has no transaction id');
    throwIfAborted(signal);
    if (mode === 'abort') {
        await client.request('sync.abort', { txnId: inspected.txnId });
        const current = await status(client, workspaceId, root, signal);
        return { ...inspected, recovered: true, generation: current.generation, manifestDigest: current.manifestDigest, state: 'READY' };
    }
    const resumed = (await client.request('sync.recover', { txnId: inspected.txnId }, 1_800_000));
    throwIfAborted(signal);
    return { ...inspected, recovered: true, state: 'READY', generation: resumed.generation, manifestDigest: resumed.manifestDigest };
}
function appendTail(current, chunk) {
    return (current + chunk.toString('utf8')).slice(-4096);
}
export async function startExecCommand(client, options) {
    throwIfAborted(options.signal);
    await report(options.onProgress, {
        phase: 'starting', stdoutBytes: 0, stderrBytes: 0, stdoutTail: '', stderrTail: '',
    });
    const workspace = await openWorkspace(client, options.workspaceId, options.root, false, options.signal);
    const lease = operationId();
    await client.request('workspace.lease', { workspaceId: options.workspaceId, operationId: lease, ttlMs: 600_000 });
    let start;
    try {
        throwIfAborted(options.signal);
        start = (await client.request('exec.start', {
            workspaceId: options.workspaceId,
            leaseId: lease,
            expectedGeneration: workspace.generation,
            argv: options.argv,
            cwd: options.cwd,
            env: options.env ?? {},
            timeoutMs: options.timeoutMs,
        }));
    }
    catch (error) {
        try {
            await client.request('workspace.release', { leaseId: lease });
        }
        catch { /* connection gone */ }
        throw error;
    }
    if (options.signal?.aborted) {
        try {
            await client.request('exec.cancel', { jobId: start.jobId, graceMs: 2000 });
        }
        catch { /* connection gone */ }
        try {
            await client.request('workspace.release', { leaseId: lease });
        }
        catch { /* connection gone */ }
        throw new AgentError('CANCELLED', 'operation cancelled');
    }
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTail = '';
    let stderrTail = '';
    let lastProgress = 0;
    const progress = (phase, state) => {
        const now = Date.now();
        if (phase !== 'done' && now - lastProgress < 200)
            return;
        lastProgress = now;
        void report(options.onProgress, {
            phase,
            jobId: start.jobId,
            state,
            stdoutBytes,
            stderrBytes,
            stdoutTail,
            stderrTail,
        });
    };
    const waitMs = options.timeoutMs ?? DEFAULT_EXEC_WAIT_MS;
    const stdout = client.collect(start.stdoutStream, {
        initialCredit: 8 * 1024 * 1024,
        timeoutMs: waitMs + 30_000,
        onData: (chunk) => {
            stdoutBytes += chunk.length;
            stdoutTail = appendTail(stdoutTail, chunk);
            progress('streaming');
        },
    });
    const stderr = client.collect(start.stderrStream, {
        initialCredit: 8 * 1024 * 1024,
        timeoutMs: waitMs + 30_000,
        onData: (chunk) => {
            stderrBytes += chunk.length;
            stderrTail = appendTail(stderrTail, chunk);
            progress('streaming');
        },
    });
    const onAbort = () => {
        void client.request('exec.cancel', { jobId: start.jobId, graceMs: 2000 }).catch(() => { });
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const result = (async () => {
        try {
            const [out, err] = await Promise.all([stdout, stderr]);
            let record = (await client.request('exec.status', { jobId: start.jobId }));
            const deadline = Date.now() + waitMs + 60_000;
            while (!TERMINAL.has(record.state) && Date.now() < deadline) {
                progress('waiting', record.state);
                await delay(100, options.signal);
                record = (await client.request('exec.status', { jobId: start.jobId }));
            }
            if (!TERMINAL.has(record.state)) {
                throw new AgentError('OPERATION_UNKNOWN', `job ${start.jobId} did not reach a terminal state`, true);
            }
            progress('done', record.state);
            return {
                jobId: start.jobId,
                state: record.state,
                exitCode: record.exitCode,
                signal: record.signal,
                stdout: out,
                stderr: err,
                startedAt: record.startedAt,
                endedAt: record.endedAt,
            };
        }
        finally {
            options.signal?.removeEventListener('abort', onAbort);
            try {
                await client.request('workspace.release', { leaseId: lease });
            }
            catch { /* connection gone */ }
        }
    })();
    void result.catch(() => { });
    return {
        jobId: start.jobId,
        result,
        async cancel(graceMs = 2000) {
            await client.request('exec.cancel', { jobId: start.jobId, graceMs });
        },
        close() {
            client.close();
        },
    };
}
export async function execCommand(client, options) {
    const handle = await startExecCommand(client, options);
    const result = await handle.result;
    throwIfAborted(options.signal);
    return result;
}
export function artifactTarget(dest, artifact) {
    return path.resolve(dest, path.basename(artifact));
}
export async function fetchArtifact(client, options) {
    throwIfAborted(options.signal);
    await report(options.onProgress, { phase: 'opening', bytes: 0 });
    await openWorkspace(client, options.workspaceId, options.root, false, options.signal);
    const opened = (await client.request('artifact.open', {
        workspaceId: options.workspaceId,
        path: options.artifact,
    }));
    throwIfAborted(options.signal);
    let received = 0;
    let lastProgress = 0;
    const bytes = await client.collect(opened.streamId, {
        initialCredit: 8 * 1024 * 1024,
        timeoutMs: 300_000,
        onData: (chunk) => {
            received += chunk.length;
            const now = Date.now();
            if (now - lastProgress < 200)
                return;
            lastProgress = now;
            void report(options.onProgress, { phase: 'streaming', bytes: received, digest: opened.digest });
        },
    });
    throwIfAborted(options.signal);
    const digest = `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
    if (digest !== opened.digest) {
        throw new AgentError('BLOB_CORRUPT', `artifact digest mismatch: expected ${opened.digest} got ${digest}`);
    }
    const target = artifactTarget(options.dest, options.artifact);
    if (fs.existsSync(target) && options.overwrite !== true) {
        throw new AgentError('INVALID_REQUEST', `${target} exists; pass overwrite`);
    }
    await report(options.onProgress, { phase: 'writing', bytes: bytes.length, digest });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    await report(options.onProgress, { phase: 'done', bytes: bytes.length, digest });
    return { file: target, bytes: bytes.length, digest };
}
export async function localDigest(file) {
    return sha256File(file);
}
//# sourceMappingURL=operations.js.map