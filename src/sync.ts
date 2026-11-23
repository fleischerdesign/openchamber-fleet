/** Plan, apply and verify a workspace replica. */

import { FleetError } from './errors.js';
import type { HostConfig, WorkspaceConfig } from './config.js';
import { compileExcludes } from './config.js';
import { computeRevision, walkTree } from './manifest.js';
import { parseItemized, planDigest, rsyncArgs, runRsync } from './plan.js';
import type { PlanEntry, PlanResult } from './plan.js';
import { quoteShell } from './paths.js';
import { assertControlSuccess, classifyFailure, isTransportFailure, remoteHome, resolveRemotePath, runRemote } from './ssh.js';
import { readState, recordWorkspace } from './state.js';

export interface SyncOptions {
  readonly checksum?: boolean;
  /**
   * Additional excludes for this call, unioned with `fleet.json`. The tool never guesses a project
   * type; the agent knows the tree and names what is generated.
   */
  readonly excludes?: readonly string[];
}

export interface ApplyResult {
  readonly plan: PlanResult;
  readonly applied: number;
  readonly verifiedAt: string;
  readonly excludes: string[];
}

export function workspaceKey(config: WorkspaceConfig, host: HostConfig): string {
  return `${host.alias}--${config.name}`;
}

export function effectiveExcludes(config: WorkspaceConfig, extra: readonly string[] = []): string[] {
  return [...new Set([...config.excludes, ...extra])];
}

/** The excludes the replica was last synced with. `exec` verifies against those, not the config. */
export function recordedExcludes(config: WorkspaceConfig, host: HostConfig): string[] | null {
  const entry = readState().workspaces[workspaceKey(config, host)];
  return Array.isArray(entry?.excludes) ? entry.excludes : null;
}

const UNSAFE_ROOTS = new Set(['/', '/home', '/root', '/usr', '/etc', '/var', '/srv', '/opt', '/bin', '/lib', '/lib64', '/nix', '/boot', '/tmp']);

/**
 * Refuse a replica root whose deletion would be destructive. rsync runs with --delete, so a typo
 * in fleet.json must fail before anything is touched.
 */
export function assertSafeRemoteRoot(resolved: string, home: string): void {
  const root = resolved.replace(/\/+$/, '') || '/';
  const segments = root.split('/').filter(Boolean);
  if (UNSAFE_ROOTS.has(root) || segments.length < 2 || root === home.replace(/\/+$/, '')) {
    throw new FleetError('config-invalid', `replica root ${JSON.stringify(resolved)} is too broad for --delete`, {
      hint: 'use a dedicated directory such as ~/.cache/openchamber-fleet/<workspace>',
    });
  }
}

function assertRsync(result: { code: number | null; stderr: string }): void {
  if (result.code === 0) return;
  if (result.code === 255 || isTransportFailure(result.stderr)) throw classifyFailure(result.stderr, result.code);
  throw new FleetError('sync-failed', 'rsync failed', {
    exitCode: result.code,
    stderr: result.stderr.trim().slice(0, 500),
  });
}

export async function planWorkspace(
  config: WorkspaceConfig,
  host: HostConfig,
  options: SyncOptions = {},
): Promise<PlanResult> {
  // A plan without explicit excludes describes the replica as it was last synced; otherwise it
  // previews exactly the call it was given.
  const excludes = options.excludes ?? recordedExcludes(config, host) ?? config.excludes;
  const revision = computeRevision(config.dir, compileExcludes(excludes));
  const destination = await resolveRemotePath(host, host.root);
  assertSafeRemoteRoot(destination, await remoteHome(host));
  const result = await runRsync(rsyncArgs({
    host,
    source: config.dir,
    destination,
    excludes,
    dryRun: true,
    checksum: options.checksum,
  }));
  assertRsync(result);
  const entries = parseItemized(result.stdout);
  return { revision, entries, digest: planDigest(entries) };
}

export async function verifyWorkspace(
  config: WorkspaceConfig,
  host: HostConfig,
  options: SyncOptions = {},
): Promise<{ revision: string; entries: PlanEntry[] }> {
  const excludes = options.excludes ?? recordedExcludes(config, host) ?? config.excludes;
  const plan = await planWorkspace(config, host, { ...options, excludes });
  return { revision: plan.revision, entries: plan.entries };
}

export async function applyWorkspace(
  config: WorkspaceConfig,
  host: HostConfig,
  options: SyncOptions = {},
): Promise<ApplyResult> {
  const excludes = effectiveExcludes(config, options.excludes);
  const entries = walkTree(config.dir, compileExcludes(excludes));
  const revision = computeRevision(config.dir, compileExcludes(excludes));
  // rsync compares whole seconds; a same-size edit inside that window would be skipped. While a
  // tree is being edited, pay for content hashes instead of trusting the clock.
  const racy = entries.some((entry) => entry.type === 'file' && Date.now() - entry.mtimeMs < 5000);
  const checksum = options.checksum === true || racy;
  const destination = await resolveRemotePath(host, host.root);
  assertSafeRemoteRoot(destination, await remoteHome(host));

  const prepared = await runRemote(host, `mkdir -p ${quoteShell(destination)}`, { timeoutMs: 15_000 });
  assertControlSuccess(prepared);

  const transfer = await runRsync(rsyncArgs({
    host,
    source: config.dir,
    destination,
    excludes,
    dryRun: false,
    checksum,
  }));
  assertRsync(transfer);
  const appliedEntries = parseItemized(transfer.stdout);

  const verify = await runRsync(rsyncArgs({
    host,
    source: config.dir,
    destination,
    excludes,
    dryRun: true,
    checksum,
  }));
  assertRsync(verify);
  const remaining = parseItemized(verify.stdout);
  if (remaining.length > 0) {
    throw new FleetError('sync-not-converged', 'replica still differs after apply; it was not marked current', {
      remaining: remaining.length,
      first: remaining[0]?.path ?? '',
    });
  }

  const verifiedAt = new Date().toISOString();
  const digest = planDigest(appliedEntries);
  recordWorkspace(workspaceKey(config, host), {
    revision,
    planDigest: digest,
    appliedAt: verifiedAt,
    verifiedAt,
    excludes,
  });
  return {
    plan: { revision, entries: appliedEntries, digest },
    applied: appliedEntries.length,
    verifiedAt,
    excludes,
  };
}
