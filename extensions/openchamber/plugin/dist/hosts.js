/** Host selection for agent-facing tools. The agent expresses requirements, not a UI choice. */
import { hostAllows } from './config.js';
import { AgentError } from './v1/errors.js';
export function selectHost(config, query = {}) {
    const tags = query.tags ?? [];
    const allowed = (host) => query.operation === undefined || hostAllows(host, query.operation);
    const matches = (host) => tags.every((tag) => host.tags.includes(tag)) && allowed(host);
    if (query.host !== undefined && query.host !== '' && query.host !== 'auto') {
        const host = config.hosts[query.host];
        if (!host) {
            throw new AgentError('INVALID_REQUEST', `unknown host ${JSON.stringify(query.host)}; known: ${Object.keys(config.hosts).join(', ')}`);
        }
        if (!matches(host)) {
            throw new AgentError('INVALID_REQUEST', query.operation !== undefined && !allowed(host)
                ? `host ${JSON.stringify(host.alias)} is not allowed for ${query.operation}`
                : `host ${JSON.stringify(host.alias)} does not match tags ${tags.join(', ')}; it has ${host.tags.join(', ') || 'no tags'}`);
        }
        return host;
    }
    const candidates = Object.values(config.hosts).filter(matches);
    if (candidates.length === 0) {
        throw new AgentError('INVALID_REQUEST', `no configured host matches tags ${tags.join(', ')}${query.operation === undefined ? '' : ` for ${query.operation}`}; hosts: ${Object.entries(config.hosts)
            .map(([alias, host]) => `${alias} [${host.tags.join(', ') || 'no tags'}${host.allow === undefined ? '' : `; ${host.allow.join(', ')}`}]`)
            .join(', ')}`);
    }
    return candidates[0];
}
export function hostViews(config) {
    const all = ['workspace', 'scratch', 'transfer'];
    return Object.values(config.hosts).map((host) => {
        const operations = host.allow ?? all;
        return {
            alias: host.alias,
            tags: [...host.tags],
            tagsLabel: host.tags.join(', ') || 'no tags',
            operations: [...operations],
            operationsLabel: operations.join(', '),
        };
    });
}
//# sourceMappingURL=hosts.js.map