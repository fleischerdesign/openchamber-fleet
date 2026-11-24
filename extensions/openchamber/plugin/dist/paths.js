/** Path validation and shell quoting. Nothing crosses the SSH boundary without passing here. */
import path from 'node:path';
import { FleetError } from './errors.js';
const ALIAS = /^[A-Za-z0-9._-]+$/;
const SSH_TARGET = /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$/;
const NAME = /^[a-z0-9][a-z0-9._-]*$/;
const TAG = /^[a-z0-9][a-z0-9._-]*$/;
export function assertAlias(value) {
    if (!ALIAS.test(value)) {
        throw new FleetError('config-invalid', `host alias ${JSON.stringify(value)} must match ${String(ALIAS)}`);
    }
    return value;
}
export function assertSshTarget(value) {
    if (!SSH_TARGET.test(value)) {
        throw new FleetError('config-invalid', `ssh target ${JSON.stringify(value)} must be user@host`);
    }
    return value;
}
export function assertWorkspaceName(value) {
    if (!NAME.test(value)) {
        throw new FleetError('config-invalid', `workspace name ${JSON.stringify(value)} must match ${String(NAME)}`);
    }
    return value;
}
export function assertTag(value) {
    if (value.length > 32 || !TAG.test(value)) {
        throw new FleetError('config-invalid', `host tag ${JSON.stringify(value)} must match ${String(TAG)} and be at most 32 characters`);
    }
    return value;
}
/** Validate a path that will be sent to the node; returns the normalized POSIX form. */
export function assertRelativePath(value) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new FleetError('usage', 'path must be a non-empty string');
    }
    if (value.includes('\0'))
        throw new FleetError('usage', 'path must not contain NUL');
    if (value.startsWith('/'))
        throw new FleetError('usage', `path ${JSON.stringify(value)} must be relative`);
    const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
    if (normalized === '.' || normalized === '')
        throw new FleetError('usage', 'path must not be empty');
    if (normalized === '..' || normalized.startsWith('../')) {
        throw new FleetError('usage', `path ${JSON.stringify(value)} must not escape the replica`);
    }
    if (normalized.includes('/../')) {
        throw new FleetError('usage', `path ${JSON.stringify(value)} must not escape the replica`);
    }
    return normalized;
}
/** Validate a remote root: absolute, or `~/…`. */
export function assertRemoteRoot(value) {
    if (!value.startsWith('/') && !value.startsWith('~/')) {
        throw new FleetError('config-invalid', `root ${JSON.stringify(value)} must be absolute or start with "~/"`);
    }
    if (value.includes('\0'))
        throw new FleetError('config-invalid', 'root must not contain NUL');
    return value.replace(/\/+$/, '') || '/';
}
/** True when `candidate` is inside `root` after lexical normalization. */
export function isInside(root, candidate) {
    const relative = path.posix.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.posix.isAbsolute(relative));
}
/** POSIX single-quote quoting. The only quoting the remote script relies on. */
export function quoteShell(value) {
    return "'" + value.replaceAll("'", "'\\''") + "'";
}
export function quoteArgv(argv) {
    return argv.map(quoteShell).join(' ');
}
export function slug(value) {
    return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
}
//# sourceMappingURL=paths.js.map