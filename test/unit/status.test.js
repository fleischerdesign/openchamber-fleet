import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { replicaState } from '../../dist/status.js';

describe('replica status labels', () => {
  test('a fresh replica is not reported as ready', () => {
    const state = replicaState({ generation: 0, recovery: false });
    assert.equal(state.label, 'Not synced');
    assert.equal(state.tone, 'warning');
    assert.match(state.nextStep, /fleet_sync/);
  });

  test('a synced replica is ready', () => {
    const state = replicaState({ generation: 3, recovery: false });
    assert.equal(state.label, 'Ready');
    assert.equal(state.tone, 'success');
  });

  test('recovery takes precedence over the generation', () => {
    const state = replicaState({ generation: 3, recovery: true });
    assert.equal(state.label, 'Recovery needed');
    assert.equal(state.tone, 'error');
    assert.match(state.nextStep, /fleet_recover/);
  });
});
