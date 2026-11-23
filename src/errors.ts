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
} as const;

export type ErrorCode =
  | 'usage'
  | 'config-missing'
  | 'config-invalid'
  | 'node-unreachable'
  | 'host-key-mismatch'
  | 'ssh-auth-failed'
  | 'rsync-missing'
  | 'lease-busy'
  | 'replica-missing'
  | 'replica-stale'
  | 'replica-diverged'
  | 'sync-failed'
  | 'sync-not-converged'
  | 'artifact-missing'
  | 'timeout'
  | 'command-failed'
  | 'state-corrupt'
  | 'internal';

const EXIT_BY_CODE: Record<ErrorCode, number> = {
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

export type FleetErrorDetails = Record<string, string | number | boolean | null | undefined>;

export class FleetError extends Error {
  readonly code: ErrorCode;
  readonly details: FleetErrorDetails;
  readonly exitCode: number;

  constructor(code: ErrorCode, message: string, details: FleetErrorDetails = {}) {
    super(message);
    this.name = 'FleetError';
    this.code = code;
    this.details = details;
    this.exitCode = EXIT_BY_CODE[code];
  }
}

export function toFleetError(error: unknown): FleetError {
  if (error instanceof FleetError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new FleetError('internal', message);
}

export function formatError(error: unknown): string {
  const fleet = toFleetError(error);
  const entries = Object.entries(fleet.details).filter(([, value]) => value !== undefined);
  const suffix = entries.length > 0
    ? ' (' + entries.map(([key, value]) => `${key}: ${String(value)}`).join(', ') + ')'
    : '';
  return `${fleet.code}: ${fleet.message}${suffix}`;
}
