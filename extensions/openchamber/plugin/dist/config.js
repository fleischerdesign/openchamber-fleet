/** Fleet configuration: global host registry plus project-scoped workspace selection.
 *
 * The legacy `fleet.json` shape is still accepted, but `fleet init` no longer writes it.
 * Host definitions are machine/user configuration. A project only selects aliases and
 * carries its own excludes and optional remote-root overrides.
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FleetError } from './errors.js';
import { assertAlias, assertRemoteRoot, assertSshTarget, assertTag, assertWorkspaceName } from './paths.js';
const LEGACY_KEYS = new Set(['name', 'hosts', 'excludes', 'env', 'shell']);
const LEGACY_HOST_KEYS = new Set(['ssh', 'port', 'root', 'tags']);
const HOST_REGISTRY_KEYS = new Set(['version', 'hosts']);
const HOST_ENTRY_KEYS = new Set(['ssh', 'port', 'tags', 'allow']);
const PROJECT_KEYS = new Set(['version', 'name', 'scope', 'hosts', 'requires', 'roots', 'excludes', 'env', 'shell']);
const DEFAULTS_KEYS = new Set(['version', 'directory']);
const SHELLS = new Set(['bash', 'sh', 'dash', 'zsh']);
const CONFIG_VERSION = 1;
export function workspaceLabel(config) {
    return config.label ?? config.name;
}
export function hostAllows(host, operation) {
    return host.allow === undefined || host.allow.includes(operation);
}
const HOST_OPERATIONS = ['workspace', 'scratch', 'transfer'];
export function defaultRemoteRoot(name) {
    return `~/.cache/openchamber-fleet/${name}`;
}
export function configDirOf(options = {}) {
    if (options.configDir)
        return path.resolve(options.configDir);
    if (process.env.FLEET_CONFIG_DIR)
        return path.resolve(process.env.FLEET_CONFIG_DIR);
    const base = process.env.XDG_CONFIG_HOME
        ? path.resolve(process.env.XDG_CONFIG_HOME)
        : path.join(os.homedir(), '.config');
    return path.join(base, 'openchamber-fleet');
}
export function configPaths(cwd = process.cwd(), options = {}) {
    const root = workspaceRoot(cwd);
    const projectId = projectIdFor(root);
    const configDir = configDirOf(options);
    return {
        configDir,
        hostsFile: path.join(configDir, 'hosts.json'),
        projectFile: path.join(configDir, 'workspaces', `${projectId}.json`),
        projectId,
        workspaceRoot: root,
    };
}
export function defaultsPath(options = {}) {
    return path.join(configDirOf(options), 'defaults.json');
}
export function loadDefaults(options = {}) {
    const file = defaultsPath(options);
    if (!fs.existsSync(file))
        return { version: CONFIG_VERSION };
    const top = asRecord(readJson(file), 'defaults.json');
    rejectUnknown(top, DEFAULTS_KEYS, 'defaults.json');
    const version = top.version === undefined ? CONFIG_VERSION : requireConfigVersion(top.version, 'defaults.json.version');
    if (top.directory === undefined)
        return { version };
    const directory = requireString(top, 'directory', 'defaults.json');
    if (directory.includes('\0') || !path.isAbsolute(directory)) {
        throw new FleetError('config-invalid', 'defaults.json.directory must be an absolute directory', { file });
    }
    return { version, directory: path.resolve(directory) };
}
export function saveDefaults(directory, options = {}) {
    const file = defaultsPath(options);
    if (directory === null) {
        fs.rmSync(file, { force: true });
        return { version: CONFIG_VERSION };
    }
    if (directory.includes('\0'))
        throw new FleetError('config-invalid', 'the default workspace must not contain NUL');
    let resolved;
    let stat;
    try {
        resolved = fs.realpathSync(path.resolve(directory));
        stat = fs.statSync(resolved);
    }
    catch {
        throw new FleetError('config-invalid', `default workspace ${directory} does not exist`);
    }
    if (!stat.isDirectory())
        throw new FleetError('config-invalid', `default workspace ${resolved} is not a directory`);
    if (isOpenChamberInternalDirectory(resolved)) {
        throw new FleetError('config-invalid', 'an internal OpenChamber chat directory cannot be the default workspace');
    }
    const defaults = { version: CONFIG_VERSION, directory: resolved };
    writeJson(file, defaults);
    return defaults;
}
/** OpenChamber uses its own chat-data directory as a session location without a project. */
export function isOpenChamberInternalDirectory(directory) {
    const parts = path.resolve(directory).split(path.sep);
    for (let index = 0; index < parts.length - 1; index += 1) {
        if (parts[index] === 'openchamber' && (parts[index + 1] === 'chats' || parts[index + 1] === 'guest-data')) {
            return true;
        }
    }
    return false;
}
/**
 * Resolve the workspace for a session. A projectless OpenChamber chat falls back to the
 * configured default project; an ordinary project without Fleet configuration still fails.
 */
