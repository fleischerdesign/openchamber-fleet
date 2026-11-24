/** Human-readable replica state shared by the plugin card and the status section. */
export function replicaState(input) {
    if (input.recovery === true) {
        return {
            label: 'Recovery needed',
            tone: 'error',
            nextStep: 'Run fleet_recover before the next sync.',
            tooltip: 'The last sync was interrupted; open Fleet recovery before syncing again.',
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
//# sourceMappingURL=status.js.map