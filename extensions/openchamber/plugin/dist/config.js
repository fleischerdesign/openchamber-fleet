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
import { assertAlias, assertRemoteRoot, assertSshTarget, assertWorkspaceName } from './paths.js';
const LEGACY_KEYS = new Set(['name', 'hosts', 'excludes', 'env', 'shell']);
const LEGACY_HOST_KEYS = new Set(['ssh', 'port', 'root']);
const HOST_REGISTRY_KEYS = new Set(['version', 'hosts']);
const HOST_ENTRY_KEYS = new Set(['ssh', 'port']);
const PROJECT_KEYS = new Set(['version', 'name', 'hosts', 'roots', 'excludes', 'env', 'shell']);
const SHELLS = new Set(['bash', 'sh', 'dash', 'zsh']);
const CONFIG_VERSION = 1;
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
        return loadLegacyConfig(path.resolve(cwd, explicit));
    const paths = configPaths(cwd, options);
    if (fs.existsSync(paths.projectFile))
        return loadSplitConfig(paths);
    const legacy = path.join(workspaceRoot(cwd), 'fleet.json');
    if (fs.existsSync(legacy))
        return loadLegacyConfig(legacy);
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
    const project = fs.existsSync(paths.projectFile)
        ? readProjectConfig(paths.projectFile, false, name)
        : defaultProjectConfig(name);
    return { ...paths, hosts, project, legacy: false };
}
export function saveConfigDocuments(cwd, hosts, project, options = {}) {
    const paths = configPaths(cwd, options);
    const registry = parseHostRegistry(hosts, paths.hostsFile);
    const projectConfig = parseProjectConfig(project, paths.projectFile, defaultWorkspaceName(cwd));
    validateProjectSelection(projectConfig, registry, paths);
    writeJson(paths.hostsFile, registry);
    writeJson(paths.projectFile, projectConfig);
    return {
        ...paths,
        hosts: registry,
        project: projectConfig,
        legacy: false,
    };
}
export function initProjectConfig(cwd, options) {
    const paths = configPaths(cwd, options);
    const alias = assertAlias(options.alias);
    const ssh = assertSshTarget(options.ssh);
    const port = options.port === undefined ? 22 : requirePort(options.port, 'port');
    const root = options.root === undefined ? undefined : assertRemoteRoot(options.root);
    const name = options.name === undefined ? defaultWorkspaceName(cwd) : assertWorkspaceName(options.name);
    const registry = readHostRegistry(paths.hostsFile, true);
    const existing = registry.hosts[alias];
    if (existing && !options.force) {
        throw new FleetError('config-invalid', `host ${JSON.stringify(alias)} already exists`, {
            file: paths.hostsFile,
            hint: 'pass --force to replace the SSH target',
        });
    }
    const hosts = {
        version: CONFIG_VERSION,
        hosts: { ...registry.hosts, [alias]: port === 22 ? { ssh } : { ssh, port } },
    };
    const project = readProjectConfig(paths.projectFile, true, name);
    const selected = new Set(project.hosts);
    selected.add(alias);
    const roots = { ...project.roots };
    if (root !== undefined)
        roots[alias] = root;
    const projectConfig = {
        version: CONFIG_VERSION,
        name: options.name === undefined ? project.name || name : name,
        hosts: [...selected],
        roots,
        excludes: [...project.excludes],
        env: { ...project.env },
        shell: project.shell,
    };
    validateProjectSelection(projectConfig, hosts, paths);
    writeJson(paths.hostsFile, hosts);
    writeJson(paths.projectFile, projectConfig);
    return {
        ...paths,
        hosts,
        project: projectConfig,
        legacy: false,
    };
}
export function loadHostRegistry(file) {
    return readHostRegistry(file, false);
}
export function loadProjectConfig(file, nameFallback = 'workspace') {
    return readProjectConfig(file, false, nameFallback);
}
function loadSplitConfig(paths) {
    const registry = readHostRegistry(paths.hostsFile, false);
    const project = readProjectConfig(paths.projectFile, false, defaultWorkspaceName(paths.workspaceRoot));
    validateProjectSelection(project, registry, paths);
    const hosts = {};
    for (const alias of project.hosts) {
        const entry = registry.hosts[alias];
        const root = project.roots[alias] ?? defaultRemoteRoot(project.name);
        hosts[alias] = { alias, ssh: entry.ssh, port: entry.port ?? 22, root };
    }
    return {
        name: project.name,
        dir: paths.workspaceRoot,
        file: paths.projectFile,
        hosts,
        excludes: project.excludes,
        env: project.env,
        shell: project.shell,
        excludeMatcher: compileExcludes(project.excludes),
        projectId: paths.projectId,
        source: 'project',
    };
}
function loadLegacyConfig(file) {
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
        hosts[alias] = { alias, ssh, port, root };
    }
    return {
        name,
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
        hosts[alias] = port === undefined ? { ssh } : { ssh, port };
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
    const hosts = top.hosts === undefined
        ? []
        : requireStringArray(top.hosts, 'project.hosts');
    for (const alias of hosts)
        assertAlias(alias);
    const roots = {};
    if (top.roots !== undefined) {
        const raw = asRecord(top.roots, 'project.roots');
        for (const [alias, root] of Object.entries(raw)) {
            assertAlias(alias);
            roots[alias] = assertRemoteRoot(requireString({ root }, 'root', 'project.roots'));
        }
    }
    const unknownRoots = Object.keys(roots).filter((alias) => !hosts.includes(alias));
    if (unknownRoots.length > 0) {
        throw new FleetError('config-invalid', `${file} has roots for unselected host(s): ${unknownRoots.join(', ')}`);
    }
    return {
        version,
        name,
        hosts,
        roots,
        excludes: readExcludes(top),
        env: readEnv(top),
        shell: readShell(top),
    };
}
function validateProjectSelection(project, registry, paths) {
    if (project.hosts.length === 0) {
        throw new FleetError('config-invalid', 'the project must select at least one host', {
            file: paths.projectFile,
            hint: 'add a host alias to project.hosts and define it in the host registry',
        });
    }
    const missing = project.hosts.filter((alias) => !registry.hosts[alias]);
    if (missing.length > 0) {
        throw new FleetError('config-invalid', `unknown host alias(es): ${missing.join(', ')}`, {
            file: paths.hostsFile,
            hint: 'define the host in the global registry or remove it from the project',
        });
    }
}
function documentsFromConfig(config, paths, sourceFile) {
    const hosts = {};
    const roots = {};
    for (const [alias, host] of Object.entries(config.hosts)) {
        hosts[alias] = host.port === 22 ? { ssh: host.ssh } : { ssh: host.ssh, port: host.port };
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
    };
}
function emptyHostRegistry() {
    return { version: CONFIG_VERSION, hosts: {} };
}
function defaultProjectConfig(name) {
    return {
        version: CONFIG_VERSION,
        name,
        hosts: [],
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