export function loadSessionConfig(directory = process.cwd(), options = {}) {
    try {
        return { config: loadConfig(directory, options), fallback: false };
    }
    catch (error) {
        if (!(error instanceof FleetError) || error.code !== 'config-missing')
            throw error;
        if (!isOpenChamberInternalDirectory(directory))
            throw error;
        const defaults = loadDefaults(options);
        if (!defaults.directory) {
            throw new FleetError('config-missing', 'no Fleet project is selected and no default workspace is configured', {
                hint: 'run `fleet default <project-directory>` once, or open a project',
            });
        }
        try {
            const resolved = loadConfig(defaults.directory, options);
            return { config: { ...resolved, source: 'default' }, fallback: true };
        }
        catch (failure) {
            if (failure instanceof FleetError) {
                throw new FleetError(failure.code, `default workspace ${defaults.directory}: ${failure.message}`, {
                    ...failure.details,
                    default: true,
                });
            }
            throw failure;
        }
    }
}
/** Host registry without a project; enough for `fleet_hosts` in a projectless chat. */
export function loadHostsOnlyConfig(directory = process.cwd(), options = {}) {
    const paths = configPaths(directory, options);
    const registry = readHostRegistry(paths.hostsFile, false);
    const hosts = {};
    for (const [alias, entry] of Object.entries(registry.hosts)) {
        hosts[alias] = {
            alias,
            ssh: entry.ssh,
            port: entry.port ?? 22,
            root: defaultRemoteRoot(alias),
            tags: entry.tags ?? [],
            ...(entry.allow === undefined ? {} : { allow: entry.allow }),
        };
    }
    return {
        name: 'no project',
        label: 'no project',
        dir: paths.workspaceRoot,
        file: paths.hostsFile,
        hosts,
        excludes: [],
        env: {},
        shell: 'bash',
        excludeMatcher: compileExcludes([]),
        projectId: paths.projectId,
    };
}
/** Resolve the project identity. A git remote makes the identity stable across clones
 * and worktrees; a plain directory falls back to its canonical path.
 */
