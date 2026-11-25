/** Host selection for agent-facing tools. The agent expresses requirements, not a UI choice. */

import { hostAllows } from './config.js';
import type { HostConfig, HostOperation, WorkspaceConfig } from './config.js';
import { AgentError } from './v1/errors.js';

export interface HostQuery {
  /** An alias, or `auto`/undefined to select by tags. */
  readonly host?: string;
  /** Every tag must be present on the selected host. */
  readonly tags?: readonly string[];
  /** Operation the host must be allowed to perform; omitted means no filter. */
  readonly operation?: HostOperation;
}

export function selectHost(config: WorkspaceConfig, query: HostQuery = {}): HostConfig {
  const tags = query.tags ?? [];
  const allowed = (host: HostConfig) => query.operation === undefined || hostAllows(host, query.operation);
  const matches = (host: HostConfig) => tags.every((tag) => host.tags.includes(tag)) && allowed(host);
  if (query.host !== undefined && query.host !== '' && query.host !== 'auto') {
    const host = config.hosts[query.host];
    if (!host) {
      throw new AgentError(
        'INVALID_REQUEST',
        `unknown host ${JSON.stringify(query.host)}; known: ${Object.keys(config.hosts).join(', ')}`,
      );
    }
    if (!matches(host)) {
      throw new AgentError(
        'INVALID_REQUEST',
        query.operation !== undefined && !allowed(host)
          ? `host ${JSON.stringify(host.alias)} is not allowed for ${query.operation}`
          : `host ${JSON.stringify(host.alias)} does not match tags ${tags.join(', ')}; it has ${host.tags.join(', ') || 'no tags'}`,
      );
    }
    return host;
  }
  const candidates = Object.values(config.hosts).filter(matches);
  if (candidates.length === 0) {
    throw new AgentError(
      'INVALID_REQUEST',
      `no configured host matches tags ${tags.join(', ')}${query.operation === undefined ? '' : ` for ${query.operation}`}; hosts: ${Object.entries(config.hosts)
        .map(([alias, host]) => `${alias} [${host.tags.join(', ') || 'no tags'}${host.allow === undefined ? '' : `; ${host.allow.length === 0 ? 'no operations' : host.allow.join(', ')}`}]`)
        .join(', ')}`,
    );
  }
  return candidates[0]!;
}

export interface HostView {
  readonly alias: string;
  readonly tags: readonly string[];
  readonly tagsLabel: string;
  readonly operations: readonly HostOperation[];
  readonly operationsLabel: string;
}

export function hostViews(config: WorkspaceConfig): HostView[] {
  const all: readonly HostOperation[] = ['workspace', 'scratch', 'transfer'];
  return Object.values(config.hosts).map((host) => {
    const operations = host.allow ?? all;
    return {
      alias: host.alias,
      tags: [...host.tags],
      tagsLabel: host.tags.join(', ') || 'no tags',
      operations: [...operations],
      operationsLabel: operations.length === 0 ? 'none' : operations.join(', '),
    };
  });
}
