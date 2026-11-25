/** Human-readable labels shared by the plugin, tools and job notifications. */
export const STATE_LABELS = {
    queued: 'Queued',
    starting: 'Starting',
    running: 'Running',
    'cancel-requested': 'Cancelling',
    succeeded: 'Succeeded',
    failed: 'Failed',
    cancelled: 'Cancelled',
    interrupted: 'Interrupted',
    unknown: 'Unknown',
    'sync-required': 'Sync required',
};
export function stateLabelOf(state) {
    return STATE_LABELS[state] ?? state;
}
export function exitLabelOf(exitCode, signal, state) {
    if (typeof exitCode === 'number')
        return `Exit code ${exitCode}`;
    if (typeof signal === 'number')
        return `Signal ${signal}`;
    if (state === 'queued')
        return 'Waiting to start';
    if (state === 'starting')
        return 'Starting';
    if (state === 'running' || state === 'cancel-requested')
        return 'Still running';
    if (state === 'sync-required')
        return 'Not run';
    return 'No exit code';
}
export function commandLabelOf(argv) {
    const executable = (argv[0] ?? 'command').split('/').pop() || 'command';
    const safe = executable.replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, 48);
    const count = argv.length - 1;
    return count > 0 ? `${safe} · ${count} arg${count === 1 ? '' : 's'}` : safe;
}
//# sourceMappingURL=labels.js.map