function workspaceRoot(cwd) {
    const absolute = path.resolve(cwd);
    try {
        const root = execFileSync('git', ['-C', absolute, 'rev-parse', '--show-toplevel'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        if (root)
            return fs.realpathSync(root);
    }
    catch {
        // Not a git checkout, or git is unavailable.
    }
    try {
        return fs.realpathSync(absolute);
    }
    catch {
        return absolute;
    }
}
function projectIdFor(root) {
    let identity = root;
    try {
        const remote = execFileSync('git', ['-C', root, 'config', '--get', 'remote.origin.url'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        if (remote)
            identity = remote.replace(/\.git$/, '');
    }
    catch {
        // A local-only checkout has no remote; the canonical path is the identity.
    }
    return crypto.createHash('sha256').update(identity).digest('hex').slice(0, 32);
}
export function defaultWorkspaceName(cwd = process.cwd()) {
    const base = path.basename(workspaceRoot(cwd));
    const normalized = base
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^[^a-z0-9]+/, '')
        .replace(/[^a-z0-9]+$/, '');
    return normalized || 'workspace';
}
export function loadConfig(cwd = process.cwd(), options = {}) {
    const explicit = options.config ?? process.env.FLEET_CONFIG;
    if (explicit)
        return loadLegacyConfig(path.resolve(cwd, explicit), options);
    const paths = configPaths(cwd, options);
    if (fs.existsSync(paths.projectFile))
        return loadSplitConfig(paths);
    const legacy = path.join(workspaceRoot(cwd), 'fleet.json');
    if (fs.existsSync(legacy))
        return loadLegacyConfig(legacy, options);
    return loadSplitConfig(paths);
}
export function loadConfigDocuments(cwd = process.cwd(), options = {}) {
    const paths = configPaths(cwd, options);
    const name = defaultWorkspaceName(paths.workspaceRoot);
    const explicit = explicitConfigPath(options);
    if (explicit) {
        const file = path.resolve(cwd, explicit);
        return documentsFromConfig(loadLegacyConfig(file), paths, file);
    }
    const legacy = legacyPath(cwd);
    if (legacy && !fs.existsSync(paths.projectFile)) {
        return documentsFromConfig(loadLegacyConfig(legacy), paths, legacy);
    }
    // An editor view: each file is validated on its own so a new project keeps the
    // existing host registry and a project can be repaired while a host is missing.
    const hosts = fs.existsSync(paths.hostsFile)
        ? readHostRegistry(paths.hostsFile, false)
        : emptyHostRegistry();
    const hasProject = fs.existsSync(paths.projectFile);
    const project = hasProject
        ? readProjectConfig(paths.projectFile, false, name)
        : Object.keys(hosts.hosts).length > 0 && !isOpenChamberInternalDirectory(paths.workspaceRoot)
            ? derivedProjectConfig(paths)
            : defaultProjectConfig(name);
    return {
        ...paths,
        hosts,
        project,
        legacy: false,
        configSource: hasProject ? 'file' : Object.keys(hosts.hosts).length > 0 ? 'derived' : 'file',
        revision: configRevision(paths),
    };
}
export function saveConfigDocuments(cwd, hosts, project, options = {}) {
    const paths = configPaths(cwd, options);
    if (options.expectedRevision !== undefined && options.expectedRevision !== configRevision(paths)) {
        throw new FleetError('config-invalid', 'the local Fleet configuration changed since it was loaded', {
            hint: 'reload the panel and apply your changes again',
        });
    }
    const hadProject = fs.existsSync(paths.projectFile);
    const registry = parseHostRegistry(hosts, paths.hostsFile);
    const parsedProject = parseProjectConfig(project, paths.projectFile, defaultWorkspaceName(cwd));
    const projectConfig = !hadProject
        && Object.keys(registry.hosts).length > 0
        && !isOpenChamberInternalDirectory(paths.workspaceRoot)
        && parsedProject.scope === undefined
        ? { ...parsedProject, scope: 'checkout' }
        : parsedProject;
    validateProjectSelection(projectConfig, registry, paths);
    compileExcludes(projectConfig.excludes);
    assertNoCrossProjectRemoval(paths, registry);
    writeJson(paths.hostsFile, registry);
    writeJson(paths.projectFile, projectConfig);
    return {
        ...paths,
        hosts: registry,
        project: projectConfig,
        legacy: false,
        configSource: 'file',
        revision: configRevision(paths),
    };
}
export function initProjectConfig(cwd, options) {
    const paths = configPaths(cwd, options);
    const alias = assertAlias(options.alias);
    const ssh = assertSshTarget(options.ssh);
    const port = options.port === undefined ? 22 : requirePort(options.port, 'port');
    const root = options.root === undefined ? undefined : assertRemoteRoot(options.root);
    const name = options.name === undefined ? defaultWorkspaceName(cwd) : assertWorkspaceName(options.name);
    const tags = options.tags === undefined ? undefined : readTags(options.tags, 'tags');
    const registry = readHostRegistry(paths.hostsFile, true);
    const registryHosts = { ...registry.hosts };
    let project;
    if (fs.existsSync(paths.projectFile)) {
        project = readProjectConfig(paths.projectFile, false, name);
    }
    else {
        const legacy = legacyPath(cwd);
        if (legacy) {
            // Migrating rather than replacing: a legacy file keeps its name, hosts,
            // roots, excludes, environment and shell until the user changes them.
            const legacyConfig = loadLegacyConfig(legacy, options, options.force === true);
            project = {
                version: CONFIG_VERSION,
                name: legacyConfig.name,
                hosts: Object.keys(legacyConfig.hosts),
                roots: Object.fromEntries(Object.entries(legacyConfig.hosts)
                    .filter(([, host]) => host.root !== defaultRemoteRoot(legacyConfig.name))
                    .map(([legacyAlias, host]) => [legacyAlias, host.root])),
                excludes: [...legacyConfig.excludes],
                env: { ...legacyConfig.env },
                shell: legacyConfig.shell,
            };
            for (const [legacyAlias, legacyHost] of Object.entries(legacyConfig.hosts)) {
                const entry = registryHosts[legacyAlias];
                const legacyPort = legacyHost.port === 22 ? undefined : legacyHost.port;
                const merged = {
                    ssh: legacyHost.ssh,
                    ...(legacyPort === undefined ? {} : { port: legacyPort }),
                    ...(legacyHost.tags.length === 0 ? {} : { tags: [...legacyHost.tags] }),
                    // A legacy file has no policy. Reusing an existing alias keeps the
                    // shared allowlist instead of silently widening it.
                    ...(entry?.allow === undefined ? {} : { allow: [...entry.allow] }),
                };
                if (!entry) {
                    registryHosts[legacyAlias] = merged;
                }
                else if (entry.ssh !== legacyHost.ssh || (entry.port ?? 22) !== legacyHost.port) {
                    if (!options.force) {
                        throw new FleetError('config-invalid', `legacy host ${JSON.stringify(legacyAlias)} conflicts with the shared registry`, {
                            file: paths.hostsFile,
                            hint: 'pass --force to rebind the shared host or resolve the registry entry first',
                        });
                    }
                    registryHosts[legacyAlias] = merged;
                }
            }
        }
        else if (options.scope !== 'name'
            && !isOpenChamberInternalDirectory(paths.workspaceRoot)
            && (options.scope === 'checkout' || Object.keys(registryHosts).length > 0)) {
            // `fleet init` on a project that was using the safe derived view must
            // persist that view, including checkout identity and default excludes.
            project = { ...derivedProjectConfig(paths), name, scope: 'checkout' };
        }
        else {
            project = defaultProjectConfig(name);
        }
    }
    if (options.scope !== undefined)
        project = { ...project, scope: options.scope };
    const existing = registryHosts[alias];
    const requested = {
        ssh,
        ...(port === 22 ? {} : { port }),
        ...(tags === undefined || tags.length === 0 ? {} : { tags: [...tags] }),
        // There is no `init --allow`; changing tags, a target or --force must not
        // erase a deliberate host policy.
        ...(existing?.allow === undefined ? {} : { allow: [...existing.allow] }),
    };
    const sameTarget = existing !== undefined && existing.ssh === ssh && (existing.port ?? 22) === port;
    if (existing && !sameTarget && !options.force) {
        throw new FleetError('config-invalid', `host ${JSON.stringify(alias)} already exists with a different SSH target`, {
            file: paths.hostsFile,
            hint: 'pass --force to replace the shared SSH target',
        });
    }
    if (!sameTarget || options.force || tags !== undefined)
        registryHosts[alias] = requested;
    const hosts = { version: CONFIG_VERSION, hosts: registryHosts };
    // Keep an existing allowlist explicit and extend it; a project that follows
    // the whole registry stays implicit. A legacy migration keeps its host list.
    const explicit = project.hosts !== undefined && project.hosts.length > 0 ? new Set(project.hosts) : null;
    explicit?.add(alias);
    const { hosts: _previousHosts, ...projectBase } = project;
    const roots = { ...project.roots };
    if (root !== undefined)
        roots[alias] = root;
    const projectConfig = {
        ...projectBase,
        name: options.name === undefined ? project.name || name : name,
        ...(explicit === null ? {} : { hosts: [...explicit] }),
        roots,
        excludes: [...project.excludes],
        env: { ...project.env },
        shell: project.shell,
    };
    validateProjectSelection(projectConfig, hosts, paths);
    compileExcludes(projectConfig.excludes);
    writeJson(paths.hostsFile, hosts);
    writeJson(paths.projectFile, projectConfig);
    return {
        ...paths,
        hosts,
        project: projectConfig,
        legacy: false,
        configSource: 'file',
        revision: configRevision(paths),
    };
}
function configRevision(paths) {
    const files = [paths.hostsFile, paths.projectFile];
    // While a legacy file is still the active view, its contents are part of the
    // revision too; otherwise a stale panel could overwrite a changed legacy file.
    if (!fs.existsSync(paths.projectFile)) {
        const legacy = path.join(paths.workspaceRoot, 'fleet.json');
        if (fs.existsSync(legacy))
            files.push(legacy);
    }
    const hash = crypto.createHash('sha256');
    for (const file of files) {
        hash.update(path.basename(file)).update('\0');
        try {
            hash.update(fs.readFileSync(file));
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
            hash.update('missing');
        }
        hash.update('\0');
    }
    return hash.digest('hex');
}
function assertNoCrossProjectRemoval(paths, next) {
    let previous;
    try {
        previous = readHostRegistry(paths.hostsFile, false);
    }
    catch {
        return;
    }
    const removed = Object.keys(previous.hosts).filter((alias) => !next.hosts[alias]);
    if (removed.length === 0)
        return;
    const directory = path.dirname(paths.projectFile);
    let entries;
    try {
        entries = fs.readdirSync(directory);
    }
    catch {
        return;
    }
    for (const name of entries) {
        if (!name.endsWith('.json') || path.join(directory, name) === paths.projectFile)
            continue;
        try {
            const other = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
            // An implicit allowlist follows the registry by design; only an explicit
            // alias or a root override is a reference that removal would break.
            const selected = Array.isArray(other.hosts) ? other.hosts : [];
            const roots = other.roots !== null && typeof other.roots === 'object' && !Array.isArray(other.roots)
                ? Object.keys(other.roots)
                : [];
            const used = removed.find((alias) => selected.includes(alias) || roots.includes(alias));
            if (used) {
                throw new FleetError('config-invalid', `host ${JSON.stringify(used)} is still referenced by another project`, {
                    hint: 'remove the alias and its root override from that project before deleting it from the shared registry',
                });
            }
        }
        catch (error) {
            if (error instanceof FleetError)
                throw error;
            // A different project's malformed file does not block this project's edit.
        }
    }
}
export function loadHostRegistry(file) {
    return readHostRegistry(file, false);
}
export function loadProjectConfig(file, nameFallback = 'workspace') {
    return readProjectConfig(file, false, nameFallback);
}
function selectedAliases(project, registry) {
    const candidates = project.hosts ?? Object.keys(registry.hosts);
    const requires = project.requires ?? [];
    return candidates.filter((alias) => {
        const entry = registry.hosts[alias];
        if (!entry)
            return false;
        return requires.every((tag) => (entry.tags ?? []).includes(tag));
    });
}
function derivedWorkspaceName(paths) {
    const base = defaultWorkspaceName(paths.workspaceRoot).slice(0, 48);
    const digest = crypto
        .createHash('sha256')
        .update(`${paths.projectId}\0${path.resolve(paths.workspaceRoot)}`)
        .digest('hex')
        .slice(0, 10);
    return `${base}-${digest}`;
}
/** A project that was never explicitly configured still gets safe, isolated defaults. */
function derivedProjectConfig(paths) {
    return {
        version: CONFIG_VERSION,
        name: derivedWorkspaceName(paths),
        roots: {},
        excludes: ['.git', '.direnv/', 'result*'],
        env: {},
        shell: 'bash',
    };
}
function loadSplitConfig(paths) {
    const registry = readHostRegistry(paths.hostsFile, false);
    const explicit = fs.existsSync(paths.projectFile);
    const project = explicit
        ? readProjectConfig(paths.projectFile, false, defaultWorkspaceName(paths.workspaceRoot))
        : isOpenChamberInternalDirectory(paths.workspaceRoot)
            ? readProjectConfig(paths.projectFile, false, defaultWorkspaceName(paths.workspaceRoot))
            : derivedProjectConfig(paths);
    validateProjectSelection(project, registry, paths);
    const scoped = project.scope === 'checkout';
    const workspaceName = scoped ? derivedWorkspaceName(paths) : project.name;
    const hosts = {};
    for (const alias of selectedAliases(project, registry)) {
        const entry = registry.hosts[alias];
        const configuredRoot = project.roots[alias];
        const root = configuredRoot === undefined
            ? defaultRemoteRoot(workspaceName)
            : scoped
                // A checkout-scoped project shares settings, never a replica root.
                // An explicit root is a base directory; the derived identity is
                // appended so two clones cannot claim the same tree.
                ? `${configuredRoot.replace(/\/+$/, '')}/${workspaceName}`
                : configuredRoot;
        hosts[alias] = {
            alias,
            ssh: entry.ssh,
            port: entry.port ?? 22,
            root,
            tags: entry.tags ?? [],
            ...(entry.allow === undefined ? {} : { allow: entry.allow }),
        };
    }
    return {
        name: workspaceName,
        label: scoped || !explicit ? defaultWorkspaceName(paths.workspaceRoot) : project.name,
        dir: paths.workspaceRoot,
        file: paths.projectFile,
        hosts,
        excludes: project.excludes,
        env: project.env,
        shell: project.shell,
        excludeMatcher: compileExcludes(project.excludes),
        projectId: paths.projectId,
        source: explicit ? 'project' : 'derived',
    };
}
function loadLegacyConfig(file, options = {}, allowConflict = false) {
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new FleetError('config-invalid', `fleet.json is not valid JSON: ${reason}`, { file });
    }
    const top = asRecord(raw, 'fleet.json');
    rejectUnknown(top, LEGACY_KEYS, 'top-level');
    const name = assertWorkspaceName(requireString(top, 'name', 'top-level'));
    const dir = path.dirname(file);
    const hostsRaw = asRecord(top.hosts, 'hosts');
    const aliases = Object.keys(hostsRaw);
    if (aliases.length === 0)
        throw new FleetError('config-invalid', 'hosts must declare at least one host');
    // A legacy workspace file does not carry an allowlist. When a shared
    // registry exists, its policy still applies to aliases it knows about.
    const registryFile = path.join(configDirOf(options), 'hosts.json');
    const registry = fs.existsSync(registryFile)
        ? readHostRegistry(registryFile, false)
        : emptyHostRegistry();
    const hosts = {};
    for (const alias of aliases) {
        assertAlias(alias);
        const entry = asRecord(hostsRaw[alias], `hosts.${alias}`);
        rejectUnknown(entry, LEGACY_HOST_KEYS, `hosts.${alias}`);
        const ssh = assertSshTarget(requireString(entry, 'ssh', `hosts.${alias}`));
        const port = entry.port === undefined ? 22 : requirePort(entry.port, `hosts.${alias}.port`);
        const root = entry.root === undefined
            ? defaultRemoteRoot(name)
            : assertRemoteRoot(requireString(entry, 'root', `hosts.${alias}`));
        const tags = readTags(entry.tags, `hosts.${alias}.tags`);
        const registered = registry.hosts[alias];
        if (registered && (registered.ssh !== ssh || (registered.port ?? 22) !== port) && !allowConflict) {
            throw new FleetError('config-invalid', `legacy host ${JSON.stringify(alias)} conflicts with the shared registry target`, {
                file,
                hint: 'run `fleet init --force` to migrate the legacy target, or align the shared registry entry first',
            });
        }
        const allow = registered?.allow;
        hosts[alias] = {
            alias,
            ssh,
            port,
            root,
            tags,
            ...(allow === undefined ? {} : { allow: [...allow] }),
        };
    }
    return {
        name,
        label: name,
        dir,
        file,
        hosts,
        excludes: readExcludes(top),
        env: readEnv(top),
        shell: readShell(top),
        excludeMatcher: compileExcludes(readExcludes(top)),
        source: 'legacy',
    };
}
function readHostRegistry(file, missingEmpty) {
    if (!fs.existsSync(file)) {
        if (missingEmpty)
            return emptyHostRegistry();
        throw new FleetError('config-missing', `no Fleet host registry at ${file}`, {
            file,
            hint: 'run `fleet init` in the project to create it',
        });
    }
    return parseHostRegistry(readJson(file), file);
}
function readProjectConfig(file, missingEmpty, nameFallback) {
    if (!fs.existsSync(file)) {
        if (missingEmpty)
            return defaultProjectConfig(nameFallback);
        throw new FleetError('config-missing', `no Fleet project configuration at ${file}`, {
            file,
            hint: 'run `fleet init` in the project to create it',
        });
    }
    return parseProjectConfig(readJson(file), file, nameFallback);
}
function parseHostRegistry(value, file) {
    const top = asRecord(value, 'hosts.json');
    rejectUnknown(top, HOST_REGISTRY_KEYS, 'hosts.json');
    const version = top.version === undefined ? CONFIG_VERSION : requireConfigVersion(top.version, 'hosts.json.version');
    const hostsRaw = asRecord(top.hosts, 'hosts');
    const hosts = {};
    for (const alias of Object.keys(hostsRaw)) {
        assertAlias(alias);
        const entry = asRecord(hostsRaw[alias], `hosts.${alias}`);
        rejectUnknown(entry, HOST_ENTRY_KEYS, `hosts.${alias}`);
        const ssh = assertSshTarget(requireString(entry, 'ssh', `hosts.${alias}`));
        const port = entry.port === undefined ? undefined : requirePort(entry.port, `hosts.${alias}.port`);
        const tags = readTags(entry.tags, `hosts.${alias}.tags`);
        const allow = readAllow(entry.allow, `hosts.${alias}.allow`);
        hosts[alias] = {
            ssh,
            ...(port === undefined ? {} : { port }),
            ...(tags.length === 0 ? {} : { tags }),
            // An explicit empty array denies every operation; an absent key keeps the
            // compatibility default of allowing all operations.
            ...(allow === undefined ? {} : { allow }),
        };
    }
    if (Object.keys(hosts).length === 0) {
        throw new FleetError('config-invalid', `${file} must declare at least one host`);
    }
    return { version, hosts };
}
function parseProjectConfig(value, file, nameFallback) {
    const top = asRecord(value, 'workspaces.json');
    rejectUnknown(top, PROJECT_KEYS, 'project configuration');
    const version = top.version === undefined ? CONFIG_VERSION : requireConfigVersion(top.version, 'project.version');
    const name = top.name === undefined
        ? nameFallback
        : assertWorkspaceName(requireString(top, 'name', 'project'));
    if (top.scope !== undefined && top.scope !== 'name' && top.scope !== 'checkout') {
        throw new FleetError('config-invalid', `${file} has an invalid project.scope`);
    }
    // Preserve an explicit `name` scope so a later panel save cannot silently
    // turn a shared workspace into a per-checkout one.
    const scope = top.scope === 'checkout' || top.scope === 'name' ? top.scope : undefined;
    const hosts = top.hosts === undefined
        ? undefined
        : requireStringArray(top.hosts, 'project.hosts');
    for (const alias of hosts ?? [])
        assertAlias(alias);
    const requires = top.requires === undefined
        ? []
        : requireStringArray(top.requires, 'project.requires');
    for (const tag of requires)
        assertTag(tag);
    const roots = {};
    if (top.roots !== undefined) {
        const raw = asRecord(top.roots, 'project.roots');
        for (const [alias, root] of Object.entries(raw)) {
            assertAlias(alias);
            roots[alias] = assertRemoteRoot(requireString({ root }, 'root', 'project.roots'));
        }
    }
    return {
        version,
        name,
        ...(scope === undefined ? {} : { scope }),
        ...(hosts === undefined ? {} : { hosts }),
        ...(requires.length === 0 ? {} : { requires }),
        roots,
        excludes: readExcludes(top),
        env: readEnv(top),
        shell: readShell(top),
    };
}
function validateProjectSelection(project, registry, paths) {
    const requires = project.requires ?? [];
    const explicit = project.hosts;
    if (explicit !== undefined && explicit.length === 0) {
        throw new FleetError('config-invalid', 'project.hosts is an empty allowlist', {
            file: paths.projectFile,
            hint: 'omit project.hosts to use every host in the global registry',
        });
    }
    if (explicit !== undefined && new Set(explicit).size !== explicit.length) {
        throw new FleetError('config-invalid', 'project.hosts contains duplicate aliases', {
            file: paths.projectFile,
        });
    }
    if (new Set(requires).size !== requires.length) {
        throw new FleetError('config-invalid', 'project.requires contains duplicate tags', {
            file: paths.projectFile,
        });
    }
    const missing = (explicit ?? []).filter((alias) => !registry.hosts[alias]);
    if (missing.length > 0) {
        throw new FleetError('config-invalid', `unknown host alias(es): ${missing.join(', ')}`, {
            file: paths.hostsFile,
            hint: 'define the host in the global registry or remove it from the project',
        });
    }
    const mismatched = (explicit ?? []).flatMap((alias) => {
        const tags = registry.hosts[alias]?.tags ?? [];
        const unsatisfied = requires.filter((tag) => !tags.includes(tag));
        return unsatisfied.length === 0 ? [] : [{ alias, unsatisfied }];
    });
    if (mismatched.length > 0) {
        const detail = mismatched
            .map(({ alias, unsatisfied }) => `${alias} lacks ${unsatisfied.join(', ')}`)
            .join('; ');
        throw new FleetError('config-invalid', `selected host(s) do not satisfy project.requires: ${detail}`, {
            file: paths.hostsFile,
            hint: 'fix the host tags or remove the host from project.hosts',
        });
    }
    const unknownRoots = Object.keys(project.roots).filter((alias) => !registry.hosts[alias]);
    if (unknownRoots.length > 0) {
        throw new FleetError('config-invalid', `project.roots names unknown host(s): ${unknownRoots.join(', ')}`, {
            file: paths.hostsFile,
            hint: 'remove the root override or define the host in the global registry',
        });
    }
    const selected = selectedAliases(project, registry);
    const extraRoots = Object.keys(project.roots).filter((alias) => !selected.includes(alias));
    if (extraRoots.length > 0) {
        throw new FleetError('config-invalid', `roots for unselected host(s): ${extraRoots.join(', ')}`, {
            file: paths.projectFile,
            hint: 'remove the root override or select the host explicitly',
        });
    }
    if (selected.length === 0) {
        throw new FleetError('config-invalid', requires.length > 0
            ? `no configured host satisfies requires: ${requires.join(', ')}`
            : 'the host registry has no selectable hosts', {
            file: paths.hostsFile,
            hint: requires.length > 0
                ? 'add a host with these tags or relax project.requires'
                : 'add a host to the global registry',
        });
    }
}
function documentsFromConfig(config, paths, sourceFile) {
    const hosts = {};
    const roots = {};
    for (const [alias, host] of Object.entries(config.hosts)) {
        hosts[alias] = {
            ssh: host.ssh,
            ...(host.port === 22 ? {} : { port: host.port }),
            ...(host.tags.length === 0 ? {} : { tags: [...host.tags] }),
            ...(host.allow === undefined ? {} : { allow: [...host.allow] }),
        };
        if (host.root !== defaultRemoteRoot(config.name))
            roots[alias] = host.root;
    }
    return {
        ...paths,
        hosts: { version: CONFIG_VERSION, hosts },
        project: {
            version: CONFIG_VERSION,
            name: config.name,
            hosts: Object.keys(config.hosts),
            roots,
            excludes: [...config.excludes],
            env: { ...config.env },
            shell: config.shell,
        },
        legacy: config.source === 'legacy' || (sourceFile !== null && path.basename(sourceFile) === 'fleet.json'),
        configSource: config.source === 'legacy' ? 'legacy' : 'file',
        revision: configRevision(paths),
    };
}
function emptyHostRegistry() {
    return { version: CONFIG_VERSION, hosts: {} };
}
function defaultProjectConfig(name) {
    return {
        version: CONFIG_VERSION,
        name,
        roots: {},
        excludes: [],
        env: {},
        shell: 'bash',
    };
}
function explicitConfigPath(options) {
    return options.config ?? process.env.FLEET_CONFIG ?? null;
}
function legacyPath(cwd) {
    const file = path.join(workspaceRoot(cwd), 'fleet.json');
    return fs.existsSync(file) ? file : null;
}
function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new FleetError('config-invalid', `${file} is not valid JSON: ${reason}`, { file });
    }
}
function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
    fs.chmodSync(file, 0o600);
}
function readExcludes(top) {
    return top.excludes === undefined ? [] : requireStringArray(top.excludes, 'excludes');
}
function readAllow(value, where) {
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value))
        throw new FleetError('config-invalid', `${where} must be an array`);
    const allow = value.map((entry) => {
        if (typeof entry !== 'string' || !HOST_OPERATIONS.includes(entry)) {
            throw new FleetError('config-invalid', `${where} entries must be one of ${HOST_OPERATIONS.join(', ')}`);
        }
        return entry;
    });
    if (new Set(allow).size !== allow.length) {
        throw new FleetError('config-invalid', `${where} must not contain duplicates`);
    }
    return allow;
}
function readTags(value, where) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value))
        throw new FleetError('config-invalid', `${where} must be an array`);
    if (value.length > 20)
        throw new FleetError('config-invalid', `${where} must contain at most 20 tags`);
    const tags = value.map((entry) => {
        if (typeof entry !== 'string')
            throw new FleetError('config-invalid', `${where} entries must be strings`);
        return assertTag(entry);
    });
    if (new Set(tags).size !== tags.length)
        throw new FleetError('config-invalid', `${where} must not contain duplicates`);
    return tags;
}
function readEnv(top) {
    const env = {};
    if (top.env !== undefined) {
        const rawEnv = asRecord(top.env, 'env');
        for (const [key, value] of Object.entries(rawEnv)) {
            if (typeof value !== 'string')
                throw new FleetError('config-invalid', `env.${key} must be a string`);
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
                throw new FleetError('config-invalid', `env.${key} is not a valid variable name`);
            }
            env[key] = value;
        }
    }
    return env;
}
function readShell(top) {
    const shellValue = top.shell === undefined ? 'bash' : requireString(top, 'shell', 'top-level');
    if (!SHELLS.has(shellValue)) {
        throw new FleetError('config-invalid', `shell ${JSON.stringify(shellValue)} must be one of ${[...SHELLS].join(', ')}`);
    }
    return shellValue;
}
function requireConfigVersion(value, where) {
    if (value !== CONFIG_VERSION) {
        throw new FleetError('config-invalid', `${where} must be ${CONFIG_VERSION}`);
    }
    return CONFIG_VERSION;
}
function asRecord(value, where) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new FleetError('config-invalid', `${where} must be an object`);
    }
    return value;
}
function rejectUnknown(value, allowed, where) {
    const unknown = Object.keys(value).filter((key) => !allowed.has(key));
    if (unknown.length > 0) {
        throw new FleetError('config-invalid', `${where} has unknown key(s): ${unknown.join(', ')}`);
    }
}
function requireString(value, key, where) {
    const entry = value[key];
    if (typeof entry !== 'string' || entry.length === 0) {
        throw new FleetError('config-invalid', `${where}.${key} must be a non-empty string`);
    }
    return entry;
}
function requirePort(value, where) {
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
        throw new FleetError('config-invalid', `${where} must be an integer between 1 and 65535`);
    }
    return value;
}
function requireStringArray(value, where) {
    if (!Array.isArray(value))
        throw new FleetError('config-invalid', `${where} must be an array`);
    return value.map((entry, index) => {
        if (typeof entry !== 'string' || entry.length === 0) {
            throw new FleetError('config-invalid', `${where}[${index}] must be a non-empty string`);
        }
        return entry;
    });
}
/**
 * Compile the supported rsync exclude subset.
 *
 * - `name` matches that basename at any depth;
 * - `name/` matches directories of that name at any depth;
 * - `/name` is anchored to the workspace root;
 * - `dir/**` matches everything below a root-level `dir`;
 * - `**\/name/` matches that directory at any depth.
 *
 * A directory match also excludes everything below it, which is how rsync behaves.
 */
