import assert from 'node:assert/strict';
import { test } from 'node:test';
import { supervisorVersionDecision } from '../../dist/jobs/health.js';

function record(overrides = {}) {
  return {
    protocol: 1,
    version: '0.9.1',
    instance: 'instance',
    pid: 123,
    startedAt: 1,
    bootTime: 1,
    updatedAt: 1,
    stateRoot: '/state',
    activeJobs: 0,
    ...overrides,
  };
}

test('a supervisor of the same version is reused', () => {
  assert.equal(supervisorVersionDecision(record(), '0.9.1'), 'reuse');
});

test('an idle supervisor of another version may be replaced', () => {
  assert.equal(supervisorVersionDecision(record({ version: '0.6.0' }), '0.9.1'), 'replace');
});

test('a busy supervisor of another version defers the handover', () => {
  assert.equal(supervisorVersionDecision(record({ version: '0.6.0', activeJobs: 2 }), '0.9.1'), 'defer');
});

test('a missing supervisor starts one', () => {
  assert.equal(supervisorVersionDecision(null, '0.9.1'), 'start');
});
