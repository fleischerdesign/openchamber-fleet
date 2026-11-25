/** Errors from the agent protocol, kept distinct from local configuration errors. */

export class AgentError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, retryable = false, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'AgentError';
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

const EXIT_BY_CODE: Record<string, number> = {
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
  WORKSPACE_ABSENT: 6,
  WORKSPACE_UNMANAGED: 6,
  LEASE_UNKNOWN: 5,
  LEASE_MISMATCH: 5,
  LEASE_EXPIRED: 5,
  DEST_EXISTS: 6,
  NOT_FOUND: 7,
  OPERATION_UNKNOWN: 6,
  PERMISSION_DENIED: 4,
  RESOURCE_EXHAUSTED: 6,
  CANCELLED: 1,
  INTERNAL: 6,
};

export function exitCodeFor(code: string): number {
  return EXIT_BY_CODE[code] ?? 6;
}
