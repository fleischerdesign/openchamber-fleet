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

function harness(location = workspace) {
  const notifications = [];
  const storage = new Map();
  const ctx = {
    location: { directory: location },
    session: { synthetic: async (input) => notifications.push(input) },
    storage: {
      get: async (key) => storage.get(key),
      set: async (key, value) => storage.set(key, value),
      remove: async (key) => storage.delete(key),
      scan: async ({ prefix, after }) => {
        const entries = [...storage]
          .filter(([key]) => key.startsWith(prefix) && (!after || key > after))
          .sort(([left], [right]) => left.localeCompare(right))
          .slice(0, 1000)
          .map(([key, value]) => ({ key, value }));
        return { entries, next: entries.length === 1000 ? entries.at(-1).key : undefined };
      },
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

function storedRecord(overrides = {}) {
  return {
    key: 'job-tests\0node\0old-job',
    jobId: 'old-job',
    sessionID: 'ses_old',
    workspace: 'job-tests',
    directory: workspace,
    host: 'node',
    argv: ['true'],
    state: 'running',
    notified: false,
    notificationID: 'msg_fleet_old',
    startedAt: Date.now(),
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutTail: '',
    stderrTail: '',
    ...overrides,
  };
}

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
    assert.equal(record.directory, workspace);
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
    const persisted = await registry.status(config, 'node', 'job-1', 'ses_1');
    assert.equal(persisted.notified, true);
    await assert.rejects(registry.status(config, 'node', 'job-1', 'ses_other'), /another session/);
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
    const key = 'fleet-job:test';
    storage.set(key, storedRecord());
    await registry.recoverInterrupted();
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].resume, false);
    assert.equal(notifications[0].metadata.state, 'interrupted');
    assert.equal(storage.get(key).state, 'interrupted');
    assert.equal(storage.get(key).notified, true);
  });

  test('a second location does not interrupt a job owned by the first', async () => {
    const first = harness(workspace);
    const second = harness(path.join(os.tmpdir(), 'fleet-other-project'));
    first.storage.set('fleet-job:test', storedRecord());
    const registry = new FleetJobRegistry(second.ctx, 'fleet-agent');
    await registry.recoverInterrupted();
    assert.equal(second.notifications.length, 0);
    assert.equal(first.storage.get('fleet-job:test').state, 'running');
  });

  test('terminal records with an undelivered notification are retried on recovery', async () => {
    const { ctx, notifications, storage } = harness();
    const key = 'fleet-job:test';
    storage.set(key, storedRecord({ state: 'succeeded', exitCode: 0, notified: false }));
    const registry = new FleetJobRegistry(ctx, 'fleet-agent');
    await registry.recoverInterrupted();
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].resume, true);
    assert.equal(notifications[0].metadata.state, 'succeeded');
    assert.equal(storage.get(key).notified, true);
  });

  test('cancellation still reaches the remote job when persistence fails', async () => {
    const { ctx } = harness();
    const pending = deferred();
    const { executor, calls } = fakeExecutor('job-3', pending);
    let failPersistence = false;
    ctx.storage.set = async () => {
      if (failPersistence) throw new Error('disk full');
    };
    const registry = new FleetJobRegistry(ctx, 'fleet-agent', executor);
    const config = loadConfig(workspace);
    await registry.start({
      config,
      host: config.hosts.node,
      sessionID: 'ses_3',
      argv: ['sleep', '10'],
      agentPath: 'fleet-agent',
    });
    failPersistence = true;
    const record = await registry.cancel(config, 'node', 'job-3', 'ses_3');
    assert.equal(calls.cancel, 1);
    assert.equal(record.state, 'cancel-requested');
    await registry.cleanup();
    pending.resolve({ jobId: 'job-3', state: 'cancelled', exitCode: null, signal: 15, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) });
  });
});
