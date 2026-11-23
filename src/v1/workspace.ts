/** Local workspace scan and the manifest digest shared with the agent. */

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { ExcludeMatcher } from '../config.js';

export interface Entry {
  path: string;
  type: 'file' | 'dir' | 'symlink';
  mode: string;
  size: number;
  mtimeMs: number;
  digest?: string;
  link?: string;
}

export interface ScannedWorkspace {
  entries: Entry[];
  blobs: Map<string, string>;
  digest: string;
}

export async function scanWorkspace(root: string, excludes: ExcludeMatcher): Promise<ScannedWorkspace> {
  const entries: Entry[] = [];
  const blobs = new Map<string, string>();

  const visit = async (relative: string): Promise<void> => {
    const directory = relative === '' ? root : path.join(root, relative);
    const children = await fsp.readdir(directory, { withFileTypes: true });
    children.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
    for (const child of children) {
      const childRelative = relative === '' ? child.name : `${relative}/${child.name}`;
      const absolute = path.join(root, childRelative);
      const stats = await fsp.lstat(absolute);
      const isDir = stats.isDirectory();
      if (excludes.matches(childRelative, isDir)) continue;
      if (stats.isSymbolicLink()) {
        entries.push({
          path: childRelative,
          type: 'symlink',
          mode: '0777',
          size: 0,
          mtimeMs: Math.trunc(stats.mtimeMs),
          link: await fsp.readlink(absolute),
        });
      } else if (isDir) {
        entries.push({
          path: childRelative,
          type: 'dir',
          mode: modeOf(stats.mode),
          size: 0,
          mtimeMs: Math.trunc(stats.mtimeMs),
        });
        await visit(childRelative);
      } else if (stats.isFile()) {
        const digest = await sha256File(absolute);
        entries.push({
          path: childRelative,
          type: 'file',
          mode: modeOf(stats.mode),
          size: stats.size,
          mtimeMs: Math.trunc(stats.mtimeMs),
          digest,
        });
        blobs.set(digest, absolute);
      }
    }
  };

  await visit('');
  return { entries, blobs, digest: manifestDigest(entries) };
}

function modeOf(mode: number): string {
  return (mode & 0o7777).toString(8).padStart(4, '0');
}

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(`sha256:${hash.digest('hex')}`));
  });
}

export function manifestDigest(entries: readonly Entry[]): string {
  const hash = crypto.createHash('sha256');
  for (const entry of entries) {
    hash.update([
      entry.type,
      entry.path,
      entry.mode,
      String(entry.size),
      String(entry.mtimeMs),
      entry.digest ?? '',
      entry.link ?? '',
    ].join('\0'));
    hash.update('\n');
  }
  return `sha256:${hash.digest('hex')}`;
}
