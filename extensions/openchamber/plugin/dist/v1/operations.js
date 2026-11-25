/** High-level operations over a connected agent. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AgentClient } from './client.js';
import { AgentError } from './errors.js';
import { scanWorkspace, sha256File } from './workspace.js';
import { spawnTransport, sshTransport } from './transport.js';
const PAGE = 5000;
const CHANGE_PAGE = 50;
const MAX_ENTRY_BYTES = 700 * 1024;
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'unknown']);
const DEFAULT_EXEC_WAIT_MS = 24 * 60 * 60 * 1000;
export async function connectSsh(host, options = {}) {
    return AgentClient.connect(sshTransport(host, options.agentPath ?? 'fleet-agent', options.env, options.sshPath), {
        capabilities: ['workspace.sync@1', 'exec@1', 'artifact@1'],
    });
}
/** Test/in-process transport: run the agent binary directly. */
export function connectProcess(command, args = ['stdio']) {
    return AgentClient.connect(spawnTransport(command, args), {
        capabilities: ['workspace.sync@1', 'exec@1', 'artifact@1'],
    });
}
function requireCapability(client, name) {
    if (client.info.capabilities[name] !== 1) {
        throw new AgentError('UNSUPPORTED_CAPABILITY', `agent does not provide ${name}; update fleet-agent`);
    }
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
export async function openWorkspace(client, workspaceId, root, adopt = false, signal, expected) {
    throwIfAborted(signal);
    const result = (await client.request('workspace.open', {
        workspaceId,
        root,
        adopt,
        ...(expected?.root === undefined ? {} : { expectedRoot: expected.root }),
        ...(expected?.manifestDigest === undefined ? {} : { expectedManifestDigest: expected.manifestDigest }),
        ...(expected?.state === undefined ? {} : { expectedState: expected.state }),
    }));
    throwIfAborted(signal);
    return result;
}
/** Open a snapshot for reading. Never creates a root, state directory or manifest. */
export async function openWorkspaceReadOnly(client, workspaceId, root, signal) {
    throwIfAborted(signal);
    const result = (await client.request('workspace.open', { workspaceId, root, readOnly: true }));
    throwIfAborted(signal);
    return result;
}
/** Inspect a workspace without provisioning its root or state. */
export async function probeWorkspace(client, workspaceId, root, signal) {
    throwIfAborted(signal);
    requireCapability(client, 'workspace.probe');
    const result = (await client.request('workspace.probe', { workspaceId, root }));
    throwIfAborted(signal);
    return result;
}
export async function status(client, workspaceId, root, signal) {
    const probe = await probeWorkspace(client, workspaceId, root, signal);
    if (probe.state === 'READY' || probe.state === 'RECOVERY') {
        return {
            generation: probe.generation,
            manifestDigest: probe.manifestDigest,
            recovery: probe.recovery,
            state: probe.state,
        };
    }
    return { generation: 0, manifestDigest: '', recovery: false, state: probe.state };
}
/** Bind an apply to host/root, source, generation, policy and the exact plan. */
export function syncPlanToken(input) {
    const value = JSON.stringify({
        workspaceId: input.workspaceId,
        source: path.resolve(input.source),
        sourceDigest: input.sourceDigest ?? '',
        root: input.root,
        resolvedRoot: input.resolvedRoot ?? '',
        baseManifestDigest: input.baseManifestDigest ?? '',
        baseState: input.baseState ?? '',
        hostIdentity: input.hostIdentity ?? '',
        agentIdentity: input.agentIdentity ?? '',
        generation: input.generation,
        excludes: [...new Set(input.excludes)].sort(),
        planDigest: input.planDigest,
        changes: input.changes.map((change) => `${change.action}\0${change.path}`),
    });
    return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}
async function fetchPlanPages(client, txnId, kind, signal) {
    const items = [];
    let offset = 0;
    for (;;) {
        throwIfAborted(signal);
        const page = (await client.request('sync.planPage', {
            txnId,
            kind,
            offset,
            limit: kind === 'changes' ? CHANGE_PAGE : PAGE,
        }));
        items.push(...page.items);
        if (!page.more)
            break;
        offset += page.items.length;
    }
    return items;
}
async function fetchPreviewPages(client, txnId, kind, signal) {
    const items = [];
    let offset = 0;
    for (;;) {
        throwIfAborted(signal);
        const page = (await client.request('sync.previewPage', {
            txnId,
            kind,
            offset,
            limit: kind === 'changes' ? CHANGE_PAGE : PAGE,
        }));
        items.push(...page.items);
        if (offset + page.items.length >= page.total)
            break;
        offset += page.items.length;
    }
    return items;
}
function entryBatches(entries) {
    const batches = [];
    let current = [];
    let bytes = 0;
    for (const entry of entries) {
        const size = Buffer.byteLength(JSON.stringify(entry)) + 2;
        if (current.length > 0 && bytes + size > MAX_ENTRY_BYTES) {
            batches.push({ entries: current, bytes });
            current = [];
            bytes = 0;
        }
        current.push(entry);
        bytes += size;
    }
    if (current.length > 0)
        batches.push({ entries: current, bytes });
    return batches;
}
export async function syncWorkspace(client, matcher, options) {
    if (options.mode === 'plan' && options.adopt === true) {
        throw new AgentError('INVALID_REQUEST', 'adopt is only valid with mode=apply');
    }
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
    const policy = { excludes: options.excludes, preserve: [], deleteManaged: true };
    const agentIdentity = client.info.agent?.installationId ?? '';
    // A plan is a read-only preview. It may inspect an absent replica, never
    // creates state or a journal, and cannot be turned into an apply by a
    // background caller.
    const preview = async () => {
        requireCapability(client, 'workspace.preview');
        let txnId;
        try {
            const begin = (await client.request('sync.previewBegin', {
                workspaceId: options.workspaceId,
                root: options.root,
                policy,
            }));
            txnId = begin.txnId;
            const batches = entryBatches(scanned.entries);
            for (const [index, batch] of batches.entries()) {
                throwIfAborted(options.signal);
                await client.request('sync.previewEntries', {
                    txnId,
                    entries: batch.entries,
                    more: index + 1 < batches.length,
                });
            }
            const plan = (await client.request('sync.previewPlan', { txnId }));
            const changes = (await fetchPreviewPages(client, txnId, 'changes', options.signal));
            const needed = (await fetchPreviewPages(client, txnId, 'needed', options.signal));
            const planToken = syncPlanToken({
                workspaceId: options.workspaceId,
                source: options.source,
                root: options.root,
                generation: begin.generation,
                excludes: options.excludes,
                planDigest: plan.planDigest,
                changes,
                needed,
                ...(options.hostIdentity === undefined ? {} : { hostIdentity: options.hostIdentity }),
                agentIdentity,
                sourceDigest: scanned.digest,
                resolvedRoot: begin.root,
                baseManifestDigest: begin.manifestDigest,
                baseState: begin.state,
            });
            return {
                generation: begin.generation,
                planDigest: plan.planDigest,
                planToken,
                changes,
                needed,
                root: begin.root,
                manifestDigest: begin.manifestDigest,
                state: begin.state,
            };
        }
        finally {
            if (txnId) {
                try {
                    await client.request('sync.previewEnd', { txnId });
                }
                catch { /* connection gone */ }
            }
        }
    };
    if (options.mode === 'plan') {
        const result = await preview();
        await report(options.onProgress, {
            phase: 'done',
            changes: result.changes.length,
            digest: result.planDigest,
        });
        return {
            planDigest: result.planDigest,
            planToken: result.planToken,
            changes: result.changes,
            needed: result.needed,
        };
    }
    // A stale approval must be rejected before workspace.open can provision or
    // adopt anything. The post-plan check below closes the remaining race.
    let approvedPreview;
    if (options.planToken !== undefined) {
        approvedPreview = await preview();
        if (approvedPreview.planToken !== options.planToken) {
            throw new AgentError('PLAN_STALE', 'the replica or plan changed since it was approved; plan again');
        }
    }
    await report(options.onProgress, { phase: 'opening' });
    const workspace = await openWorkspace(client, options.workspaceId, options.root, options.adopt === true, options.signal, approvedPreview === undefined
        ? undefined
        : {
            root: approvedPreview.root,
            manifestDigest: approvedPreview.manifestDigest,
            state: approvedPreview.state,
        });
    if (workspace.recovery) {
        throw new AgentError('RECOVERY_REQUIRED', 'workspace has an unfinished transaction; inspect it with fleet recover', true);
    }
    throwIfAborted(options.signal);
    const operation = operationId();
    const leaseInfo = (await client.request('workspace.lease', {
        workspaceId: options.workspaceId,
        operationId: operation,
        ttlMs: 600_000,
    }));
    const lease = leaseInfo.leaseId;
    let txnId;
    let beginPromise;
    const onAbort = () => {
        void (async () => {
            if (beginPromise) {
                try {
                    const begun = await beginPromise;
                    txnId ??= begun.txnId;
                }
                catch {
                    // The agent may have accepted begin before the response was lost.
                }
            }
            if (!txnId) {
                try {
                    const inspected = (await client.request('sync.inspect', { workspaceId: options.workspaceId }));
                    if (inspected.state === 'RECOVERY' && inspected.txnId)
                        txnId = inspected.txnId;
                }
                catch { /* connection gone */ }
            }
            if (txnId) {
                try {
                    await client.request('sync.abort', { txnId, leaseId: lease });
                }
                catch { /* applying, committed or connection gone */ }
            }
            try {
                await client.request('workspace.release', { leaseId: lease });
            }
            catch { /* connection gone */ }
        })().finally(() => client.close());
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
        throwIfAborted(options.signal);
        beginPromise = client.request('sync.begin', {
            workspaceId: options.workspaceId,
            leaseId: lease,
            baseGeneration: leaseInfo.generation,
            policy: { excludes: options.excludes, preserve: [], deleteManaged: true },
        });
        const begin = await beginPromise;
        txnId = begin.txnId;
        throwIfAborted(options.signal);
        let sent = 0;
        const batches = entryBatches(scanned.entries);
        for (const [index, batch] of batches.entries()) {
            throwIfAborted(options.signal);
            await client.request('sync.entries', {
                txnId,
                entries: batch.entries,
                more: index + 1 < batches.length,
            });
            sent += batch.entries.length;
            await report(options.onProgress, { phase: 'planning', entries: sent });
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
        const planToken = syncPlanToken({
            workspaceId: options.workspaceId,
            source: options.source,
            root: options.root,
            generation: leaseInfo.generation,
            excludes: options.excludes,
            planDigest: plan.planDigest,
            changes,
            needed,
            ...(options.hostIdentity === undefined ? {} : { hostIdentity: options.hostIdentity }),
            agentIdentity,
            sourceDigest: scanned.digest,
            resolvedRoot: approvedPreview?.root ?? workspace.root ?? options.root,
            baseManifestDigest: approvedPreview?.manifestDigest ?? workspace.manifestDigest,
            baseState: approvedPreview?.state ?? workspace.state ?? 'READY',
        });
        if (options.planToken !== undefined && options.planToken !== planToken) {
            await client.request('sync.abort', { txnId, leaseId: lease });
            txnId = undefined;
            throw new AgentError('PLAN_STALE', 'the replica or plan changed since it was approved; plan again');
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
        const committed = (await client.request('sync.commit', { txnId, leaseId: lease, planDigest: plan.planDigest }, 1_800_000));
        await report(options.onProgress, {
            phase: 'done',
            changes: changes.length,
            bytes: uploaded,
            digest: committed.manifestDigest,
        });
        return {
            planDigest: plan.planDigest,
            planToken,
            changes,
            needed,
            generation: committed.generation,
            manifestDigest: committed.manifestDigest,
        };
    }
    finally {
        options.signal?.removeEventListener('abort', onAbort);
        if (txnId) {
            try {
                await client.request('sync.abort', { txnId, leaseId: lease });
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
    // The agent reads the journal for this root directly; a read must never
    // provision a missing state directory.
    const result = (await client.request('sync.inspect', { workspaceId, root }));
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
    await openWorkspace(client, workspaceId, root, false, signal);
    const operation = operationId();
    const leaseInfo = (await client.request('workspace.lease', {
        workspaceId,
        operationId: operation,
        ttlMs: 600_000,
        recovery: true,
        txnId: inspected.txnId,
    }));
    const lease = leaseInfo.leaseId;
    try {
        if (mode === 'abort') {
            await client.request('sync.abort', { txnId: inspected.txnId, leaseId: lease });
            const current = await status(client, workspaceId, root, signal);
            return { ...inspected, recovered: true, generation: current.generation, manifestDigest: current.manifestDigest, state: 'READY' };
        }
        const resumed = (await client.request('sync.recover', { txnId: inspected.txnId, leaseId: lease }, 1_800_000));
        throwIfAborted(signal);
        return { ...inspected, recovered: true, state: 'READY', generation: resumed.generation, manifestDigest: resumed.manifestDigest };
    }
    finally {
        try {
            await client.request('workspace.release', { leaseId: lease });
        }
        catch { /* connection gone */ }
    }
}
function appendTail(current, chunk) {
    return (current + chunk.toString('utf8')).slice(-4096);
}
export async function startExecCommand(client, options) {
    throwIfAborted(options.signal);
    await report(options.onProgress, {
        phase: 'starting', stdoutBytes: 0, stderrBytes: 0, stdoutTail: '', stderrTail: '',
    });
    await openWorkspace(client, options.workspaceId, options.root, false, options.signal);
    const operation = operationId();
    const leaseInfo = (await client.request('workspace.lease', {
        workspaceId: options.workspaceId,
        operationId: operation,
        ttlMs: 600_000,
    }));
    const lease = leaseInfo.leaseId;
    let start;
    try {
        throwIfAborted(options.signal);
        if (options.assertOwnership !== undefined && !options.assertOwnership()) {
            throw new AgentError('CANCELLED', 'the owner lost its lock before the remote start');
        }
        start = (await client.request('exec.start', {
            workspaceId: options.workspaceId,
            leaseId: lease,
            expectedGeneration: options.expectedGeneration ?? leaseInfo.generation,
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
        catch (error) {
            try {
                await client.request('exec.cancel', { jobId: start.jobId, graceMs: 2000 }, 5000);
            }
            catch { /* connection gone or job already terminal */ }
            throw error;
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
/**
 * Reject symlinks in every existing component of a local path and return the
 * path the I/O will actually open. This is deliberately stricter than
 * realpath: a symlink may never redirect a transfer outside the approved path.
 */
function assertNoSymlinkComponents(absolute) {
    const parsed = path.parse(absolute);
    const relative = absolute.slice(parsed.root.length);
    let current = parsed.root;
    for (const component of relative.split(path.sep)) {
        if (component === '')
            continue;
        current = path.join(current, component);
        let metadata;
        try {
            metadata = fs.lstatSync(current);
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return;
            throw error;
        }
        if (metadata.isSymbolicLink()) {
            throw new AgentError('PATH_UNSAFE', `${absolute} contains a symlink at ${current}`);
        }
        if (current !== absolute && !metadata.isDirectory()) {
            throw new AgentError('PATH_UNSAFE', `${absolute} has a non-directory parent at ${current}`);
        }
    }
}
/** Canonical local source for an upload; the returned path is the one opened. */
export function canonicalTransferSource(file) {
    const absolute = path.resolve(file);
    assertNoSymlinkComponents(absolute);
    const metadata = fs.lstatSync(absolute);
    if (!metadata.isFile()) {
        throw new AgentError('PATH_UNSAFE', `local file ${absolute} must be a regular file`);
    }
    return absolute;
}
/** Identity of the exact source object that was approved and will be opened. */
export function transferSourceIdentity(file) {
    const source = canonicalTransferSource(file);
    const metadata = fs.lstatSync(source);
    return { path: source, dev: metadata.dev, ino: metadata.ino };
}
/** Identity of the destination parent that was approved. */
export function transferTargetIdentity(file) {
    const target = canonicalTransferTarget(file, false);
    try {
        const metadata = fs.lstatSync(path.dirname(target));
        return { path: target, dev: metadata.dev, ino: metadata.ino };
    }
    catch {
        return { path: target, dev: null, ino: null };
    }
}
/** Resolve a local write target without following any symlink component. */
export function canonicalTransferTarget(file, createParent = true) {
    const absolute = path.resolve(file);
    assertNoSymlinkComponents(absolute);
    let metadata;
    try {
        metadata = fs.lstatSync(absolute);
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
    }
    if (metadata?.isSymbolicLink()) {
        throw new AgentError('PATH_UNSAFE', `destination ${absolute} is a symlink`);
    }
    if (metadata && !metadata.isFile()) {
        throw new AgentError('PATH_UNSAFE', `destination ${absolute} is not a regular file`);
    }
    if (createParent)
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
    // Re-check after mkdir: a concurrently introduced symlink must not slip in.
    assertNoSymlinkComponents(path.dirname(absolute));
    return absolute;
}
async function sha256Fd(fd) {
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    for (;;) {
        const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, position);
        if (bytesRead === 0)
            break;
        hash.update(buffer.subarray(0, bytesRead));
        position += bytesRead;
    }
    return `sha256:${hash.digest('hex')}`;
}
export async function uploadFile(client, options) {
    throwIfAborted(options.signal);
    requireCapability(client, 'transfer');
    let source;
    try {
        source = canonicalTransferSource(options.source);
    }
    catch (error) {
        if (error instanceof AgentError)
            throw error;
        throw new AgentError('NOT_FOUND', `local file ${options.source} does not exist`);
    }
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    const fd = fs.openSync(source, fs.constants.O_RDONLY | noFollow);
    try {
        const metadata = fs.fstatSync(fd);
        if (!metadata.isFile()) {
            throw new AgentError('PATH_UNSAFE', `local file ${source} must be a regular file`);
        }
        if (options.expectedDev !== undefined && options.expectedDev !== metadata.dev) {
            throw new AgentError('PATH_UNSAFE', `local file ${source} changed after permission check (device)`);
        }
        if (options.expectedIno !== undefined && options.expectedIno !== metadata.ino) {
            throw new AgentError('PATH_UNSAFE', `local file ${source} changed after permission check (inode)`);
        }
        const digest = await sha256Fd(fd);
        throwIfAborted(options.signal);
        await report(options.onProgress, { phase: 'opening', bytes: 0 });
        // An upload is a write: scratch has no sync lifecycle, so the agent must
        // create its root and state before the first file lands.
        await openWorkspace(client, options.workspaceId, options.root, false, options.signal);
        const put = (await client.request('transfer.put', {
            workspaceId: options.workspaceId,
            path: options.path,
            size: metadata.size,
            digest,
            overwrite: options.overwrite === true,
        }));
        await report(options.onProgress, { phase: 'uploading', bytes: 0, digest });
        await client.uploadFd(put.streamId, fd, options.signal);
        const after = fs.fstatSync(fd);
        if (after.size !== metadata.size || after.mtimeMs !== metadata.mtimeMs) {
            throw new AgentError('BLOB_CORRUPT', `local file ${source} changed during upload`);
        }
        await report(options.onProgress, { phase: 'done', bytes: metadata.size, digest });
        return { bytes: metadata.size, digest, file: options.path };
    }
    finally {
        fs.closeSync(fd);
    }
}
export async function downloadFile(client, options) {
    throwIfAborted(options.signal);
    requireCapability(client, 'transfer');
    const target = canonicalTransferTarget(options.dest, false);
    if (options.expectedTarget !== undefined && target !== options.expectedTarget) {
        throw new AgentError('PATH_UNSAFE', `download target changed after permission check: expected ${options.expectedTarget}, got ${target}`);
    }
    const parentPath = path.dirname(target);
    let parentIdentity;
    try {
        parentIdentity = fs.lstatSync(parentPath);
    }
    catch {
        throw new AgentError('INVALID_REQUEST', `destination parent ${parentPath} does not exist`);
    }
    if (!parentIdentity.isDirectory() || parentIdentity.isSymbolicLink()) {
        throw new AgentError('PATH_UNSAFE', `destination parent ${parentPath} is not a real directory`);
    }
    if (fs.existsSync(target) && options.overwrite !== true) {
        throw new AgentError('DEST_EXISTS', `${target} exists; pass overwrite`);
    }
    const probe = await probeWorkspace(client, options.workspaceId, options.root, options.signal);
    if (probe.state !== 'READY') {
        throw new AgentError('WORKSPACE_ABSENT', 'the source workspace does not exist on this host yet', false, {
            state: probe.state,
        });
    }
    if (options.expectedParentDev !== undefined
        && (parentIdentity.dev !== options.expectedParentDev || parentIdentity.ino !== options.expectedParentIno)) {
        throw new AgentError('PATH_UNSAFE', `download parent changed after permission check: ${parentPath}`);
    }
    await openWorkspaceReadOnly(client, options.workspaceId, options.root, options.signal);
    const parent = path.dirname(target);
    const temporary = path.join(parent, `.fleet-download-${process.pid}-${crypto.randomBytes(8).toString('hex')}`);
    await report(options.onProgress, { phase: 'opening', bytes: 0 });
    const opened = (await client.request('transfer.get', {
        workspaceId: options.workspaceId,
        path: options.path,
    }));
    throwIfAborted(options.signal);
    await report(options.onProgress, { phase: 'downloading', bytes: 0, digest: opened.digest });
    const currentParent = fs.lstatSync(parent);
    if (currentParent.dev !== parentIdentity.dev || currentParent.ino !== parentIdentity.ino) {
        throw new AgentError('PATH_UNSAFE', `download parent changed before writing: ${parent}`);
    }
    try {
        await client.collectToFile(opened.streamId, temporary, {
            initialCredit: 8 * 1024 * 1024,
            timeoutMs: 1_800_000,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
        throwIfAborted(options.signal);
        const digest = await sha256File(temporary);
        const size = fs.statSync(temporary).size;
        if (size !== opened.size || digest !== opened.digest) {
            throw new AgentError('BLOB_CORRUPT', `download verification failed for ${options.path}`);
        }
        await report(options.onProgress, { phase: 'writing', bytes: size, digest });
        // The approved path and its parent may not change while the bytes are in flight.
        if (options.expectedParentDev !== undefined) {
            const parent = fs.lstatSync(path.dirname(target));
            if (parent.dev !== options.expectedParentDev || parent.ino !== options.expectedParentIno) {
                throw new AgentError('PATH_UNSAFE', `download parent changed while writing: ${path.dirname(target)}`);
            }
        }
        const finalTarget = canonicalTransferTarget(target, false);
        if (finalTarget !== target) {
            throw new AgentError('PATH_UNSAFE', `download target changed while writing: expected ${target}, got ${finalTarget}`);
        }
        if (options.overwrite === true) {
            fs.renameSync(temporary, target);
        }
        else {
            try {
                fs.linkSync(temporary, target);
            }
            catch (error) {
                if (error.code === 'EEXIST') {
                    throw new AgentError('DEST_EXISTS', `${target} exists; pass overwrite`);
                }
                throw error;
            }
            fs.unlinkSync(temporary);
        }
        await report(options.onProgress, { phase: 'done', bytes: size, digest });
        return { bytes: size, digest, file: target };
    }
    finally {
        try {
            fs.rmSync(temporary, { force: true });
        }
        catch { /* already published */ }
    }
}
export function artifactTarget(dest, artifact) {
    return path.resolve(dest, path.basename(artifact));
}
/** Resolve existing symlinks and reject dangling links before a local artifact write. */
export function canonicalArtifactTarget(dest, artifact) {
    const target = artifactTarget(dest, artifact);
    let current = target;
    const missing = [];
    for (;;) {
        try {
            fs.lstatSync(current);
            break;
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
            const parent = path.dirname(current);
            if (parent === current)
                throw new AgentError('PATH_UNSAFE', `cannot resolve ${target}`);
            missing.unshift(path.basename(current));
            current = parent;
        }
    }
    let real;
    try {
        real = fs.realpathSync(current);
    }
    catch {
        throw new AgentError('PATH_UNSAFE', `artifact target contains a dangling symlink: ${current}`);
    }
    return path.join(real, ...missing);
}
export async function fetchArtifact(client, options) {
    throwIfAborted(options.signal);
    const target = canonicalTransferTarget(path.join(options.dest, path.basename(options.artifact)), false);
    let parent;
    try {
        parent = fs.lstatSync(path.dirname(target));
    }
    catch {
        throw new AgentError('INVALID_REQUEST', `artifact destination parent ${path.dirname(target)} does not exist`);
    }
    if (!parent.isDirectory() || parent.isSymbolicLink()) {
        throw new AgentError('PATH_UNSAFE', `artifact destination parent ${path.dirname(target)} is not a real directory`);
    }
    if (options.expectedTarget !== undefined && target !== options.expectedTarget) {
        throw new AgentError('PATH_UNSAFE', `artifact target changed after permission check: expected ${options.expectedTarget}, got ${target}`);
    }
    const result = await downloadFile(client, {
        workspaceId: options.workspaceId,
        root: options.root,
        path: options.artifact,
        dest: target,
        expectedTarget: target,
        overwrite: options.overwrite === true,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(options.onProgress === undefined
            ? {}
            : {
                onProgress: (progress) => {
                    const phase = progress.phase === 'downloading' || progress.phase === 'uploading'
                        ? 'streaming'
                        : progress.phase;
                    return options.onProgress?.({
                        phase,
                        bytes: progress.bytes,
                        ...(progress.digest === undefined ? {} : { digest: progress.digest }),
                    });
                },
            }),
    });
    return { file: result.file, bytes: result.bytes, digest: result.digest };
}
export async function localDigest(file) {
    return sha256File(file);
}
//# sourceMappingURL=operations.js.map