/** High-level operations over a connected agent. */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AgentClient } from './client.js';
import { AgentError } from './errors.js';
import { scanWorkspace, sha256File } from './workspace.js';
import type { Entry } from './workspace.js';
import { spawnTransport, sshTransport } from './transport.js';

export interface Host {
  readonly ssh: string;
  readonly port: number;
  readonly root: string;
}

export interface ConnectOptions {
  readonly agentPath?: string;
}

const PAGE = 5000;
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'unknown']);

export async function connectSsh(host: Host, options: ConnectOptions = {}): Promise<AgentClient> {
  return AgentClient.connect(sshTransport(host, options.agentPath ?? 'fleet-agent'), {
    capabilities: ['workspace.sync@1', 'exec@1', 'artifact@1'],
  });
}

/** Test/in-process transport: run the agent binary directly. */
export function connectProcess(command: string, args: readonly string[] = ['stdio']): Promise<AgentClient> {
  return AgentClient.connect(spawnTransport(command, args), {
    capabilities: ['workspace.sync@1', 'exec@1', 'artifact@1'],
  });
}

function operationId(): string {
  return crypto.randomBytes(6).toString('hex');
}

export interface WorkspaceInfo {
  generation: number;
  manifestDigest: string;
  recovery: boolean;
}

export async function openWorkspace(client: AgentClient, workspaceId: string, root: string, adopt = false): Promise<WorkspaceInfo> {
  return (await client.request('workspace.open', { workspaceId, root, adopt })) as WorkspaceInfo;
}

export async function status(client: AgentClient, workspaceId: string, root: string): Promise<WorkspaceInfo> {
  await openWorkspace(client, workspaceId, root, false);
  return (await client.request('workspace.status', { workspaceId })) as WorkspaceInfo;
}

export interface SyncOptions {
  readonly workspaceId: string;
  /** Local canonical directory that is scanned and uploaded. */
  readonly source: string;
  /** Remote replica root owned by the agent. */
  readonly root: string;
  readonly excludes: string[];
  readonly mode: 'plan' | 'apply';
  readonly adopt?: boolean;
}

export interface SyncSummary {
  readonly planDigest: string;
  readonly changes: { action: string; path: string }[];
  readonly needed: string[];
  readonly generation?: number;
  readonly manifestDigest?: string;
}

export async function syncWorkspace(
  client: AgentClient,
  matcher: { matches(relPath: string, isDir: boolean): boolean },
  options: SyncOptions,
): Promise<SyncSummary> {
  const scanned = await scanWorkspace(options.source, matcher);
  const blobs = new Map<string, { file: string; size: number }>();
  for (const entry of scanned.entries) {
    if (entry.type === 'file' && entry.digest) {
      blobs.set(entry.digest, { file: path.join(options.source, entry.path), size: entry.size });
    }
  }

  const workspace = await openWorkspace(client, options.workspaceId, options.root, options.adopt === true);
  if (workspace.recovery) {
    throw new AgentError('RECOVERY_REQUIRED', 'workspace has an unfinished transaction; run fleet recover', true);
  }
  const lease = operationId();
  await client.request('workspace.lease', { workspaceId: options.workspaceId, operationId: lease, ttlMs: 600_000 });
  let txnId: string | undefined;
  try {
    const begin = (await client.request('sync.begin', {
      workspaceId: options.workspaceId,
      leaseId: lease,
      baseGeneration: workspace.generation,
      policy: { excludes: options.excludes, preserve: [], deleteManaged: true },
    })) as { txnId: string };
    txnId = begin.txnId;

    for (let offset = 0; offset < scanned.entries.length; offset += PAGE) {
      await client.request('sync.entries', {
        txnId,
        entries: scanned.entries.slice(offset, offset + PAGE),
        more: offset + PAGE < scanned.entries.length,
      });
    }
    const plan = (await client.request('sync.plan', { txnId })) as {
      planDigest: string;
      changes: { action: string; path: string }[];
      needed: string[];
    };

    if (options.mode === 'plan') {
      await client.request('sync.abort', { txnId });
      return plan;
    }

    for (const digest of plan.needed) {
      const blob = blobs.get(digest);
      if (!blob) throw new AgentError('BLOB_MISSING', `no local file for ${digest}`);
      const put = (await client.request('blob.put', { txnId, digest, size: blob.size })) as { streamId: number };
      const bytes = await fs.promises.readFile(blob.file);
      if (`sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}` !== digest) {
        throw new AgentError('BLOB_CORRUPT', `local file ${blob.file} changed during upload`);
      }
      await client.upload(put.streamId, bytes);
    }

    const committed = (await client.request('sync.commit', { txnId, planDigest: plan.planDigest }, 1_800_000)) as {
      generation: number;
      manifestDigest: string;
    };
    return { ...plan, generation: committed.generation, manifestDigest: committed.manifestDigest };
  } finally {
    if (txnId) {
      try { await client.request('sync.abort', { txnId }); } catch { /* committed or already aborted */ }
    }
    try { await client.request('workspace.release', { leaseId: lease }); } catch { /* connection gone */ }
  }
}

