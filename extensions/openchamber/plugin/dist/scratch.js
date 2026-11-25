/** Explicit remote-only workspace for sessions without a local source tree. */
import crypto from 'node:crypto';
import { compileExcludes, loadHostsOnlyConfig } from './config.js';
export function scratchIdentity(seed) {
    const digest = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16);
    return {
        id: digest,
        workspaceId: `scratch-${digest}`,
        root: `~/.cache/openchamber-fleet/scratch/${digest}`,
    };
}
export function scratchConfig(options) {
    const identity = scratchIdentity(options.seed);
    const base = loadHostsOnlyConfig(options.directory, options.configDir === undefined ? {} : { configDir: options.configDir });
    const hosts = {};
    for (const host of Object.values(base.hosts)) {
        hosts[host.alias] = { ...host, root: identity.root };
    }
    return {
        ...base,
        name: identity.workspaceId,
        label: 'scratch',
        dir: options.directory,
        hosts,
        excludes: [],
        env: {},
        shell: 'bash',
        excludeMatcher: compileExcludes([]),
        source: 'scratch',
    };
}
export function scratchRootForSeed(seed) {
    return scratchIdentity(seed).root;
}
//# sourceMappingURL=scratch.js.map