export function compileExcludes(patterns) {
    const rules = patterns.map(compilePattern);
    return {
        matches(relPath, isDir) {
            const clean = relPath.replace(/\/+$/, '');
            if (clean === '' || clean === '.')
                return false;
            const segments = clean.split('/');
            for (let index = 1; index <= segments.length; index += 1) {
                const prefix = segments.slice(0, index).join('/');
                const prefixIsDir = index < segments.length ? true : isDir;
                for (const rule of rules) {
                    if (rule.matches(prefix, prefixIsDir))
                        return true;
                }
            }
            return false;
        },
    };
}
function compilePattern(pattern) {
    if (typeof pattern !== 'string' || pattern.length === 0) {
        throw new FleetError('config-invalid', 'exclude patterns must be non-empty strings');
    }
    if (pattern.includes('\0'))
        throw new FleetError('config-invalid', 'exclude patterns must not contain NUL');
    const segments = pattern.split('/');
    if (segments.includes('..')) {
        throw new FleetError('config-invalid', `exclude ${JSON.stringify(pattern)} must not contain ".."`);
    }
    const anchored = pattern.startsWith('/');
    const dirOnly = pattern.endsWith('/');
    const body = pattern.replace(/^\/+/, '').replace(/\/+$/, '');
    if (body.length === 0)
        throw new FleetError('config-invalid', `exclude ${JSON.stringify(pattern)} is empty`);
    const normalized = body.replace(/^(\*\*\/)+/, '');
    const hasSlash = normalized.includes('/');
    const expression = globToRegExp(normalized);
    const matcher = anchored
        ? new RegExp(`^${expression}$`)
        : new RegExp(hasSlash ? `(^|.*/)${expression}$` : `^${expression}$`);
    return {
        pattern,
        matches(relPath, isDir) {
            if (dirOnly && !isDir)
                return false;
            const subject = anchored || hasSlash ? relPath : relPath.split('/').pop() ?? relPath;
            return matcher.test(subject);
        },
    };
}
function globToRegExp(glob) {
    let out = '';
    for (let index = 0; index < glob.length; index += 1) {
        const char = glob[index];
        if (char === '*') {
            if (glob[index + 1] === '*') {
                out += '.*';
                index += 1;
            }
            else {
                out += '[^/]*';
            }
        }
        else if (char === '?') {
            out += '[^/]';
        }
        else if ('\\^$.|+()[]{}'.includes(char ?? '')) {
            out += `\\${String(char)}`;
        }
        else {
            out += String(char);
        }
    }
    return out;
}
//# sourceMappingURL=config.js.map