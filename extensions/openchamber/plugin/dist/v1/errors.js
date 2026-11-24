/** Errors from the agent protocol, kept distinct from local configuration errors. */
export class AgentError extends Error {
    code;
    retryable;
    details;
    constructor(code, message, retryable = false, details = {}) {
        super(message);
        this.name = 'AgentError';
        this.code = code;
        this.retryable = retryable;
        this.details = details;
    }
}
const EXIT_BY_CODE = {
    WORKSPACE_BUSY: 5,
    RECOVERY_REQUIRED: 5,
    GENERATION_MISMATCH: 6,
    PLAN_MISMATCH: 6,
    BLOB_MISSING: 6,
    BLOB_CORRUPT: 6,
    PATH_UNSAFE: 6,
    UNSUPPORTED_METADATA: 6,
    DISK_FULL: 6,
    UNSUPPORTED_PROTOCOL: 4,
    UNSUPPORTED_CAPABILITY: 4,
    INVALID_FRAME: 4,
    INVALID_REQUEST: 2,
    NOT_INITIALIZED: 4,
    WORKSPACE_UNKNOWN: 4,
    LEASE_UNKNOWN: 5,
    LEASE_EXPIRED: 5,
    OPERATION_UNKNOWN: 6,
    PERMISSION_DENIED: 4,
    RESOURCE_EXHAUSTED: 6,
    CANCELLED: 1,
    INTERNAL: 6,
};
export function exitCodeFor(code) {
    return EXIT_BY_CODE[code] ?? 6;
}
//# sourceMappingURL=errors.js.map