/** Canonical tree walk and the metadata revision. */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FleetError } from './errors.js';

export interface ManifestEntry {
  path: string;
  type: 'file' | 'dir' | 'symlink';
  mode: number;
  size: number;
  mtimeMs: number;
  link?: string;
}

export interface ExcludeMatcher {
  matches(relPath: string, isDir: boolean): boolean;
}

/** Walk a tree without following symlinks, skipping excluded paths. */
export function walkTree(root: string, excludes: ExcludeMatcher): ManifestEntry[] {
  if (!fs.existsSync(root)) throw new FleetError('config-invalid', `workspace ${root} does not exist`);
  const entries: ManifestEntry[] = [];
  const visit = (relative: string): void => {
    const absolute = relative === '' ? root : path.join(root, relative);
    let children: fs.Dirent[];
    try {
      children = fs.readdirSync(absolute, { withFileTypes: true });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new FleetError('internal', `cannot read ${absolute}: ${reason}`);
    }
    children.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
    for (const child of children) {
      const childRelative = relative === '' ? child.name : `${relative}/${child.name}`;
      const stats = fs.lstatSync(path.join(root, childRelative));
      const isDir = stats.isDirectory();
      if (excludes.matches(childRelative, isDir)) continue;
      if (stats.isSymbolicLink()) {
        entries.push({
          path: childRelative,
          type: 'symlink',
          mode: stats.mode & 0o7777,
          size: 0,
          mtimeMs: Math.trunc(stats.mtimeMs),
          link: fs.readlinkSync(path.join(root, childRelative)),
        });
      } else if (isDir) {
        entries.push({
          path: childRelative,
          type: 'dir',
          mode: stats.mode & 0o7777,
          size: 0,
          mtimeMs: Math.trunc(stats.mtimeMs),
        });
        visit(childRelative);
      } else if (stats.isFile()) {
        entries.push({
          path: childRelative,
          type: 'file',
          mode: stats.mode & 0o7777,
          size: stats.size,
          mtimeMs: Math.trunc(stats.mtimeMs),
        });
      }
      // FIFOs, sockets and device nodes are not replicated; rsync would skip them too.
    }
  };
  visit('');
  return entries;
}

/**
 * SHA-256 over the manifest. Metadata only: path, type, mode, size, mtime, link target.
 * Content equality is a separate operation (`sync --verify --content`).
 */
export function revisionOf(entries: readonly ManifestEntry[]): string {
  const hash = crypto.createHash('sha256');
  for (const entry of entries) {
    hash.update(entry.type);
    hash.update('\0');
    hash.update(entry.path);
    hash.update('\0');
    hash.update(entry.mode.toString(8));
    hash.update('\0');
    hash.update(String(entry.size));
    hash.update('\0');
    hash.update(String(entry.mtimeMs));
    hash.update('\0');
    hash.update(entry.link ?? '');
    hash.update('\n');
  }
  return 'sha256:' + hash.digest('hex');
}

export function computeRevision(root: string, excludes: ExcludeMatcher): string {
  return revisionOf(walkTree(root, excludes));
}
