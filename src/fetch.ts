/** Artifact transfer: explicit paths only, safe links, optional content verification. */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { FleetError } from './errors.js';
import type { HostConfig, WorkspaceConfig } from './config.js';
import { assertRelativePath, quoteShell } from './paths.js';
import { classifyFailure, isTransportFailure, resolveRemotePath, rsyncRsh, runRemote, scriptCommand } from './ssh.js';

export interface FetchRequest {
  readonly config: WorkspaceConfig;
  readonly host: HostConfig;
  readonly paths: readonly string[];
  readonly dest: string;
  readonly overwrite?: boolean;
  readonly verify?: boolean;
}

export interface FetchResult {
  readonly paths: string[];
  readonly bytes: number;
  readonly verified: boolean;
}

function runRsyncFetch(args: readonly string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('rsync', [...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 100_000) stderr += chunk.toString();
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(new FleetError(error.code === 'ENOENT' ? 'rsync-missing' : 'sync-failed', `cannot run rsync: ${error.message}`));
    });
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

/** Ask the node for a SHA-256 without trusting the transfer. */
async function remoteSha256(host: HostConfig, remoteFile: string): Promise<string | null> {
  const script = [
    `f=${quoteShell(remoteFile)}`,
    'if command -v sha256sum >/dev/null 2>&1; then sha256sum "$f";',
    'elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$f";',
    'else exit 90; fi',
  ].join('\n');
  const result = await runRemote(host, scriptCommand(script), { timeoutMs: 120_000 });
  if (result.code !== 0) return null;
  return result.stdout.trim().split(/\s+/)[0] ?? null;
}

function localSha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export async function fetchArtifacts(request: FetchRequest): Promise<FetchResult> {
  const { config, host } = request;
  if (request.paths.length === 0) throw new FleetError('usage', 'fetch needs at least one path');
  const paths = request.paths.map(assertRelativePath);
  const dest = path.resolve(request.dest);
  fs.mkdirSync(dest, { recursive: true, mode: 0o755 });

  for (const entry of paths) {
    const target = path.join(dest, path.posix.basename(entry));
    if (fs.existsSync(target) && request.overwrite !== true) {
      throw new FleetError('artifact-missing', `destination ${target} already exists`, { hint: 'pass --overwrite' });
    }
  }

  const remoteRoot = (await resolveRemotePath(host, host.root)).replace(/\/+$/, '');
  const sources = paths.map((entry) => `${host.ssh}:${remoteRoot}/${entry}`);
  const result = await runRsyncFetch(['-a', '--safe-links', '--protect-args', `--rsh=${rsyncRsh(host)}`, ...sources, dest]);
  if (result.code !== 0) {
    if (isTransportFailure(result.stderr)) throw classifyFailure(result.stderr, result.code);
    throw new FleetError('artifact-missing', 'artifact transfer failed', {
      exitCode: result.code,
      stderr: result.stderr.trim().slice(0, 400),
    });
  }

  let bytes = 0;
  const fetched: string[] = [];
  for (const entry of paths) {
    const target = path.join(dest, path.posix.basename(entry));
    if (fs.existsSync(target)) {
      const stats = fs.statSync(target);
      bytes += stats.isDirectory() ? 0 : stats.size;
      fetched.push(target);
      if (request.verify === true && stats.isFile()) {
        const remote = await remoteSha256(host, `${remoteRoot}/${entry}`);
        if (remote === null) {
          throw new FleetError('artifact-missing', `cannot hash ${entry} on the node`);
        }
        if (remote !== localSha256(target)) {
          throw new FleetError('artifact-missing', `content mismatch for ${entry}`, { expected: remote });
        }
      }
    } else {
      throw new FleetError('artifact-missing', `artifact ${entry} is missing after transfer`);
    }
  }

  return { paths: fetched, bytes, verified: request.verify === true };
}
