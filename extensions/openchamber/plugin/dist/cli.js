/** Command line interface on top of fleet.agent.v1. */
import fs from 'node:fs';
import path from 'node:path';
import { compileExcludes, configPaths, defaultWorkspaceName, initProjectConfig, loadDefaults, loadHostsOnlyConfig, loadSessionConfig, saveDefaults, hostAllows, workspaceLabel, } from './config.js';
import { FleetError, friendlyErrorMessage } from './errors.js';
import { hostViews, selectHost } from './hosts.js';
import { runWorkspace } from './run.js';
import { scratchConfig } from './scratch.js';
import { AgentError, exitCodeFor } from './v1/errors.js';
import { connectSsh, downloadFile, execCommand, recoverWorkspace, status, syncWorkspace, uploadFile, } from './v1/operations.js';
const BOOLEAN_FLAGS = new Set(['json', 'plan', 'apply', 'overwrite', 'force', 'adopt', 'abort', 'help', 'workspace-file', 'clear', 'scratch']);
export async function main(argv) {
    const parsed = parse(argv);
    if (parsed.command === '' || parsed.command === 'help' || parsed.flags.has('help')) {
        printHelp();
        return;
    }
    try {
        switch (parsed.command) {
            case 'init': return cmdInit(parsed);
            case 'default': return cmdDefault(parsed);
            case 'doctor': return await cmdDoctor(parsed);
            case 'status': return await cmdStatus(parsed);
            case 'recover': return await cmdRecover(parsed);
            case 'sync': return await cmdSync(parsed);
            case 'run': return await cmdRun(parsed);
            case 'exec': return await cmdExec(parsed);
            case 'fetch': return await cmdFetch(parsed);
            case 'upload': return await cmdUpload(parsed);
            case 'download': return await cmdDownload(parsed);
            case 'hosts': return cmdHosts(parsed);
            default: throw new FleetError('usage', `unknown command ${parsed.command}`);
        }
    }
    catch (error) {
        if (error instanceof AgentError) {
            process.stderr.write(`${error.code}: ${friendlyErrorMessage(error)}${error.retryable ? ' (retryable)' : ''}\n`);
            process.exitCode = exitCodeFor(error.code);
        }
        else if (error instanceof FleetError) {
            process.stderr.write(`${error.code}: ${friendlyErrorMessage(error)}\n`);
            process.exitCode = error.exitCode;
        }
        else {
            const message = error instanceof Error ? error.message : String(error);
            process.stderr.write(`internal: ${message}\n`);
            process.exitCode = 6;
        }
    }
}
function parse(argv) {
    const positional = [];
    const flags = new Map();
    const rest = [];
    let command = '';
    let index = 0;
    for (; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--') {
            rest.push(...argv.slice(index + 1));
            break;
        }
        if (!token.startsWith('--')) {
            if (command === '')
                command = token;
            else
                positional.push(token);
            continue;
        }
        const [name, inline] = token.slice(2).split('=', 2);
        if (inline !== undefined) {
            flags.set(name, inline);
            continue;
        }
        const next = argv[index + 1];
        if (next !== undefined && !next.startsWith('--') && !BOOLEAN_FLAGS.has(name)) {
            flags.set(name, next);
            index += 1;
        }
        else {
            flags.set(name, true);
        }
    }
    return { command, positional, flags, rest };
}
function configOf(flags, hostsOnly = false) {
    const config = flags.get('config');
    const configDir = flags.get('config-dir');
    const options = {
        ...(typeof config === 'string' ? { config } : {}),
        ...(typeof configDir === 'string' ? { configDir } : {}),
    };
    try {
        return loadSessionConfig(process.cwd(), options).config;
    }
    catch (error) {
        if (hostsOnly && error instanceof FleetError && error.code === 'config-missing') {
            try {
                return loadHostsOnlyConfig(process.cwd(), options);
            }
            catch {
                // Fall through to the original project message.
            }
        }
        throw error;
    }
}
/** Project config by default; `--scratch` gives a remote-only session space. */
function executionConfigOf(flags) {
    if (!flags.has('scratch'))
        return configOf(flags);
    return scratchConfig({ seed: process.cwd(), directory: process.cwd() });
}
function cmdDefault(parsed) {
    const configDir = parsed.flags.get('config-dir');
    const options = typeof configDir === 'string' ? { configDir } : {};
    if (parsed.flags.has('clear')) {
        const value = saveDefaults(null, options);
        if (parsed.flags.has('json'))
            process.stdout.write(`${JSON.stringify(value)}\n`);
        else
            process.stdout.write('default workspace cleared\n');
        return;
    }
    const directory = parsed.positional[0];
    if (directory === undefined) {
        const value = loadDefaults(options);
        if (parsed.flags.has('json'))
            process.stdout.write(`${JSON.stringify(value)}\n`);
        else if (value.directory)
            process.stdout.write(`${value.directory}\n`);
        return;
    }
    const value = saveDefaults(directory, options);
    if (parsed.flags.has('json'))
        process.stdout.write(`${JSON.stringify(value)}\n`);
    else
        process.stdout.write(`default workspace ${value.directory}\n`);
}
function hostOf(config, flags, operation) {
    const alias = flags.get('host');
    if (typeof alias !== 'string')
        throw new FleetError('usage', '--host <alias> is required');
    const host = config.hosts[alias];
    if (!host) {
        throw new FleetError('usage', `unknown host ${JSON.stringify(alias)}`, { known: Object.keys(config.hosts).join(', ') });
    }
    if (operation !== undefined && !hostAllows(host, operation)) {
        throw new FleetError('usage', `host ${JSON.stringify(alias)} is not allowed for ${operation}`);
    }
    return host;
}
function agentPath(flags) {
    const value = flags.get('agent-path') ?? process.env.FLEET_AGENT_PATH ?? 'fleet-agent';
    return String(value);
}
function tagsOf(flags) {
    const value = flags.get('tag');
    if (typeof value !== 'string')
        return [];
    return [...new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean))];
}
function cmdInit(parsed) {
    const host = parsed.flags.get('host');
    const ssh = parsed.flags.get('ssh');
    if (typeof host !== 'string' || typeof ssh !== 'string') {
        throw new FleetError('usage', 'init needs --host <alias> and --ssh <user@host>');
    }
    const configDir = parsed.flags.get('config-dir');
    const portValue = parsed.flags.get('port');
    const root = parsed.flags.get('root');
    const name = parsed.flags.get('name');
    const tags = tagsOf(parsed.flags);
    if (parsed.flags.has('workspace-file')) {
        const file = path.join(configPaths(process.cwd()).workspaceRoot, 'fleet.json');
        if (fs.existsSync(file) && !parsed.flags.has('force')) {
            throw new FleetError('config-invalid', 'fleet.json already exists', { hint: 'pass --force to replace it' });
        }
        const workspaceName = typeof name === 'string' ? name : defaultWorkspaceName(process.cwd());
        const entry = { ssh };
        if (typeof portValue === 'string')
            entry.port = Number(portValue);
        if (typeof root === 'string')
            entry.root = root;
        if (tags.length > 0)
            entry.tags = tags;
        const config = { name: workspaceName, hosts: { [host]: entry }, excludes: [], env: {} };
        fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
        process.stdout.write(`wrote ${file}\n`);
        return;
    }
    const documents = initProjectConfig(process.cwd(), {
        alias: host,
        ssh,
        ...(typeof portValue === 'string' ? { port: Number(portValue) } : {}),
        ...(typeof root === 'string' ? { root } : {}),
        ...(typeof name === 'string' ? { name } : {}),
        ...(tags.length > 0 ? { tags } : {}),
        ...(typeof configDir === 'string' ? { configDir } : {}),
        force: parsed.flags.has('force'),
    });
    process.stdout.write(`wrote ${documents.hostsFile}\n`);
    process.stdout.write(`wrote ${documents.projectFile}\n`);
}
async function cmdDoctor(parsed) {
    const config = configOf(parsed.flags);
    const alias = typeof parsed.flags.get('host') === 'string' ? String(parsed.flags.get('host')) : undefined;
    const aliases = alias ? [alias] : Object.keys(config.hosts);
    process.stdout.write(`node ${process.version}\n`);
    for (const name of aliases) {
        const host = config.hosts[name];
        if (!host)
            throw new FleetError('usage', `unknown host ${name}`);
        const client = await connectSsh(host, { agentPath: agentPath(parsed.flags) });
        try {
            const info = (await client.request('doctor', {}));
            const agent = info.agent;
            process.stdout.write(`${name}: protocol ${info.protocol.major}, agent ${agent?.version}, state ${String(info.stateDir)}\n`);
        }
        finally {
            client.close();
        }
    }
}
async function cmdStatus(parsed) {
    const config = executionConfigOf(parsed.flags);
    const host = hostOf(config, parsed.flags, parsed.flags.has('scratch') ? 'scratch' : 'workspace');
    const client = await connectSsh(host, { agentPath: agentPath(parsed.flags) });
    try {
        const info = await status(client, config.name, host.root);
        if (parsed.flags.has('json')) {
            process.stdout.write(JSON.stringify(info, null, 2) + '\n');
        }
        else {
            process.stdout.write(`${workspaceLabel(config)}: generation ${info.generation} ${info.manifestDigest}${info.recovery ? ' RECOVERY' : ''}\n`);
        }
    }
    finally {
        client.close();
    }
}
async function cmdRecover(parsed) {
    const config = configOf(parsed.flags);
    const host = hostOf(config, parsed.flags, 'workspace');
    const client = await connectSsh(host, { agentPath: agentPath(parsed.flags) });
    try {
        const result = await recoverWorkspace(client, config.name, host.root, parsed.flags.has('abort') ? 'abort' : 'recover');
        if (parsed.flags.has('json')) {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
            return;
        }
        if (result.state === 'READY' && !result.recovered) {
            process.stdout.write(`${workspaceLabel(config)}@${host.alias}: READY\n`);
            return;
        }
        process.stdout.write(`${workspaceLabel(config)}@${host.alias}: recovered generation ${result.generation ?? 'unknown'} ${result.manifestDigest ?? ''}\n`);
    }
    finally {
        client.close();
    }
}
function excludesOf(config, flags) {
    const extra = flags.get('exclude');
    const additions = typeof extra === 'string'
        ? extra.split(',').map((value) => value.trim()).filter(Boolean)
        : [];
    return [...new Set([...config.excludes, ...additions])];
}
async function cmdSync(parsed) {
    const config = configOf(parsed.flags);
    const host = hostOf(config, parsed.flags, 'workspace');
    const excludes = excludesOf(config, parsed.flags);
    const matcher = compileExcludes(excludes);
    const client = await connectSsh(host, { agentPath: agentPath(parsed.flags) });
    try {
        const result = await syncWorkspace(client, matcher, {
            workspaceId: config.name,
            source: config.dir,
            root: host.root,
            excludes,
            mode: parsed.flags.has('plan') ? 'plan' : 'apply',
            adopt: parsed.flags.has('adopt'),
            ...(typeof parsed.flags.get('plan-token') === 'string' ? { planToken: String(parsed.flags.get('plan-token')) } : {}),
        });
        process.stdout.write(`plan ${result.changes.length} change(s) ${result.planDigest}\n`);
        if (result.planToken)
            process.stdout.write(`plan-token ${result.planToken}\n`);
        for (const change of result.changes.slice(0, 50)) {
            process.stdout.write(`  ${change.action.padEnd(7)} ${change.path}\n`);
        }
        if (result.generation !== undefined) {
            process.stdout.write(`generation ${result.generation} ${result.manifestDigest}\n`);
        }
    }
    finally {
        client.close();
    }
}
function envOf(flags) {
    const env = {};
    const envFlag = flags.get('env');
    if (typeof envFlag === 'string') {
        for (const pair of envFlag.split(',')) {
            const [key, ...rest] = pair.split('=');
            if (key)
                env[key] = rest.join('=');
        }
    }
    return env;
}
function timeoutMsOf(flags) {
    const timeout = flags.get('timeout');
    return typeof timeout === 'string' ? Number(timeout) * 1000 : undefined;
}
async function cmdRun(parsed) {
    const config = executionConfigOf(parsed.flags);
    const host = selectHost(config, {
        ...(typeof parsed.flags.get('host') === 'string' ? { host: String(parsed.flags.get('host')) } : {}),
        tags: tagsOf(parsed.flags),
        operation: parsed.flags.has('scratch') ? 'scratch' : 'workspace',
    });
    const argv = parsed.rest.length > 0 ? parsed.rest : parsed.positional;
    if (argv.length === 0)
        throw new FleetError('usage', 'run needs a command after --');
    const syncFlag = parsed.flags.get('sync');
    const sync = syncFlag === 'never' || syncFlag === 'plan' || syncFlag === 'apply'
        ? syncFlag
        : parsed.flags.has('plan')
            ? 'plan'
            : parsed.flags.has('apply')
                ? 'apply'
                : 'auto';
    if (parsed.flags.has('scratch') && (sync === 'plan' || sync === 'apply')) {
        throw new FleetError('usage', '--scratch has no source tree; sync=plan/apply requires a project workspace');
    }
    const additions = parsed.flags.has('scratch')
        ? []
        : excludesOf(config, parsed.flags).filter((pattern) => !config.excludes.includes(pattern));
    const client = await connectSsh(host, { agentPath: agentPath(parsed.flags) });
    try {
        const result = parsed.flags.has('scratch')
            ? await execCommand(client, {
                workspaceId: config.name,
                root: host.root,
                argv,
                cwd: typeof parsed.flags.get('cwd') === 'string' ? String(parsed.flags.get('cwd')) : undefined,
                env: envOf(parsed.flags),
                timeoutMs: timeoutMsOf(parsed.flags),
            }).then((exec) => ({ state: exec.state, sync: null, exec }))
            : await runWorkspace(client, config, host, {
                argv,
                cwd: typeof parsed.flags.get('cwd') === 'string' ? String(parsed.flags.get('cwd')) : undefined,
                env: envOf(parsed.flags),
                timeoutMs: timeoutMsOf(parsed.flags),
                sync,
                excludes: additions,
            });
        if (parsed.flags.has('json')) {
            process.stdout.write(`${JSON.stringify({
                host: host.alias,
                state: result.state,
                sync: result.sync,
                jobId: result.exec?.jobId ?? null,
                exitCode: result.exec?.exitCode ?? null,
                signal: result.exec?.signal ?? null,
            }, null, 2)}\n`);
        }
        else if (result.state === 'sync-required') {
            process.stdout.write(`sync required: ${result.sync?.changes ?? 0} change(s)\n`);
            for (const change of result.sync?.items.slice(0, 50) ?? []) {
                process.stdout.write(`  ${change.action.padEnd(7)} ${change.path}\n`);
            }
        }
        else if (result.exec) {
            process.stdout.write(result.exec.stdout);
            process.stderr.write(result.exec.stderr);
        }
        if (result.state === 'sync-required') {
            process.exitCode = 6;
        }
        else if (result.exec) {
            process.exitCode = result.exec.exitCode ?? 1;
        }
    }
    finally {
        client.close();
    }
}
function cmdHosts(parsed) {
    const config = parsed.flags.has('scratch') ? executionConfigOf(parsed.flags) : configOf(parsed.flags, true);
    const tags = tagsOf(parsed.flags);
    const views = hostViews(config);
    let selected = null;
    if (tags.length > 0) {
        try {
            selected = selectHost(config, { tags }).alias;
        }
        catch {
            selected = null;
        }
    }
    if (parsed.flags.has('json')) {
        process.stdout.write(`${JSON.stringify({ workspace: workspaceLabel(config), hosts: views, selected }, null, 2)}\n`);
        return;
    }
    for (const view of views) {
        process.stdout.write(`${view.alias}\t${view.tagsLabel}\n`);
    }
    if (selected)
        process.stdout.write(`selected\t${selected}\n`);
    if (tags.length > 0 && !selected)
        process.exitCode = 2;
}
async function cmdExec(parsed) {
    const config = executionConfigOf(parsed.flags);
    const host = hostOf(config, parsed.flags, parsed.flags.has('scratch') ? 'scratch' : 'workspace');
    const argv = parsed.rest.length > 0 ? parsed.rest : parsed.positional;
    if (argv.length === 0)
        throw new FleetError('usage', 'exec needs a command after --');
    const env = envOf(parsed.flags);
    const timeoutMs = timeoutMsOf(parsed.flags);
    const cwd = typeof parsed.flags.get('cwd') === 'string' ? String(parsed.flags.get('cwd')) : undefined;
    const client = await connectSsh(host, { agentPath: agentPath(parsed.flags) });
    try {
        const result = await execCommand(client, {
            workspaceId: config.name,
            root: host.root,
            argv,
            cwd,
            env,
            timeoutMs,
        });
        process.stdout.write(result.stdout);
        process.stderr.write(result.stderr);
        if (parsed.flags.has('json')) {
            process.stdout.write(JSON.stringify({ jobId: result.jobId, state: result.state, exitCode: result.exitCode }, null, 2) + '\n');
        }
        process.exitCode = result.exitCode ?? 1;
    }
    finally {
        client.close();
    }
}
async function cmdFetch(parsed) {
    const config = executionConfigOf(parsed.flags);
    const host = hostOf(config, parsed.flags, 'transfer');
    const dest = parsed.flags.get('dest');
    if (typeof dest !== 'string')
        throw new FleetError('usage', '--dest <dir> is required');
    const artifact = parsed.rest[0] ?? parsed.positional[0];
    if (!artifact)
        throw new FleetError('usage', 'fetch needs an artifact path');
    const client = await connectSsh(host, { agentPath: agentPath(parsed.flags) });
    try {
        const result = await downloadFile(client, {
            workspaceId: config.name,
            root: host.root,
            path: artifact,
            dest: path.join(dest, path.basename(artifact)),
            overwrite: parsed.flags.has('overwrite'),
        });
        process.stdout.write(`fetched ${result.file} (${result.bytes} bytes) ${result.digest}\n`);
    }
    finally {
        client.close();
    }
}
async function cmdUpload(parsed) {
    const source = parsed.positional[0] ?? parsed.rest[0];
    const remote = parsed.flags.get('to');
    if (!source || typeof remote !== 'string') {
        throw new FleetError('usage', 'upload needs <local-path> and --to <remote-path>');
    }
    // Uploads always land in the private scratch space, never in a replica root.
    const config = scratchConfig({ seed: process.cwd(), directory: process.cwd() });
    const host = hostOf(config, parsed.flags, 'transfer');
    const client = await connectSsh(host, { agentPath: agentPath(parsed.flags) });
    try {
        const result = await uploadFile(client, {
            workspaceId: config.name,
            root: host.root,
            path: remote,
            source: path.resolve(source),
            overwrite: parsed.flags.has('overwrite'),
        });
        process.stdout.write(`uploaded ${source} -> ${remote} (${result.bytes} bytes) ${result.digest}\n`);
    }
    finally {
        client.close();
    }
}
async function cmdDownload(parsed) {
    const remote = parsed.positional[0] ?? parsed.rest[0];
    const dest = parsed.flags.get('dest');
    if (!remote || typeof dest !== 'string') {
        throw new FleetError('usage', 'download needs <remote-path> and --dest <local-path>');
    }
    const config = executionConfigOf(parsed.flags);
    const host = hostOf(config, parsed.flags, 'transfer');
    const client = await connectSsh(host, { agentPath: agentPath(parsed.flags) });
    try {
        const result = await downloadFile(client, {
            workspaceId: config.name,
            root: host.root,
            path: remote,
            dest: path.resolve(dest),
            overwrite: parsed.flags.has('overwrite'),
        });
        process.stdout.write(`downloaded ${remote} -> ${result.file} (${result.bytes} bytes) ${result.digest}\n`);
    }
    finally {
        client.close();
    }
}
function printHelp() {
    process.stdout.write([
        'fleet — run work on a machine that has the cores',
        '',
        'usage:',
        '  fleet init --host <alias> --ssh <user@host> [--port N] [--root PATH] [--name NAME] [--tag a,b] [--force]',
        '               writes $XDG_CONFIG_HOME/openchamber-fleet/ (use --workspace-file for legacy fleet.json)',
        '  fleet default [<project-dir>] [--clear] [--json]',
        '               set/show the workspace used by projectless chats',
        '  fleet doctor [--host <alias>] [--agent-path PATH]',
        '  fleet hosts [--tag a,b] [--json]',
        '  fleet status --host <alias> [--json]',
        '  fleet recover --host <alias> [--abort] [--json]',
        '  fleet sync --host <alias> (--plan | --apply) [--exclude pat,pat] [--adopt]',
        '  fleet run [--host <alias|auto>] [--tag a,b] [--cwd P] [--env K=V,...] [--timeout SEC]',
        '            [--sync auto|never|plan|apply] [--exclude pat,pat] [--scratch] [--json] -- <command…>',
        '  fleet exec --host <alias> [--cwd P] [--env K=V,...] [--timeout SEC] [--scratch] [--json] -- <command…>',
        '  fleet fetch --host <alias> --dest <dir> [--overwrite] [--scratch] -- <path>',
        '  fleet upload <local-path> --host <alias> --to <remote-path> [--scratch] [--overwrite]',
        '  fleet download <remote-path> --host <alias> --dest <local-path> [--scratch] [--overwrite]',
        '  all commands accept --config-dir <dir>; --scratch uses a private remote-only session space',
        '',
    ].join('\n'));
}
//# sourceMappingURL=cli.js.map