/** One error type for the whole tool, with stable codes and exit codes. */
export const EXIT = {
    ok: 0,
    command: 1,
    usage: 2,
    config: 3,
    unreachable: 4,
    lease: 5,
    replica: 6,
    artifact: 7,
    timeout: 124,
    doctor: 8,
};
const EXIT_BY_CODE = {
    usage: EXIT.usage,
    'config-missing': EXIT.config,
    'config-invalid': EXIT.config,
    'node-unreachable': EXIT.unreachable,
    'host-key-mismatch': EXIT.unreachable,
    'ssh-auth-failed': EXIT.unreachable,
    'rsync-missing': EXIT.unreachable,
    'lease-busy': EXIT.lease,
    'replica-missing': EXIT.replica,
    'replica-stale': EXIT.replica,
    'replica-diverged': EXIT.replica,
    'sync-failed': EXIT.replica,
    'sync-not-converged': EXIT.replica,
    'artifact-missing': EXIT.artifact,
    timeout: EXIT.timeout,
    'command-failed': EXIT.command,
    'state-corrupt': EXIT.replica,
    internal: EXIT.replica,
};
export class FleetError extends Error {
    code;
    details;
    exitCode;
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'FleetError';
        this.code = code;
        this.details = details;
        this.exitCode = EXIT_BY_CODE[code];
    }
}
export function toFleetError(error) {
    if (error instanceof FleetError)
        return error;
    const message = error instanceof Error ? error.message : String(error);
    return new FleetError('internal', message);
}
export function formatError(error) {
    const fleet = toFleetError(error);
    const entries = Object.entries(fleet.details).filter(([, value]) => value !== undefined);
    const suffix = entries.length > 0
        ? ' (' + entries.map(([key, value]) => `${key}: ${String(value)}`).join(', ') + ')'
        : '';
    return `${fleet.code}: ${fleet.message}${suffix}`;
}
//# sourceMappingURL=errors.js.map