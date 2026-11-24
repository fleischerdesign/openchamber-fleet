/** `fleet.json` loading, strict validation, and the exclude matcher shared with rsync. */
import fs from 'node:fs';
import path from 'node:path';
import { FleetError } from './errors.js';
import { assertAlias, assertRemoteRoot, assertSshTarget, assertWorkspaceName } from './paths.js';
const TOP_KEYS = new Set(['name', 'hosts', 'excludes', 'env', 'shell']);
const HOST_KEYS = new Set(['ssh', 'port', 'root']);
const SHELLS = new Set(['bash', 'sh', 'dash', 'zsh']);
export function defaultRemoteRoot(name) {
    return `~/.cache/openchamber-fleet/${name}`;
}
export function loadConfig(cwd = process.cwd(), options = {}) {
    const file = options.config ? path.resolve(cwd, options.config) : path.join(cwd, 'fleet.json');
    if (!fs.existsSync(file)) {
        throw new FleetError('config-missing', `no fleet.json in ${cwd}`, { file });
    }
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new FleetError('config-invalid', `fleet.json is not valid JSON: ${reason}`, { file });
    }
    const top = asRecord(raw, 'fleet.json');
    rejectUnknown(top, TOP_KEYS, 'top-level');
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
        rejectUnknown(entry, HOST_KEYS, `hosts.${alias}`);
        const ssh = assertSshTarget(requireString(entry, 'ssh', `hosts.${alias}`));
        const port = entry.port === undefined ? 22 : requirePort(entry.port, `hosts.${alias}.port`);
        const root = entry.root === undefined
            ? defaultRemoteRoot(name)
            : assertRemoteRoot(requireString(entry, 'root', `hosts.${alias}`));
        hosts[alias] = { alias, ssh, port, root };
    }
    const excludes = top.excludes === undefined ? [] : requireStringArray(top.excludes, 'excludes');
    const excludeMatcher = compileExcludes(excludes);
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
    const shellValue = top.shell === undefined ? 'bash' : requireString(top, 'shell', 'top-level');
    if (!SHELLS.has(shellValue)) {
        throw new FleetError('config-invalid', `shell ${JSON.stringify(shellValue)} must be one of ${[...SHELLS].join(', ')}`);
    }
    const shell = shellValue;
    return { name, dir, file, hosts, excludes, env, shell, excludeMatcher };
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
    const normalized = body.replace(/^(\*\*\/)+/, "");
    const hasSlash = normalized.includes("/");
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