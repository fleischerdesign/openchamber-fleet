/** Agent-facing run: synchronize when needed, then execute in one operation. */
import { compileExcludes } from './config.js';
import { AgentError } from './v1/errors.js';
import { execCommand, syncWorkspace, } from './v1/operations.js';
const defaultOperations = {
    sync: syncWorkspace,
    exec: execCommand,
};
function isBusy(error) {
    const code = error?.code;
    return code === 'WORKSPACE_BUSY' || code === 'lease-busy';
}
function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (ms <= 0) {
            resolve();
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', abort);
            resolve();
        }, ms);
        const abort = () => {
            clearTimeout(timer);
            reject(new AgentError('CANCELLED', 'operation cancelled'));
        };
        if (signal?.aborted) {
            abort();
            return;
        }
        signal?.addEventListener('abort', abort, { once: true });
    });
}
function summaryOf(mode, result) {
    const items = result.changes.slice(0, 200);
    return {
        mode,
        planDigest: result.planDigest,
        changes: result.changes.length,
        changesTruncated: result.changes.length > items.length,
        needed: result.needed.length,
        generation: result.generation ?? null,
        manifestDigest: result.manifestDigest ?? null,
        items,
    };
}
function excludesOf(config, extra) {
    return [...new Set([...config.excludes, ...(extra ?? [])])];
}
/**
 * Synchronize before a run. `auto` and `apply` apply changes; `plan` reports whether a run would
 * need a sync and leaves the replica untouched; `never` skips the scan entirely.
 */
export async function syncForRun(client, config, host, options, operations = defaultOperations) {
    const requested = options.sync ?? 'auto';
    if (requested === 'never')
        return { sync: null, required: false };
    const mode = requested === 'plan' ? 'plan' : 'apply';
    const excludes = excludesOf(config, options.excludes);
    const attempts = 3;
    for (let attempt = 0;; attempt += 1) {
        try {
            const result = await operations.sync(client, compileExcludes(excludes), {
                workspaceId: config.name,
                source: config.dir,
                root: host.root,
                excludes,
                mode,
                adopt: options.adopt === true,
                signal: options.signal,
                onProgress: options.onSyncProgress,
            });
            const sync = summaryOf(mode, result);
            return { sync, required: mode === 'plan' && sync.changes > 0 };
        }
        catch (error) {
            if (attempt < attempts - 1 && isBusy(error)) {
                await sleep((options.retryDelayMs ?? 500) * 2 ** attempt, options.signal);
                continue;
            }
            throw error;
        }
    }
}
/**
 * The agent's normal execution path: synchronize the workspace (unless the caller explicitly says
 * no), then run the command. The agent never has to call a separate sync tool for routine work.
 */
export async function runWorkspace(client, config, host, options, operations = defaultOperations) {
    const { sync, required } = await syncForRun(client, config, host, options, operations);
    if (required)
        return { state: 'sync-required', sync, exec: null };
    if ((options.sync ?? 'auto') === 'plan') {
        return { state: 'sync-planned', sync, exec: null };
    }
    await options.beforeExec?.();
    const execOptions = {
        workspaceId: config.name,
        root: host.root,
        argv: options.argv,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.env === undefined ? {} : { env: options.env }),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(sync?.generation === null || sync?.generation === undefined ? {} : { expectedGeneration: sync.generation }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(options.onExecProgress === undefined ? {} : { onProgress: options.onExecProgress }),
    };
    const attempts = 3;
    for (let attempt = 0;; attempt += 1) {
        try {
            const exec = await operations.exec(client, execOptions);
            return { state: exec.state, sync, exec };
        }
        catch (error) {
            if (attempt < attempts - 1 && isBusy(error)) {
                await sleep((options.retryDelayMs ?? 500) * 2 ** attempt, options.signal);
                continue;
            }
            throw error;
        }
    }
}
//# sourceMappingURL=run.js.map