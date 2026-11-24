/** Host selection for agent-facing tools. The agent expresses requirements, not a UI choice. */

import type { HostConfig, WorkspaceConfig } from './config.js';
import { AgentError } from './v1/errors.js';

export interface HostQuery {
  /** An alias, or `auto`/undefined to select by tags. */
  readonly host?: string;
  /** Every tag must be present on the selected host. */
  readonly tags?: readonly string[];
}

export function selectHost(config: WorkspaceConfig, query: HostQuery = {}): HostConfig {
  const tags = query.tags ?? [];
  const matches = (host: HostConfig) => tags.every((tag) => host.tags.includes(tag));
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
        `host ${JSON.stringify(host.alias)} does not match tags ${tags.join(', ')}; it has ${host.tags.join(', ') || 'no tags'}`,
      );
    }
    return host;
  }
  const candidates = Object.values(config.hosts).filter(matches);
  if (candidates.length === 0) {
    throw new AgentError(
      'INVALID_REQUEST',
      `no configured host matches tags ${tags.join(', ')}; hosts: ${Object.entries(config.hosts)
        .map(([alias, host]) => `${alias} [${host.tags.join(', ') || 'no tags'}]`)
        .join(', ')}`,
    );
  }
  return candidates[0]!;
}

export interface HostView {
  readonly alias: string;
  readonly tags: readonly string[];
  readonly tagsLabel: string;
}

export function hostViews(config: WorkspaceConfig): HostView[] {
  return Object.values(config.hosts).map((host) => ({
    alias: host.alias,
    tags: [...host.tags],
    tagsLabel: host.tags.join(', ') || 'no tags',
  }));
}
