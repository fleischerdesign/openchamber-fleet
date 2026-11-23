/** rsync invocation, itemized-plan parsing, and the plan digest. */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { FleetError } from './errors.js';
import type { HostConfig } from './config.js';
import { rsyncRsh } from './ssh.js';

export type PlanAction = 'add' | 'update' | 'delete' | 'type-change' | 'metadata';

export interface PlanEntry {
  action: PlanAction;
  path: string;
}

export interface PlanResult {
  revision: string;
  entries: PlanEntry[];
  digest: string;
}

export interface RsyncOptions {
  host: HostConfig;
  source: string;
  destination: string;
  excludes: readonly string[];
  dryRun: boolean;
  checksum?: boolean;
}

export interface RsyncResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Build the argv for one rsync call. `source` ends in a slash so rsync copies its contents. */
export function rsyncArgs(options: RsyncOptions): string[] {
  const args = [
    '-a',
    '--delete',
    '--itemize-changes',
    '--out-format=%i %n',
    '--protect-args',
    `--rsh=${rsyncRsh(options.host)}`,
  ];
  if (options.dryRun) args.push('--dry-run');
  if (options.checksum) args.push('--checksum');
  for (const pattern of options.excludes) args.push(`--exclude=${pattern}`);
  const source = options.source.endsWith('/') ? options.source : `${options.source}/`;
  args.push(source, `${options.host.ssh}:${options.destination}`);
  return args;
}

/** Run rsync and collect its output. Never uses a shell. */
export function runRsync(args: readonly string[]): Promise<RsyncResult> {
  return new Promise<RsyncResult>((resolve, reject) => {
    const child = spawn('rsync', [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 200_000) stderr += chunk.toString();
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        reject(new FleetError('rsync-missing', 'rsync is not installed on the controller'));
      } else {
        reject(new FleetError('sync-failed', `cannot run rsync: ${error.message}`));
      }
    });
    child.on('close', (code) => { resolve({ code, stdout, stderr }); });
  });
}

/**
 * Parse `--itemize-changes` output.
 *
 * Format: an 11-character itemize string, a space, then the path. `*deleting` marks deletions;
 * `c` marks created directories; `+++++++++` in the checksum area marks new entries; `.` marks
 * metadata-only changes. The root entry `./` is noise and is dropped.
 */
export function parseItemized(output: string): PlanEntry[] {
  const entries: PlanEntry[] = [];
  for (const rawLine of output.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.length === 0) continue;
    if (/^(sending|sent |total |receiving|building|created |deleting )/.test(line)) continue;
    if (line.startsWith('*deleting')) {
      const path = line.slice('*deleting'.length).trim();
      if (path.length > 0 && path !== './' && path !== '.') entries.push({ action: 'delete', path });
      continue;
    }
    const match = /^(\S{11}) (.+)$/.exec(line);
    if (!match) continue;
    const code = match[1] as string;
    const path = match[2] as string;
    if (path === './' || path === '.') continue;
    const flags = code.slice(2);
    let action: PlanAction;
    if (flags === '+++++++++') action = 'add';
    else if (code.startsWith('c')) action = 'add';
    else if (code.startsWith('.')) action = flags.includes('t') || flags.includes('p') ? 'metadata' : 'update';
    else if (code.startsWith('h')) action = 'update';
    else if (code.startsWith('>') || code.startsWith('<')) action = 'update';
    else action = 'type-change';
    entries.push({ action, path });
  }
  return entries;
}

export function planDigest(entries: readonly PlanEntry[]): string {
  const hash = crypto.createHash('sha256');
  for (const entry of entries) {
    hash.update(entry.action);
    hash.update('\0');
    hash.update(entry.path);
    hash.update('\n');
  }
  return 'sha256:' + hash.digest('hex');
}
