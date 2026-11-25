import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { JobStore } from '../../dist/jobs/store.js';
import { SupervisorCore } from '../../dist/supervisor/core.js';

const roots = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function root() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-supervisor-'));
  roots.push(value);
  return value;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function request(jobId, overrides = {}) {
  return {
    version: 1,
    jobId,
    sessionID: 'ses_core',
    workspace: 'core',
    directory: '/tmp',
    host: { alias: 'node', ssh: 'test@127.0.0.1', port: 22, root: '/tmp' },
    argv: ['true'],
    env: {},
    agentPath: 'fleet-agent',
    requestedAt: 100,
    ...overrides,
  };
}

function record(jobId, overrides = {}) {
  return {
    version: 1,
    jobId,
    sessionID: 'ses_core',
    workspace: 'core',
    directory: '/tmp',
    host: { alias: 'node', ssh: 'test@127.0.0.1', port: 22, root: '/tmp' },
    argv: ['true'],
    state: 'running',
    startedAt: 100,
    updatedAt: 100,
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutTail: '',
    stderrTail: '',
    supervisor: { pid: process.pid, instance: 'old-instance', startedAt: 1, version: 'test' },
    ...overrides,
  };
}

function fakeExecutor(jobId, pending) {
  const calls = { connect: 0, start: 0, cancel: 0, close: 0, clientClose: 0 };
  const client = { close: () => { calls.clientClose += 1; } };
  const handle = {
    jobId,
    result: pending.promise,
    cancel: async () => { calls.cancel += 1; },
    close: () => { calls.close += 1; },
  };
  return {
    calls,
    executor: {
      connect: async () => { calls.connect += 1; return client; },
      start: async () => { calls.start += 1; return handle; },
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('detached supervisor core', () => {
  test('claims a request, runs it, and records the terminal result', async () => {
    const store = new JobStore(root());
    store.ensure();
    const pending = deferred();
    const { calls, executor } = fakeExecutor('remote-1', pending);
    const core = new SupervisorCore({ store, instance: 'inst', startedAt: 1, version: 'test', executor });
    const jobId = 'job-aaaaaaaaaaaaaaaaaaaaaaaa';
    store.createRequest(request(jobId));
    await core.tick();
    await settle();
    assert.equal(calls.start, 1);
    const running = store.readJob(jobId);
    assert.equal(running.state, 'running');
    assert.equal(running.remoteJobId, 'remote-1');
    assert.equal(core.activeCount(), 1);

    pending.resolve({
      jobId: 'remote-1',
      state: 'succeeded',
      exitCode: 0,
      signal: null,
      stdout: Buffer.from('hello'),
      stderr: Buffer.alloc(0),
    });
    await settle();
    const done = store.readJob(jobId);
    assert.equal(done.state, 'succeeded');
    assert.equal(done.exitCode, 0);
    assert.equal(done.stdoutTail, 'hello');
    assert.equal(core.activeCount(), 0);
    assert.ok(calls.close >= 1);
  });

  test('a cancel marker stops a running job and writes the cancelled state', async () => {
    const store = new JobStore(root());
    store.ensure();
    const pending = deferred();
    const { calls, executor } = fakeExecutor('remote-2', pending);
    const core = new SupervisorCore({ store, instance: 'inst', startedAt: 1, version: 'test', executor });
    const jobId = 'job-bbbbbbbbbbbbbbbbbbbbbbbb';
    store.createRequest(request(jobId));
    await core.tick();
    await settle();
    store.writeCancel(jobId);
    await core.tick();
    await settle();
    assert.equal(calls.cancel, 1);
    assert.equal(store.readJob(jobId).state, 'cancel-requested');

    pending.resolve({ jobId: 'remote-2', state: 'cancelled', exitCode: null, signal: 15, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) });
    await settle();
    assert.equal(store.readJob(jobId).state, 'cancelled');
    assert.equal(store.listCancelIds().length, 0);
  });

  test('recovery interrupts old work and pending requests, never resuming them', async () => {
    const store = new JobStore(root());
    store.ensure();
    const jobId = 'job-cccccccccccccccccccccccc';
    store.writeJob(record(jobId, { state: 'running', supervisor: { pid: process.pid, instance: 'old', startedAt: 1, version: 'test' } }));
    const pendingId = 'job-dddddddddddddddddddddddd';
    store.createRequest(request(pendingId));
    const claimedId = 'job-eeeeeeeeeeeeeeeeeeeeeeee';
    store.createRequest(request(claimedId));
    store.claimRequest(claimedId);
    const core = new SupervisorCore({ store, instance: 'new', startedAt: 2, version: 'test', executor: fakeExecutor('unused', deferred()).executor });
    await core.recover();
    assert.equal(store.readJob(jobId).state, 'interrupted');
    assert.equal(store.readJob(pendingId).state, 'interrupted');
    assert.equal(store.readJob(claimedId).state, 'interrupted');
    assert.deepEqual(store.listRequestIds(), []);
    assert.deepEqual(store.listClaimedIds(), []);
  });

  test('queues beyond the active limit and starts the next job when a slot frees', async () => {
    const store = new JobStore(root());
    store.ensure();
    const first = deferred();
    const second = deferred();
    let sequence = 0;
    const handles = [fakeExecutor('remote-a', first), fakeExecutor('remote-b', second)];
    const executor = {
      connect: async () => ({ close: () => {} }),
      start: async () => {
        const value = handles[sequence++];
        return value.executor.start();
      },
    };
    const core = new SupervisorCore({ store, instance: 'inst', startedAt: 1, version: 'test', executor, maxActive: 1 });
    store.createRequest(request('job-eeeeeeeeeeeeeeeeeeeeeeee'));
    store.createRequest(request('job-ffffffffffffffffffffffff', { sessionID: 'ses_second' }));
    await core.tick();
    await settle();
    assert.equal(sequence, 1);
    assert.equal(store.readJob('job-ffffffffffffffffffffffff').state, 'queued');

    first.resolve({ jobId: 'remote-a', state: 'succeeded', exitCode: 0, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) });
    await settle();
    await core.tick();
    await settle();
    assert.equal(sequence, 2);
    assert.equal(store.readJob('job-ffffffffffffffffffffffff').state, 'running');
    second.resolve({ jobId: 'remote-b', state: 'succeeded', exitCode: 0, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) });
    await settle();
  });

  test('shutdown cancels active work and leaves an interrupted record', async () => {
    const store = new JobStore(root());
    store.ensure();
    const pending = deferred();
    const { calls, executor } = fakeExecutor('remote-3', pending);
    const core = new SupervisorCore({ store, instance: 'inst', startedAt: 1, version: 'test', executor });
    const jobId = 'job-999999999999999999999999';
    store.createRequest(request(jobId));
    await core.tick();
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (store.readJob(jobId)?.state === 'running' && core.activeCount() === 1) break;
      await settle();
    }
    assert.equal(core.activeCount(), 1);
    await core.shutdown(50);
    assert.equal(calls.cancel, 1);
    assert.equal(store.readJob(jobId).state, 'interrupted');
    pending.resolve({ jobId: 'remote-3', state: 'succeeded', exitCode: 0, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) });
    await settle();
    assert.equal(store.readJob(jobId).state, 'interrupted');
  });
});