export interface ExecOptions {
  readonly workspaceId: string;
  readonly root: string;
  readonly argv: string[];
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly timeoutMs?: number;
}

export interface ExecResult {
  readonly jobId: string;
  readonly state: string;
  readonly exitCode: number | null;
  readonly signal: number | null;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

export async function execCommand(client: AgentClient, options: ExecOptions): Promise<ExecResult> {
  const workspace = await openWorkspace(client, options.workspaceId, options.root, false);
  const lease = operationId();
  await client.request('workspace.lease', { workspaceId: options.workspaceId, operationId: lease, ttlMs: 600_000 });
  try {
    const start = (await client.request('exec.start', {
      workspaceId: options.workspaceId,
      leaseId: lease,
      expectedGeneration: workspace.generation,
      argv: options.argv,
      cwd: options.cwd,
      env: options.env ?? {},
      timeoutMs: options.timeoutMs,
    })) as { jobId: string; stdoutStream: number; stderrStream: number };

    const stdout = client.collect(start.stdoutStream, { initialCredit: 8 * 1024 * 1024, timeoutMs: (options.timeoutMs ?? 900_000) + 30_000 });
    const stderr = client.collect(start.stderrStream, { initialCredit: 8 * 1024 * 1024, timeoutMs: (options.timeoutMs ?? 900_000) + 30_000 });
    const [out, err] = await Promise.all([stdout, stderr]);

    let record = (await client.request('exec.status', { jobId: start.jobId })) as {
      state: string; exitCode: number | null; signal: number | null;
    };
    const deadline = Date.now() + (options.timeoutMs ?? 900_000) + 60_000;
    while (!TERMINAL.has(record.state) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      record = (await client.request('exec.status', { jobId: start.jobId })) as typeof record;
    }
    return {
      jobId: start.jobId,
      state: record.state,
      exitCode: record.exitCode,
      signal: record.signal,
      stdout: out,
      stderr: err,
    };
  } finally {
    try { await client.request('workspace.release', { leaseId: lease }); } catch { /* connection gone */ }
  }
}

export interface FetchOptions {
  readonly workspaceId: string;
  readonly root: string;
  readonly artifact: string;
  readonly dest: string;
  readonly overwrite?: boolean;
}

export interface FetchResult {
  readonly file: string;
  readonly bytes: number;
  readonly digest: string;
}

export async function fetchArtifact(client: AgentClient, options: FetchOptions): Promise<FetchResult> {
  await openWorkspace(client, options.workspaceId, options.root, false);
  const opened = (await client.request('artifact.open', {
    workspaceId: options.workspaceId,
    path: options.artifact,
  })) as { streamId: number; size: number; digest: string };
  const bytes = await client.collect(opened.streamId, {
    initialCredit: 8 * 1024 * 1024,
    timeoutMs: 300_000,
  });
  const digest = `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
  if (digest !== opened.digest) {
    throw new AgentError('BLOB_CORRUPT', `artifact digest mismatch: expected ${opened.digest} got ${digest}`);
  }
  const target = path.resolve(options.dest, path.basename(options.artifact));
  if (fs.existsSync(target) && options.overwrite !== true) {
    throw new AgentError('INVALID_REQUEST', `${target} exists; pass overwrite`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  return { file: target, bytes: bytes.length, digest };
}

export async function localDigest(file: string): Promise<string> {
  return sha256File(file);
}

export type { Entry };
