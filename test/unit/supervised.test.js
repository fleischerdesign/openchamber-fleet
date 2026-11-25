import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { JobStore } from '../../dist/jobs/store.js';
import { currentBootTime } from '../../dist/jobs/health.js';
import { SupervisorCore } from '../../dist/supervisor/core.js';
import { SupervisedJobRegistry } from '../../dist/plugin/supervised.js';

const roots = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function root() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-supervised-'));
  roots.push(value);
  return value;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function discovery(store, overrides = {}) {
  store.writeSupervisor({
    protocol: 1,
    version: 'test',
    instance: 'sup',
    pid: process.pid,
    startedAt: 1,
    bootTime: currentBootTime(),
    updatedAt: Date.now(),
    stateRoot: store.root,
    activeJobs: 0,
    ...overrides,
  });
}

function record(jobId, overrides = {}) {
  return {
    version: 1,
    jobId,
    sessionID: 'ses_test',
    workspace: 'supervised',
    directory: '/tmp/project',
    host: { alias: 'node', ssh: 'test@127.0.0.1', port: 22, root: '/tmp' },
    argv: ['true'],
    state: 'running',
    startedAt: Date.now() - 1000,
    updatedAt: Date.now() - 1000,
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutTail: '',
    stderrTail: '',
    supervisor: { pid: process.pid, instance: 'sup', startedAt: 1, version: 'test' },
    ...overrides,
  };
}

function harness(store, directory = '/tmp/project') {
  const notifications = [];
  const ledger = new Map();
  const ctx = {
    location: { directory },
    session: { synthetic: async (input) => { notifications.push(input); return {}; } },
    storage: {
      get: async (key) => ledger.get(key),
      set: async (key, value) => { ledger.set(key, value); },
    },
  };
  return { ctx, notifications, ledger };
}

function config(name = 'supervised') {
  const host = { alias: 'node', ssh: 'test@127.0.0.1', port: 22, root: '/tmp', tags: [] };
  return {
    name,
    dir: '/tmp/project',
    file: '/tmp/project/fleet.json',
    hosts: { node: host },
    excludes: [],
    env: {},
    shell: 'bash',
    excludeMatcher: { matches: () => false },
  };
}

function startInput(configValue) {
  return {
    config: configValue,
    host: configValue.hosts.node,
    sessionID: 'ses_test',
    argv: ['true'],
    env: {},
    agentPath: 'fleet-agent',
  };
}

