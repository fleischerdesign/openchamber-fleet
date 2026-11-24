/** One error type for the whole tool, with stable codes and exit codes. */
import { AgentError } from './v1/errors.js';
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
/** Human-facing copy for the agent codes people actually hit. */
export function friendlyErrorMessage(error) {
    if (error instanceof AgentError) {
        switch (error.code) {
            case 'WORKSPACE_BUSY':
                return 'Another Fleet operation is using this workspace. Wait for it to finish and retry.';
            case 'RECOVERY_REQUIRED':
                return 'The replica needs recovery before syncing. Run fleet_recover first.';
            case 'GENERATION_MISMATCH':
            case 'PLAN_MISMATCH':
                return 'The replica changed during the operation. Run fleet_sync plan again and review the new plan.';
            case 'DISK_FULL':
                return 'The target machine ran out of disk space. Free space and retry.';
            case 'INVALID_FRAME':
                return 'The remote agent rejected a protocol frame. Make sure Fleet is the same version on both ends.';
            case 'UNSUPPORTED_PROTOCOL':
            case 'UNSUPPORTED_CAPABILITY':
                return 'The remote Fleet agent is incompatible. Install a matching fleet-agent.';
            case 'OPERATION_UNKNOWN':
                return 'The remote operation state is unknown. Inspect the job or run fleet_recover before continuing.';
            case 'PERMISSION_DENIED':
                return 'The remote agent denied this operation.';
            case 'CANCELLED':
                return 'The operation was cancelled.';
            case 'RESOURCE_EXHAUSTED':
                return 'The remote agent ran out of resources. Retry when it has capacity.';
            default:
                return error.message;
        }
    }
    if (error instanceof FleetError) {
        if (error.code === 'lease-busy') {
            return 'Another Fleet operation is using this workspace. Wait for it to finish and retry.';
        }
        const hint = error.details.hint;
        return hint ? `${error.message} (${hint})` : error.message;
    }
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=errors.js.map