import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { localChecks, parseRsyncVersion, rsyncSatisfies } from '../../dist/doctor.js';

describe('rsync version gate (PORT-01)', () => {
  test('parses GNU rsync output', () => {
    assert.deepEqual(parseRsyncVersion('rsync  version 3.5.0  protocol version 32'), [3, 5, 0]);
    assert.deepEqual(parseRsyncVersion('rsync  version 2.6.9  protocol version 29'), [2, 6, 9]);
  });

  test('rejects output that is not rsync', () => {
    assert.equal(parseRsyncVersion('openrsync: not a version line'), null);
  });

  test('accepts 3.1 and newer, rejects 3.0 and 2.x', () => {
    assert.equal(rsyncSatisfies([3, 1, 0]), true);
    assert.equal(rsyncSatisfies([3, 2, 7]), true);
    assert.equal(rsyncSatisfies([4, 0, 0]), true);
    assert.equal(rsyncSatisfies([3, 0, 9]), false);
    assert.equal(rsyncSatisfies([2, 6, 9]), false);
    assert.equal(rsyncSatisfies(null), false);
  });
});

describe('local checks', () => {
  test('reports node, ssh and rsync with actionable details', () => {
    const checks = localChecks();
    assert.deepEqual(checks.map((check) => check.name), ['node', 'ssh', 'rsync']);
    for (const check of checks) {
      assert.equal(typeof check.ok, 'boolean');
      assert.equal(typeof check.detail, 'string');
    }
    assert.equal(checks[0].ok, Number(process.versions.node.split('.')[0]) >= 22);
  });
});