function fakeExecutor(jobId, pending) {
  const calls = { cancel: 0, close: 0, start: null };
  const handle = {
    jobId,
    result: pending.promise,
    cancel: async () => { calls.cancel += 1; },
    close: () => { calls.close += 1; },
  };
  return {
    calls,
    executor: {
      connect: async () => ({ close: () => {} }),
      start: async (_client, options) => { calls.start = options; return handle; },
    },
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('supervised Fleet jobs', () => {
  test('notifies a terminal record once and records the delivery ledger', async () => {
    const store = new JobStore(root());
    store.ensure();
    discovery(store);
    const jobId = 'job-aaaaaaaaaaaaaaaaaaaaaaaa';
    store.writeJob(record(jobId, { state: 'succeeded', exitCode: 0, endedAt: Date.now(), stdoutTail: 'ok' }));
    const { ctx, notifications, ledger } = harness(store);
    const registry = new SupervisedJobRegistry(ctx, { store, pollMs: 20 });
    await registry.recover();
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].resume, true);
    assert.equal(notifications[0].metadata.supervised, true);
    assert.match(notifications[0].text, /run: detached supervisor/);
    assert.equal(ledger.size, 1);
    await registry.recover();
    assert.equal(notifications.length, 1);
    registry.cleanup();
  });

  test('tracks a running job and notifies when its record becomes terminal', async () => {
    const store = new JobStore(root());
    store.ensure();
    discovery(store);
    const jobId = 'job-bbbbbbbbbbbbbbbbbbbbbbbb';
    store.writeJob(record(jobId));
    const { ctx, notifications } = harness(store);
    const registry = new SupervisedJobRegistry(ctx, { store, pollMs: 10, graceMs: 20 });
    await registry.recover();
    assert.equal(notifications.length, 0);
    store.writeJob(record(jobId, { state: 'failed', exitCode: 2, endedAt: Date.now(), error: 'nope' }));
    await wait(80);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].resume, true);
    assert.equal(notifications[0].metadata.state, 'failed');
    registry.cleanup();
  });

  test('marks a running job interrupted when no supervisor appears within the grace period', async () => {
    const store = new JobStore(root());
    store.ensure();
    const jobId = 'job-cccccccccccccccccccccccc';
    store.writeJob(record(jobId));
    const { ctx, notifications } = harness(store);
    const registry = new SupervisedJobRegistry(ctx, { store, pollMs: 10, graceMs: 20 });
    await registry.recover();
    await wait(100);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].resume, false);
    assert.equal(notifications[0].metadata.state, 'interrupted');
    assert.equal(store.readJob(jobId).state, 'interrupted');
    registry.cleanup();
  });

  test('starts, inspects and cancels a job through a running supervisor core', async () => {
    const store = new JobStore(root());
    store.ensure();
    discovery(store);
    const pending = deferred();
    const { calls, executor } = fakeExecutor('remote-1', pending);
    const core = new SupervisorCore({ store, instance: 'sup', startedAt: 1, version: 'test', executor });
    const timer = setInterval(() => { void core.tick(); }, 10);
    const configValue = config();
    const { ctx, notifications } = harness(store);
    const registry = new SupervisedJobRegistry(ctx, { store, pollMs: 10, graceMs: 20, startupWaitMs: 100 });
    try {
      const started = await registry.start({ ...startInput(configValue), expectedGeneration: 7 });
      assert.equal(started.supervised, true);
      assert.equal(started.state, 'running');
      assert.equal(calls.start.expectedGeneration, 7);
      assert.equal((await registry.status(started.jobId, 'ses_test')).state, 'running');
      await assert.rejects(
        registry.status(started.jobId, 'ses_other'),
        /another session/,
      );

      const cancelled = await registry.cancel(started.jobId, 'ses_test');
      assert.equal(cancelled.state, 'cancel-requested');
      assert.equal(calls.cancel, 1);
      pending.resolve({ jobId: 'remote-1', state: 'cancelled', exitCode: null, signal: 15, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) });
      await wait(100);
      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].metadata.state, 'cancelled');
    } finally {
      clearInterval(timer);
      registry.cleanup();
      await core.shutdown(0);
    }
  });

  test('watches a job that is still starting when the tool returns', async () => {
    const store = new JobStore(root());
    store.ensure();
    discovery(store);
    const { ctx, notifications } = harness(store);
    let jobId = null;
    const watcher = setInterval(() => {
      for (const id of store.listRequestIds()) {
        const claim = store.claimRequest(id);
        if (!claim.claimed) continue;
        jobId = id;
        store.writeJob(record(id, { state: 'starting', startedAt: Date.now(), updatedAt: Date.now() }));
        store.deleteClaimed(id);
      }
    }, 10);
    const registry = new SupervisedJobRegistry(ctx, {
      store,
      pollMs: 10,
      graceMs: 20,
      startupWaitMs: 100,
      startTimeoutMs: 150,
    });
    try {
      const started = await registry.start(startInput(config()));
      assert.equal(started.state, 'starting');
      assert.ok(jobId);
      store.writeJob(record(jobId, { state: 'succeeded', exitCode: 0, endedAt: Date.now(), stdoutTail: 'late' }));
      await wait(100);
      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].metadata.state, 'succeeded');
      assert.equal(notifications[0].resume, true);
    } finally {
      clearInterval(watcher);
      registry.cleanup();
    }
  });

  test('cancels a job whose session no longer exists', async () => {
    const store = new JobStore(root());
    store.ensure();
    discovery(store);
    const jobId = 'job-999999999999999999999999';
    store.writeJob(record(jobId));
    const { ctx } = harness(store);
    ctx.session.get = async () => { throw new Error('session not found'); };
    const registry = new SupervisedJobRegistry(ctx, { store, pollMs: 10, graceMs: 20 });
    await registry.recover();
    await wait(50);
    assert.deepEqual(store.listCancelIds(), [jobId]);
    registry.cleanup();
  });

  test('a draining supervisor is present but not available for new jobs', async () => {
    const store = new JobStore(root());
    store.ensure();
    discovery(store, { draining: true });
    const { ctx } = harness(store);
    const registry = new SupervisedJobRegistry(ctx, { store, pollMs: 10 });
    assert.equal(await registry.available(0), false);
    discovery(store, { draining: false });
    assert.equal(await registry.available(0), true);
  });

  test('returns null when no supervisor is available, so the caller can fall back', async () => {
    const store = new JobStore(root());
    store.ensure();
    const { ctx } = harness(store);
    const registry = new SupervisedJobRegistry(ctx, { store, startupWaitMs: 0 });
    assert.equal(await registry.start(startInput(config())), null);
    registry.cleanup();
  });

  test('lists only the owning session', async () => {
    const store = new JobStore(root());
    store.ensure();
    store.writeJob(record('job-dddddddddddddddddddddddd', { sessionID: 'ses_test' }));
    store.writeJob(record('job-eeeeeeeeeeeeeeeeeeeeeeee', { sessionID: 'ses_other' }));
    store.writeJob(record('job-ffffffffffffffffffffffff', { sessionID: 'ses_test', directory: '/tmp/other' }));
    const { ctx } = harness(store);
    const registry = new SupervisedJobRegistry(ctx, { store });
    assert.deepEqual((await registry.list('ses_test')).map((job) => job.jobId).sort(), [
      'job-dddddddddddddddddddddddd',
      'job-ffffffffffffffffffffffff',
    ]);
    assert.deepEqual((await registry.list('ses_other')).map((job) => job.jobId), ['job-eeeeeeeeeeeeeeeeeeeeeeee']);
    registry.cleanup();
  });
});
