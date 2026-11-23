import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { loadConfig } from '../../dist/config.js';
import { doctor } from '../../dist/doctor.js';
import { cleanup, makeWorkspace } from '../fixtures/harness.mjs';

const workspace = makeWorkspace({ name: 'doctor-tests', files: { 'a.txt': 'a\n' } });
const config = loadConfig(workspace.source);
after(() => cleanup(workspace));

describe('fleet doctor', () => {
  test('checks the controller and every declared host', async () => {
    const report = await doctor(config);
    assert.equal(report.local.length, 3);
    const checks = report.hosts.node;
    assert.deepEqual(checks.map((check) => check.name), ['rsync', 'bash', 'base64', 'sha256', 'home']);
    for (const check of checks) assert.equal(check.ok, true, `${check.name}: ${check.detail}`);
    assert.equal(report.ok, true);
  });

  test('an unknown host is a usage error', async () => {
    await assert.rejects(doctor(config, 'nope'), (error) => error.code === 'usage');
  });
});
