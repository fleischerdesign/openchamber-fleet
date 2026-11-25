/** Human-readable replica state shared by the plugin card and the status section. */

export interface ReplicaStateInput {
  readonly generation?: number;
  readonly recovery?: boolean;
  readonly state?: 'ABSENT' | 'UNMANAGED' | 'READY' | 'RECOVERY';
}

export type ReplicaTone = 'success' | 'warning' | 'error';

export interface ReplicaState {
  readonly label: 'Ready' | 'Not synced' | 'Recovery needed' | 'Unmanaged';
  readonly tone: ReplicaTone;
  readonly nextStep: string;
  readonly tooltip: string;
}

export function replicaState(input: ReplicaStateInput): ReplicaState {
  if (input.recovery === true) {
    return {
      label: 'Recovery needed',
      tone: 'error',
      nextStep: 'Run fleet_recover before the next sync.',
      tooltip: 'The last sync was interrupted; open Fleet recovery before syncing again.',
    };
  }
  if (input.state === 'UNMANAGED') {
    return {
      label: 'Unmanaged',
      tone: 'warning',
      nextStep: 'Adopt the existing root explicitly, or choose a different root.',
      tooltip: 'The remote root exists but is not managed by Fleet; a normal sync refuses to overwrite it.',
    };
  }
  if (!input.generation || input.generation <= 0) {
    return {
      label: 'Not synced',
      tone: 'warning',
      nextStep: 'Run fleet_sync plan, then apply.',
      tooltip: 'No replica has been synced yet.',
    };
  }
  return {
    label: 'Ready',
    tone: 'success',
    nextStep: 'No action needed.',
    tooltip: 'Workspace replica is ready. Local changes may still need a sync.',
  };
}
