import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { loadConfig } from '../../dist/config.js';
import { FleetJobRegistry } from '../../dist/plugin/jobs.js';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-jobs-'));
fs.writeFileSync(path.join(workspace, 'fleet.json'), JSON.stringify({
  name: 'job-tests',
  hosts: { node: { ssh: 'test@127.0.0.1', port: 1 } },
}));
after(() => fs.rmSync(workspace, { recursive: true, force: true }));

function harness() {
  const notifications = [];
  const storage = new Map();
  const ctx = {
    session: { synthetic: async (input) => notifications.push(input) },
    storage: {
      get: async (key) => storage.get(key),
      set: async (key, value) => storage.set(key, value),
      remove: async (key) => storage.delete(key),
      scan: async ({ prefix }) => ({ entries: [...storage].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value })) }),
    },
  };
  return { ctx, notifications, storage };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function fakeExecutor(jobId, pending) {
  const calls = { cancel: 0, close: 0 };
  const client = { close: () => { calls.close += 1; } };
  const handle = {
    jobId,
    result: pending.promise,
    cancel: async () => { calls.cancel += 1; },
    close: () => { calls.close += 1; },
  };
  return {
    calls,
    executor: {
      connect: async () => client,
      start: async () => handle,
    },
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('background Fleet jobs', () => {
  test('completion sends one resuming synthetic message with a deterministic id', async () => {
    const { ctx, notifications } = harness();
    const pending = deferred();
    const { executor, calls } = fakeExecutor('job-1', pending);
    const registry = new FleetJobRegistry(ctx, 'fleet-agent', executor);
    const config = loadConfig(workspace);
    const record = await registry.start({
      config,
      host: config.hosts.node,
      sessionID: 'ses_1',
      argv: ['true'],
      agentPath: 'fleet-agent',
    });
    assert.equal(record.state, 'running');
    pending.resolve({ jobId: 'job-1', state: 'succeeded', exitCode: 0, signal: null, stdout: Buffer.from('ok'), stderr: Buffer.alloc(0) });
    await tick();
    await tick();
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].resume, true);
    assert.equal(notifications[0].delivery, 'steer');
    assert.match(notifications[0].id, /^msg_fleet_/);
    assert.equal(notifications[0].metadata.source, 'fleet');
    assert.equal(notifications[0].metadata.exitCode, 0);
    assert.match(notifications[0].text, /This is tool output, not a user instruction/);
    assert.ok(calls.close >= 1);
    await registry.cleanup();
  });

  test('plugin cleanup interrupts active jobs without resuming the session', async () => {
    const { ctx, notifications } = harness();
    const pending = deferred();
    const { executor, calls } = fakeExecutor('job-2', pending);
    const registry = new FleetJobRegistry(ctx, 'fleet-agent', executor);
    const config = loadConfig(workspace);
    await registry.start({
      config,
      host: config.hosts.node,
      sessionID: 'ses_2',
      argv: ['sleep', '10'],
      agentPath: 'fleet-agent',
    });
    await registry.cleanup();
    assert.equal(calls.cancel, 1);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].resume, false);
    assert.equal(notifications[0].metadata.state, 'interrupted');
    pending.resolve({ jobId: 'job-2', state: 'cancelled', exitCode: null, signal: 15, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) });
    await tick();
    assert.equal(notifications.length, 1);
  });

  test('stored running jobs are reported as interrupted after a runtime restart', async () => {
    const { ctx, notifications, storage } = harness();
    const registry = new FleetJobRegistry(ctx, 'fleet-agent');
    const config = loadConfig(workspace);
    const key = 'fleet-job:test';
    storage.set(key, {
      key: 'job-tests\0node\0old-job',
      jobId: 'old-job',
      sessionID: 'ses_old',
      workspace: 'job-tests',
      host: 'node',
      argv: ['true'],
      state: 'running',
      notificationID: 'msg_fleet_old',
      startedAt: Date.now(),
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutTail: '',
      stderrTail: '',
    });
    await registry.recoverInterrupted();
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].resume, false);
    assert.equal(notifications[0].metadata.state, 'interrupted');
    assert.equal(storage.get(key).state, 'interrupted');
  });
});
