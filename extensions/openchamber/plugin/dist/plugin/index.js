/** Official OpenCode V2 plugin surface over fleet.agent.v1. */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { compileExcludes, loadConfig } from '../config.js';
import { FleetError, friendlyErrorMessage } from '../errors.js';
import { hostViews, selectHost } from '../hosts.js';
import { commandLabelOf, exitLabelOf, stateLabelOf } from '../labels.js';
import { runWorkspace, syncForRun } from '../run.js';
import { replicaState } from '../status.js';
import { AgentError } from '../v1/errors.js';
import { canonicalArtifactTarget, connectSsh, execCommand, fetchArtifact, recoverWorkspace, status, syncWorkspace, } from '../v1/operations.js';
import { FleetJobRegistry } from './jobs.js';
const string = { type: 'string' };
const boolean = { type: 'boolean' };
const stringArray = { type: 'array', items: string };
function schema(properties, required = []) {
    return { type: 'object', properties, required, additionalProperties: false };
}
function output(properties, required = []) {
    return schema(properties, required);
}
function jsonResult(value, metadata) {
    return { content: JSON.stringify(value), output: value, metadata };
}
function truncated(value, max = 64 * 1024) {
    return value.length <= max ? value : `${value.slice(0, max)}\n…[truncated]`;
}
function shellQuote(value) {
    if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value))
        return value;
    return `'${value.replaceAll("'", `'"'"'`)}'`;
}
function commandText(argv) {
    return argv.map(shellQuote).join(' ');
}
function agentPath() {
    return process.env.FLEET_AGENT_PATH ?? 'fleet-agent';
}
async function workspaceOf(ctx, context) {
    let directory = ctx.location?.directory ?? process.cwd();
    const sessionID = context?.sessionID;
    if (sessionID && ctx.session) {
        try {
            const info = await ctx.session.get({ sessionID });
            const value = info?.location?.directory;
            if (typeof value === 'string' && value.startsWith('/'))
                directory = value;
        }
        catch {
            // The location or server cwd remains a useful, explicit fallback.
        }
    }
    try {
        return loadConfig(directory);
    }
    catch (error) {
        if (error instanceof FleetError) {
            throw new AgentError(error.code === 'config-missing' ? 'CONFIG_MISSING' : 'CONFIG_INVALID', [
                error.message,
                error.details?.hint,
            ].filter(Boolean).join(' '));
        }
        throw error;
    }
}
function hostOf(config, input) {
    const alias = input.host;
    if (typeof alias !== 'string' || alias.length === 0)
        throw new AgentError('INVALID_REQUEST', 'host is required');
    const host = config.hosts[alias];
    if (!host) {
        throw new AgentError('INVALID_REQUEST', `unknown host ${JSON.stringify(alias)}; known: ${Object.keys(config.hosts).join(', ')}`);
    }
    return host;
}
function sessionIDOf(context) {
    if (!context?.sessionID)
        throw new AgentError('INVALID_REQUEST', 'this operation requires an OpenCode session');
    return context.sessionID;
}
async function assertPermission(ctx, context, action, resources, metadata, save) {
    if (!ctx.permission)
        return;
    const input = {
        sessionID: sessionIDOf(context),
        agent: context?.agent,
        source: { type: 'tool', messageID: context?.messageID, id: context?.id },
        action,
        resources,
        metadata,
    };
    // The permission schema validates a present save field as an array; an
    // explicit undefined is rejected by the runtime.
    if (save !== undefined)
        input.save = save;
    await ctx.permission.assert(input);
}
function progressReporter(context) {
    let last = 0;
    return async (update) => {
        const now = Date.now();
        if (now - last < 200 && update.phase !== 'done')
            return;
        last = now;
        await context?.progress?.(update);
    };
}
async function withClient(host, context, run, options = {}) {
    const client = await connectSsh(host, { agentPath: agentPath() });
    if (context?.signal?.aborted) {
        client.close();
        throw new AgentError('CANCELLED', 'operation cancelled');
    }
    const onAbort = () => client.close();
    if (options.closeOnAbort !== false)
        context?.signal?.addEventListener('abort', onAbort, { once: true });
    try {
        return await run(client);
    }
    catch (error) {
        if (error instanceof AgentError) {
            throw new AgentError(error.code, friendlyErrorMessage(error), error.retryable, error.details);
        }
        throw error;
    }
    finally {
        context?.signal?.removeEventListener('abort', onAbort);
        client.close();
    }
}
function syncOutput(config, host, mode, result) {
    const items = result.changes.slice(0, 200);
    return {
        workspace: config.name,
        host: host.alias,
        mode,
        modeLabel: mode === 'apply' ? 'Applied' : 'Planned',
        planDigest: result.planDigest,
        generation: result.generation ?? null,
        manifestDigest: result.manifestDigest ?? null,
        changes: result.changes.length,
        changesTruncated: result.changes.length > items.length,
        needed: result.needed.length,
        items,
    };
}
function validateExec(config, host, input) {
    if (!Array.isArray(input.argv) || input.argv.length === 0) {
        throw new AgentError('INVALID_REQUEST', 'argv must contain at least one command');
    }
    const argv = input.argv.map(String);
    const timeoutMs = typeof input.timeoutSeconds === 'number' && Number.isFinite(input.timeoutSeconds)
        ? input.timeoutSeconds * 1000
        : undefined;
    const inputEnv = input.env && typeof input.env === 'object'
        ? Object.fromEntries(Object.entries(input.env).map(([key, value]) => [key, String(value)]))
        : {};
    const unsafeEnv = Object.keys(inputEnv).filter((key) => /^(PATH|LD_.*|DYLD_.*|NODE_OPTIONS|PYTHONPATH|BASH_ENV|ENV|GIT_SSH_COMMAND|GIT_ASKPASS|SSH_ASKPASS|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|PERL5OPT|RUBYOPT|PYTHONSTARTUP)$/.test(key));
    if (unsafeEnv.length > 0) {
        throw new AgentError('INVALID_REQUEST', `execution-sensitive environment variables must be declared in the project config: ${unsafeEnv.join(', ')}`);
    }
    const env = { ...config.env, ...inputEnv };
    const cwd = typeof input.cwd === 'string' ? input.cwd : undefined;
    const command = commandText(argv);
    const envDigest = createHash('sha256').update(JSON.stringify(Object.entries(env).sort(([left], [right]) => left.localeCompare(right)))).digest('hex');
    const descriptor = JSON.stringify({ host: host.alias, cwd: cwd ?? '.', envKeys: Object.keys(env).sort(), envDigest, argv });
    return {
        argv,
        ...(cwd === undefined ? {} : { cwd }),
        env,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        command,
        descriptor,
        metadata: {
            workspace: config.name,
            host: host.alias,
            argv,
            cwd: cwd ?? '.',
            envKeys: Object.keys(env).sort(),
        },
    };
}
async function assertShellPermission(ctx, context, exec, extra = {}) {
    const metadata = { ...exec.metadata, ...extra };
    await assertPermission(ctx, context, 'shell', [exec.command], metadata, [exec.command]);
}
function syncLabelOf(sync) {
    if (!sync)
        return 'Not synced';
    return sync.changes === 0 ? 'Up to date' : `${sync.changes} change${sync.changes === 1 ? '' : 's'}`;
}
function runOutput(config, host, argv, background, state, sync, exec, jobId) {
    const exitCode = exec?.exitCode ?? null;
    const signal = exec?.signal ?? null;
    const nextStep = state === 'sync-required'
        ? 'Review the changes, then run fleet_run with sync=apply or fleet_sync apply.'
        : background
            ? 'The session resumes when the job finishes.'
            : state === 'succeeded'
                ? 'No action needed.'
                : state === 'cancelled'
                    ? 'The job was cancelled.'
                    : 'Inspect stderr or call fleet_job_status for a background job.';
    return {
        workspace: config.name,
        host: host.alias,
        argv,
        commandLabel: commandLabelOf(argv),
        background,
        modeLabel: background ? 'Background job' : 'Foreground',
        state,
        stateLabel: stateLabelOf(state),
        exitCode,
        exitLabel: exitLabelOf(exitCode, signal, state),
        signal,
        jobId,
        syncLabel: syncLabelOf(sync),
        syncChanges: sync?.changes ?? 0,
        syncGeneration: sync?.generation ?? null,
        syncPlanDigest: sync?.planDigest ?? null,
        syncItems: sync?.items ?? [],
        syncTruncated: sync?.changesTruncated ?? false,
        stdout: exec ? truncated(exec.stdout.toString('utf8')) : '',
        stderr: exec ? truncated(exec.stderr.toString('utf8')) : '',
        nextStep,
    };
}
function execOutput(config, host, argv, background, result) {
    return {
        workspace: config.name,
        host: host.alias,
        argv,
        commandLabel: commandLabelOf(argv),
        background,
        modeLabel: background ? 'Background job' : 'Foreground',
        jobId: result.jobId,
        state: result.state,
        stateLabel: stateLabelOf(result.state),
        exitCode: result.exitCode,
        exitLabel: exitLabelOf(result.exitCode, result.signal, result.state),
        signal: result.signal,
        stdout: truncated(result.stdout.toString('utf8')),
        stderr: truncated(result.stderr.toString('utf8')),
    };
}
function storedJobOutput(record) {
    return {
        workspace: record.workspace,
        host: record.host,
        jobId: record.jobId,
        argv: record.argv,
        commandLabel: commandLabelOf(record.argv),
        state: record.state,
        stateLabel: stateLabelOf(record.state),
        exitCode: record.exitCode ?? null,
        exitLabel: exitLabelOf(record.exitCode ?? null, record.signal ?? null, record.state),
        signal: record.signal ?? null,
        startedAt: record.startedAt,
        endedAt: record.endedAt ?? null,
        stdoutBytes: record.stdoutBytes,
        stderrBytes: record.stderrBytes,
        stdoutTail: record.stdoutTail,
        stderrTail: record.stderrTail,
        error: record.error ?? null,
    };
}
export default {
    id: 'openchamber-fleet',
    async setup(ctx) {
        const registry = new FleetJobRegistry(ctx, agentPath());
        await registry.recoverInterrupted();
        registry.watchSessionDeletion();
        await ctx.tool.transform((tools) => {
            tools.add({
                name: 'fleet_status',
                description: 'Show whether a configured Fleet host is ready, synchronized, or needs recovery.',
                options: { codemode: false },
                input: schema({ host: string }, ['host']),
                output: output({
                    workspace: string,
                    host: string,
                    generation: { type: 'number' },
                    manifestDigest: string,
                    recovery: boolean,
                    statusLabel: string,
                    nextStep: string,
                }, ['workspace', 'host', 'generation', 'manifestDigest', 'recovery', 'statusLabel', 'nextStep']),
                async execute(input, context) {
                    const config = await workspaceOf(ctx, context);
                    const host = hostOf(config, input);
                    const info = await withClient(host, context, (client) => status(client, config.name, host.root, context?.signal));
                    const state = replicaState(info);
                    return jsonResult({
                        workspace: config.name,
                        host: host.alias,
                        generation: info.generation,
                        manifestDigest: info.manifestDigest,
                        recovery: info.recovery === true,
                        statusLabel: state.label,
                        nextStep: state.nextStep,
                    });
                },
            });
            tools.add({
                name: 'fleet_sync',
                description: 'Plan or apply workspace replication to a configured Fleet host. Use mode=plan before apply when changes need review.',
                options: { codemode: false },
                input: schema({
                    host: string,
                    mode: { type: 'string', enum: ['plan', 'apply'] },
                    excludes: stringArray,
                    adopt: boolean,
                }, ['host', 'mode']),
                output: output({
                    workspace: string,
                    host: string,
                    mode: string,
                    modeLabel: string,
                    planDigest: string,
                    generation: { type: ['number', 'null'] },
                    manifestDigest: { type: ['string', 'null'] },
                    changes: { type: 'number' },
                    changesTruncated: boolean,
                    needed: { type: 'number' },
                    items: { type: 'array', items: schema({ action: string, path: string }, ['action', 'path']) },
                }, ['workspace', 'host', 'mode', 'modeLabel', 'planDigest', 'changes', 'needed', 'items']),
                async execute(input, context) {
                    const config = await workspaceOf(ctx, context);
                    const host = hostOf(config, input);
                    const mode = input.mode === 'apply' ? 'apply' : 'plan';
                    const extra = Array.isArray(input.excludes) ? input.excludes.map(String) : [];
                    const excludes = [...new Set([...config.excludes, ...extra])];
                    if (mode === 'apply') {
                        await assertPermission(ctx, context, 'fleet.sync', [`${config.name}@${host.alias}`], {
                            workspace: config.name,
                            host: host.alias,
                            mode,
                            excludes,
                            adopt: input.adopt === true,
                        }, [`${config.name}@${host.alias}`]);
                    }
                    const progress = progressReporter(context);
                    const result = await withClient(host, context, (client) => syncWorkspace(client, compileExcludes(excludes), {
                        workspaceId: config.name,
                        source: config.dir,
                        root: host.root,
                        excludes,
                        mode,
                        adopt: input.adopt === true,
                        signal: context?.signal,
                        onProgress: (update) => progress({ ...update, workspace: config.name, host: host.alias }),
                    }), { closeOnAbort: false });
                    return jsonResult(syncOutput(config, host, mode, result), { host: host.alias, mode, planDigest: result.planDigest });
                },
            });
            tools.add({
                name: 'fleet_exec',
                description: 'Low-level remote execution without syncing. Prefer fleet_run for normal work; use this only when the replica is intentionally current. background=true returns a jobId, ends the turn, and resumes this session automatically.',
                options: { codemode: false, permission: 'shell' },
                input: schema({
                    host: string,
                    argv: { type: 'array', items: string, minItems: 1 },
                    cwd: string,
                    env: { type: 'object', additionalProperties: string },
                    timeoutSeconds: { type: 'number', minimum: 1 },
                    background: boolean,
                }, ['host', 'argv']),
                output: output({
                    workspace: string,
                    host: string,
                    argv: stringArray,
                    commandLabel: string,
                    background: boolean,
                    modeLabel: string,
                    jobId: string,
                    state: string,
                    stateLabel: string,
                    exitCode: { type: ['number', 'null'] },
                    exitLabel: string,
                    signal: { type: ['number', 'null'] },
                    stdout: string,
                    stderr: string,
                }, ['workspace', 'host', 'argv', 'commandLabel', 'background', 'modeLabel', 'jobId', 'state', 'stateLabel', 'exitLabel']),
                async execute(input, context) {
                    const config = await workspaceOf(ctx, context);
                    const host = hostOf(config, input);
                    const exec = validateExec(config, host, input);
                    const metadata = { ...exec.metadata, background: input.background === true };
                    await assertPermission(ctx, context, 'fleet.exec', [exec.descriptor], metadata, [exec.descriptor]);
                    await assertShellPermission(ctx, context, exec, { background: input.background === true });
                    if (input.background === true) {
                        const record = await registry.start({
                            config,
                            host,
                            sessionID: sessionIDOf(context),
                            argv: exec.argv,
                            cwd: exec.cwd,
                            env: exec.env,
                            timeoutMs: exec.timeoutMs,
                            startupSignal: context?.signal,
                            agentPath: agentPath(),
                        });
                        return jsonResult({
                            workspace: config.name,
                            host: host.alias,
                            argv: exec.argv,
                            commandLabel: commandLabelOf(exec.argv),
                            background: true,
                            modeLabel: 'Background job',
                            jobId: record.jobId,
                            state: record.state,
                            stateLabel: stateLabelOf(record.state),
                            exitCode: null,
                            exitLabel: exitLabelOf(null, null, record.state),
                            signal: null,
                            stdout: '',
                            stderr: '',
                        }, { host: host.alias, jobId: record.jobId, background: true });
                    }
                    const progress = progressReporter(context);
                    const result = await withClient(host, context, (client) => execCommand(client, {
                        workspaceId: config.name,
                        root: host.root,
                        argv: exec.argv,
                        cwd: exec.cwd,
                        env: exec.env,
                        timeoutMs: exec.timeoutMs,
                        signal: context?.signal,
                        onProgress: (update) => progress({ ...update, workspace: config.name, host: host.alias }),
                    }), { closeOnAbort: false });
                    return jsonResult(execOutput(config, host, exec.argv, false, result), {
                        host: host.alias,
                        jobId: result.jobId,
                        exitCode: result.exitCode,
                        state: result.state,
                    });
                },
            });
            tools.add({
                name: 'fleet_run',
                description: 'Run argv on a configured host, synchronizing the workspace first when it changed. This is the normal execution tool; the agent does not need a separate sync call. background=true returns a jobId, ends the turn, and resumes this session when the job finishes.',
                options: { codemode: false, permission: 'shell' },
                input: schema({
                    host: string,
                    tags: stringArray,
                    argv: { type: 'array', items: string, minItems: 1 },
                    cwd: string,
                    env: { type: 'object', additionalProperties: string },
                    timeoutSeconds: { type: 'number', minimum: 1 },
                    background: boolean,
                    sync: { type: 'string', enum: ['auto', 'never', 'plan', 'apply'] },
                    excludes: stringArray,
                    adopt: boolean,
                }, ['argv']),
                output: output({
                    workspace: string,
                    host: string,
                    argv: stringArray,
                    commandLabel: string,
                    background: boolean,
                    modeLabel: string,
                    state: string,
                    stateLabel: string,
                    exitCode: { type: ['number', 'null'] },
                    exitLabel: string,
                    signal: { type: ['number', 'null'] },
                    jobId: string,
                    syncLabel: string,
                    syncChanges: { type: 'number' },
                    syncGeneration: { type: ['number', 'null'] },
                    syncPlanDigest: { type: ['string', 'null'] },
                    syncItems: { type: 'array', items: schema({ action: string, path: string }, ['action', 'path']) },
                    syncTruncated: boolean,
                    stdout: string,
                    stderr: string,
                    nextStep: string,
                }, ['workspace', 'host', 'argv', 'commandLabel', 'background', 'modeLabel', 'state', 'stateLabel', 'exitCode', 'exitLabel', 'jobId', 'syncLabel', 'syncChanges', 'syncGeneration', 'syncPlanDigest', 'syncItems', 'syncTruncated', 'stdout', 'stderr', 'nextStep']),
                async execute(input, context) {
                    const config = await workspaceOf(ctx, context);
                    const host = selectHost(config, {
                        ...(typeof input.host === 'string' ? { host: input.host } : {}),
                        ...(Array.isArray(input.tags) ? { tags: input.tags.map(String) } : {}),
                    });
                    const exec = validateExec(config, host, input);
                    const extra = Array.isArray(input.excludes) ? input.excludes.map(String) : [];
                    const excludes = [...new Set([...config.excludes, ...extra])];
                    const syncMode = input.sync === 'never' || input.sync === 'plan' || input.sync === 'apply'
                        ? input.sync
                        : 'auto';
                    if (input.adopt === true && syncMode !== 'auto' && syncMode !== 'apply') {
                        throw new AgentError('INVALID_REQUEST', 'adopt is only valid with sync=auto or sync=apply');
                    }
                    const background = input.background === true;
                    const metadata = {
                        ...exec.metadata,
                        sync: syncMode,
                        excludes,
                        adopt: input.adopt === true,
                        background,
                    };
                    await assertPermission(ctx, context, 'fleet.run', [exec.descriptor], metadata, [exec.descriptor]);
                    const progress = progressReporter(context);
                    const common = {
                        ...(exec.cwd === undefined ? {} : { cwd: exec.cwd }),
                        env: exec.env,
                        ...(exec.timeoutMs === undefined ? {} : { timeoutMs: exec.timeoutMs }),
                        sync: syncMode,
                        excludes: extra,
                        adopt: input.adopt === true,
                        signal: context?.signal,
                        onSyncProgress: (update) => progress({ ...update, workspace: config.name, host: host.alias }),
                    };
                    if (background) {
                        const prepared = await withClient(host, context, (client) => syncForRun(client, config, host, {
                            ...common,
                            argv: exec.argv,
                        }), { closeOnAbort: false });
                        if (prepared.required) {
                            return jsonResult(runOutput(config, host, exec.argv, true, 'sync-required', prepared.sync, null, ''));
                        }
                        await assertShellPermission(ctx, context, exec, { background: true, sync: syncMode });
                        const record = await registry.start({
                            config,
                            host,
                            sessionID: sessionIDOf(context),
                            argv: exec.argv,
                            cwd: exec.cwd,
                            env: exec.env,
                            timeoutMs: exec.timeoutMs,
                            startupSignal: context?.signal,
                            agentPath: agentPath(),
                        });
                        return jsonResult(runOutput(config, host, exec.argv, true, record.state, prepared.sync, null, record.jobId), {
                            host: host.alias,
                            jobId: record.jobId,
                            background: true,
                            state: record.state,
                        });
                    }
                    const result = await withClient(host, context, (client) => runWorkspace(client, config, host, {
                        ...common,
                        argv: exec.argv,
                        onExecProgress: (update) => progress({ ...update, workspace: config.name, host: host.alias }),
                        beforeExec: () => assertShellPermission(ctx, context, exec, { background: false, sync: syncMode }),
                    }), { closeOnAbort: false });
                    return jsonResult(runOutput(config, host, exec.argv, false, result.state, result.sync, result.exec, result.exec?.jobId ?? ''), {
                        host: host.alias,
                        state: result.state,
                        changes: result.sync?.changes ?? 0,
                    });
                },
            });
            tools.add({
                name: 'fleet_hosts',
                description: 'List configured hosts and their tags. Use it to choose a host or pass tags to fleet_run/host=auto.',
                options: { codemode: false },
                input: schema({ tags: stringArray }),
                output: output({
                    workspace: string,
                    hosts: { type: 'array', items: schema({ alias: string, tags: stringArray, tagsLabel: string }, ['alias', 'tags', 'tagsLabel']) },
                    items: { type: 'array', items: schema({ alias: string, tags: stringArray, tagsLabel: string }, ['alias', 'tags', 'tagsLabel']) },
                    selected: { type: ['string', 'null'] },
                }, ['workspace', 'hosts', 'items', 'selected']),
                async execute(input, context) {
                    const config = await workspaceOf(ctx, context);
                    const views = hostViews(config);
                    let selected = null;
                    if (Array.isArray(input.tags) && input.tags.length > 0) {
                        try {
                            selected = selectHost(config, { tags: input.tags.map(String) }).alias;
                        }
                        catch {
                            selected = null;
                        }
                    }
                    return jsonResult({ workspace: config.name, hosts: views, items: views, selected });
                },
            });
            tools.add({
                name: 'fleet_jobs',
                description: 'List the background jobs owned by this session, newest first.',
                options: { codemode: false },
                input: schema({}),
                output: output({
                    jobs: { type: 'array', items: schema({
                            jobId: string,
                            host: string,
                            commandLabel: string,
                            state: string,
                            stateLabel: string,
                            exitLabel: string,
                        }, ['jobId', 'host', 'commandLabel', 'state', 'stateLabel', 'exitLabel']) },
                    items: { type: 'array', items: schema({
                            jobId: string,
                            host: string,
                            commandLabel: string,
                            state: string,
                            stateLabel: string,
                            exitLabel: string,
                        }, ['jobId', 'host', 'commandLabel', 'state', 'stateLabel', 'exitLabel']) },
                }, ['jobs', 'items']),
                async execute(_input, context) {
                    const jobs = await registry.list(sessionIDOf(context), ctx.location?.directory);
                    const rows = jobs.map((record) => ({
                        jobId: record.jobId,
                        host: record.host,
                        commandLabel: commandLabelOf(record.argv),
                        state: record.state,
                        stateLabel: stateLabelOf(record.state),
                        exitLabel: exitLabelOf(record.exitCode ?? null, record.signal ?? null, record.state),
                    }));
                    return jsonResult({ jobs: rows, items: rows });
                },
            });
            tools.add({
                name: 'fleet_fetch',
                description: 'Copy one named artifact from the replica to a local directory, verifying its digest before writing.',
                options: { codemode: false, permission: 'edit' },
                input: schema({
                    host: string,
                    artifact: string,
                    dest: string,
                    overwrite: boolean,
                }, ['host', 'artifact', 'dest']),
                output: output({
                    workspace: string,
                    host: string,
                    artifact: string,
                    file: string,
                    bytes: { type: 'number' },
                    digest: string,
                    statusLabel: string,
                }, ['workspace', 'host', 'artifact', 'file', 'bytes', 'digest', 'statusLabel']),
                async execute(input, context) {
                    const config = await workspaceOf(ctx, context);
                    const host = hostOf(config, input);
                    if (typeof input.artifact !== 'string' || typeof input.dest !== 'string') {
                        throw new AgentError('INVALID_REQUEST', 'artifact and dest are required');
                    }
                    const artifact = input.artifact;
                    const dest = path.resolve(config.dir, input.dest);
                    const target = canonicalArtifactTarget(dest, artifact);
                    await assertPermission(ctx, context, 'edit', [target], {
                        workspace: config.name,
                        host: host.alias,
                        artifact,
                        target,
                    }, [`${path.dirname(target)}/*`]);
                    const relative = path.relative(config.dir, target);
                    if (relative.startsWith('..') || path.isAbsolute(relative)) {
                        await assertPermission(ctx, context, 'external_directory', [`${path.dirname(target)}/*`], {
                            workspace: config.name,
                            host: host.alias,
                            target,
                        }, [`${path.dirname(target)}/*`]);
                    }
                    const progress = progressReporter(context);
                    const result = await withClient(host, context, (client) => fetchArtifact(client, {
                        workspaceId: config.name,
                        root: host.root,
                        artifact,
                        dest,
                        overwrite: input.overwrite === true,
                        expectedTarget: target,
                        signal: context?.signal,
                        onProgress: (update) => progress({ ...update, workspace: config.name, host: host.alias }),
                    }));
                    return jsonResult({ workspace: config.name, host: host.alias, artifact, statusLabel: 'Verified', ...result });
                },
            });
            tools.add({
                name: 'fleet_job_status',
                description: 'Show the state and bounded output tail of a background Fleet job started by this OpenCode runtime.',
                options: { codemode: false },
                input: schema({ host: string, jobId: string }, ['host', 'jobId']),
                output: output({
                    workspace: string, host: string, jobId: string, state: string, stateLabel: string,
                    exitCode: { type: ['number', 'null'] }, exitLabel: string, signal: { type: ['number', 'null'] },
                    startedAt: { type: 'number' }, endedAt: { type: ['number', 'null'] },
                    stdoutBytes: { type: 'number' }, stderrBytes: { type: 'number' },
                    stdoutTail: string, stderrTail: string, error: { type: ['string', 'null'] },
                }, ['workspace', 'host', 'jobId', 'state', 'stateLabel', 'exitLabel', 'startedAt', 'stdoutBytes', 'stderrBytes']),
                async execute(input, context) {
                    const config = await workspaceOf(ctx, context);
                    const host = hostOf(config, input);
                    if (typeof input.jobId !== 'string')
                        throw new AgentError('INVALID_REQUEST', 'jobId is required');
                    return jsonResult(storedJobOutput(await registry.status(config, host.alias, input.jobId, sessionIDOf(context))));
                },
            });
            tools.add({
                name: 'fleet_job_cancel',
                description: 'Request cancellation of a background Fleet job. The final state reports the real outcome.',
                options: { codemode: false, permission: 'fleet.job.cancel' },
                input: schema({ host: string, jobId: string }, ['host', 'jobId']),
                output: output({
                    workspace: string, host: string, jobId: string, state: string, stateLabel: string,
                    exitCode: { type: ['number', 'null'] }, exitLabel: string, signal: { type: ['number', 'null'] },
                    startedAt: { type: 'number' }, endedAt: { type: ['number', 'null'] },
                    stdoutBytes: { type: 'number' }, stderrBytes: { type: 'number' },
                    stdoutTail: string, stderrTail: string, error: { type: ['string', 'null'] },
                }, ['workspace', 'host', 'jobId', 'state', 'stateLabel', 'exitLabel', 'startedAt', 'stdoutBytes', 'stderrBytes']),
                async execute(input, context) {
                    const config = await workspaceOf(ctx, context);
                    const host = hostOf(config, input);
                    if (typeof input.jobId !== 'string')
                        throw new AgentError('INVALID_REQUEST', 'jobId is required');
                    await assertPermission(ctx, context, 'fleet.job.cancel', [`${config.name}@${host.alias}:${input.jobId}`], {
                        workspace: config.name,
                        host: host.alias,
                        jobId: input.jobId,
                    });
                    return jsonResult(storedJobOutput(await registry.cancel(config, host.alias, input.jobId, sessionIDOf(context))));
                },
            });
            tools.add({
                name: 'fleet_recover',
                description: 'Inspect and resolve a Fleet workspace left in RECOVERY. Default mode=recover completes an interrupted apply; mode=abort only works before apply.',
                options: { codemode: false, permission: 'fleet.recover' },
                input: schema({ host: string, mode: { type: 'string', enum: ['recover', 'abort'] } }, ['host']),
                output: output({
                    workspace: string,
                    host: string,
                    state: string,
                    txnId: { type: ['string', 'null'] },
                    phase: { type: ['string', 'null'] },
                    generation: { type: ['number', 'null'] },
                    manifestDigest: { type: ['string', 'null'] },
                    recovered: boolean,
                    resultLabel: string,
                    nextStep: string,
                }, ['workspace', 'host', 'state', 'recovered', 'resultLabel', 'nextStep']),
                async execute(input, context) {
                    const config = await workspaceOf(ctx, context);
                    const host = hostOf(config, input);
                    const mode = input.mode === 'abort' ? 'abort' : 'recover';
                    await assertPermission(ctx, context, 'fleet.recover', [`${config.name}@${host.alias}`], {
                        workspace: config.name,
                        host: host.alias,
                        mode,
                    }, [`${config.name}@${host.alias}`]);
                    const result = await withClient(host, context, (client) => recoverWorkspace(client, config.name, host.root, mode, context?.signal), { closeOnAbort: false });
                    const recovered = result.recovered === true;
                    const ready = result.state === 'READY';
                    const resultLabel = ready
                        ? recovered
                            ? mode === 'abort' ? 'Recovery aborted' : 'Recovered'
                            : 'Nothing to recover'
                        : 'Recovery still needed';
                    return jsonResult({
                        workspace: config.name,
                        host: host.alias,
                        state: result.state,
                        txnId: result.txnId ?? null,
                        phase: result.phase ?? null,
                        generation: result.generation ?? null,
                        manifestDigest: result.manifestDigest ?? null,
                        recovered,
                        resultLabel,
                        nextStep: ready
                            ? recovered ? 'The replica is ready; continue with fleet_sync.' : 'No action needed.'
                            : 'Inspect the workspace and retry fleet_recover.',
                    });
                },
            });
        });
        return () => registry.cleanup();
    },
};
//# sourceMappingURL=index.js.map