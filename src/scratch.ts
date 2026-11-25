/** Explicit remote-only workspace for sessions without a local source tree. */

import crypto from 'node:crypto';
import { compileExcludes, loadHostsOnlyConfig } from './config.js';
import type { HostConfig, WorkspaceConfig } from './config.js';

export interface ScratchIdentity {
  /** Stable, filesystem-safe id for this session's scratch space. */
  readonly id: string;
  /** Agent workspace id; distinct from a project workspace name. */
  readonly workspaceId: string;
  /** Remote root shared by all hosts of this scratch space. */
  readonly root: string;
}

export interface ScratchOptions {
  /** Session id when available; otherwise a stable local directory. */
  readonly seed: string;
  /** Local directory shown in metadata; never synchronized. */
  readonly directory: string;
}

export function scratchIdentity(seed: string): ScratchIdentity {
  const digest = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16);
  return {
    id: digest,
    workspaceId: `scratch-${digest}`,
    root: `~/.cache/openchamber-fleet/scratch/${digest}`,
  };
}

export function scratchConfig(options: ScratchOptions): WorkspaceConfig {
  const identity = scratchIdentity(options.seed);
  const base = loadHostsOnlyConfig(options.directory);
  const hosts: Record<string, HostConfig> = {};
  for (const host of Object.values(base.hosts)) {
    hosts[host.alias] = { ...host, root: identity.root };
  }
  return {
    ...base,
    name: identity.workspaceId,
    dir: options.directory,
    hosts,
    excludes: [],
    env: {},
    shell: 'bash',
    excludeMatcher: compileExcludes([]),
  };
}

export function scratchRootForSeed(seed: string): string {
  return scratchIdentity(seed).root;
}
