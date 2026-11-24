/** Host selection for agent-facing tools. The agent expresses requirements, not a UI choice. */
import { AgentError } from './v1/errors.js';
export function selectHost(config, query = {}) {
    const tags = query.tags ?? [];
    const matches = (host) => tags.every((tag) => host.tags.includes(tag));
    if (query.host !== undefined && query.host !== '' && query.host !== 'auto') {
        const host = config.hosts[query.host];
        if (!host) {
            throw new AgentError('INVALID_REQUEST', `unknown host ${JSON.stringify(query.host)}; known: ${Object.keys(config.hosts).join(', ')}`);
        }
        if (!matches(host)) {
            throw new AgentError('INVALID_REQUEST', `host ${JSON.stringify(host.alias)} does not match tags ${tags.join(', ')}; it has ${host.tags.join(', ') || 'no tags'}`);
        }
        return host;
    }
    const candidates = Object.values(config.hosts).filter(matches);
    if (candidates.length === 0) {
        throw new AgentError('INVALID_REQUEST', `no configured host matches tags ${tags.join(', ')}; hosts: ${Object.entries(config.hosts)
            .map(([alias, host]) => `${alias} [${host.tags.join(', ') || 'no tags'}]`)
            .join(', ')}`);
    }
    return candidates[0];
}
export function hostViews(config) {
    return Object.values(config.hosts).map((host) => ({
        alias: host.alias,
        tags: [...host.tags],
        tagsLabel: host.tags.join(', ') || 'no tags',
    }));
}
//# sourceMappingURL=hosts.js.map