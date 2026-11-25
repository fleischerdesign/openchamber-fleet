/** Small, portable file primitives for the job spool. No dependencies. */
import fs from 'node:fs';
import path from 'node:path';
export function ensurePrivateDir(directory) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    let stat;
    try {
        stat = fs.lstatSync(directory);
    }
    catch (error) {
        throw new Error(`cannot inspect state directory ${directory}: ${messageOf(error)}`);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error(`state directory ${directory} is not a real directory`);
    }
    if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
        throw new Error(`state directory ${directory} is owned by another user`);
    }
    try {
        fs.chmodSync(directory, 0o700);
    }
    catch {
        // Windows does not implement POSIX modes.
    }
}
export function readJsonFile(file) {
    let stat;
    try {
        stat = fs.lstatSync(file);
    }
    catch (error) {
        if (isMissing(error))
            return null;
        throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink())
        return null;
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    catch (error) {
        if (isMissing(error))
            return null;
        return null;
    }
}
export function writeJsonAtomic(file, value, mode = 0o600) {
    const directory = path.dirname(file);
    ensurePrivateDir(directory);
    const temporary = path.join(directory, `.${path.basename(file)}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`);
    const text = `${JSON.stringify(value, null, 2)}\n`;
    fs.writeFileSync(temporary, text, { mode });
    try {
        fs.renameSync(temporary, file);
    }
    catch (error) {
        const code = error.code;
        if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES') {
            fs.rmSync(temporary, { force: true });
            throw error;
        }
        fs.rmSync(file, { force: true });
        fs.renameSync(temporary, file);
    }
    try {
        fs.chmodSync(file, mode);
    }
    catch {
        // Windows does not implement POSIX modes.
    }
}
export function removeFile(file) {
    try {
        fs.rmSync(file, { force: true });
        return true;
    }
    catch (error) {
        if (isMissing(error))
            return false;
        throw error;
    }
}
export function listJsonFiles(directory) {
    let entries;
    try {
        entries = fs.readdirSync(directory);
    }
    catch (error) {
        if (isMissing(error))
            return [];
        throw error;
    }
    return entries
        .filter((entry) => entry.endsWith('.json') && !entry.startsWith('.'))
        .sort();
}
export function isMissing(error) {
    return error.code === 'ENOENT';
}
export function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=io.js.map