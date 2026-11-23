/** Composed status for humans and the plugin: replicas, revisions, drift, leases. */

import type { WorkspaceConfig } from './config.js';
import { computeRevision } from './manifest.js';
import { readLease, readState } from './state.js';
import type { Lease } from './state.js';
import { verifyWorkspace, workspaceKey } from './sync.js';

export type ReplicaState = 'unknown' | 'current' | 'stale' | 'drifted' | 'running';

export interface HostStatus {
  alias: string;
  ssh: string;
  root: string;
  revision: string;
  recordedRevision?: string;
  state: ReplicaState;
  lease?: Lease;
  changes?: number;
}

export interface StatusReport {
  workspace: string;
  dir: string;
  revision: string;
  hosts: HostStatus[];
}

export interface StatusOptions {
  /** Re-verify over SSH instead of trusting the state file. */
  readonly check?: boolean;
}

export async function statusReport(config: WorkspaceConfig, options: StatusOptions = {}): Promise<StatusReport> {
  const revision = computeRevision(config.dir, config.excludeMatcher);
  const state = readState();
  const hosts: HostStatus[] = [];

  for (const host of Object.values(config.hosts)) {
    const lease = readLease(host.alias, config.name) ?? undefined;
    const recorded = state.workspaces[workspaceKey(config, host)]?.revision;
    let replicaState: ReplicaState;
    let changes: number | undefined;
    if (lease) {
      replicaState = 'running';
    } else if (options.check === true) {
      const verified = await verifyWorkspace(config, host);
      changes = verified.entries.length;
      replicaState = changes === 0 ? 'current' : recorded === revision ? 'drifted' : 'stale';
    } else if (recorded === undefined) {
      replicaState = 'unknown';
    } else {
      replicaState = recorded === revision ? 'current' : 'stale';
    }
    hosts.push({
      alias: host.alias,
      ssh: host.ssh,
      root: host.root,
      revision,
      recordedRevision: recorded,
      state: replicaState,
      lease,
      changes,
    });
  }

  return { workspace: config.name, dir: config.dir, revision, hosts };
}
