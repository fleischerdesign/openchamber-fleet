import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { JobStore } from '../../dist/jobs/store.js';
import { currentBootTime } from '../../dist/jobs/health.js';

const roots = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function root() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-job-store-'));
  roots.push(value);
  return value;
}

function request(overrides = {}) {
  return {
    version: 1,
    jobId: 'job-aaaaaaaaaaaaaaaaaaaaaaaa',
    sessionID: 'ses_store',
    workspace: 'store',
    directory: '/tmp',
    host: { alias: 'node', ssh: 'test@127.0.0.1', port: 22, root: '/tmp' },
    argv: ['true'],
    env: {},
    agentPath: 'fleet-agent',
    requestedAt: 100,
    ...overrides,
  };
}

function record(overrides = {}) {
  return {
    version: 1,
    jobId: 'job-bbbbbbbbbbbbbbbbbbbbbbbb',
    sessionID: 'ses_store',
    workspace: 'store',
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
    supervisor: { pid: process.pid, instance: 'inst', startedAt: 1, version: 'test' },
    ...overrides,
  };
}

describe('detached job store', () => {
  test('creates private directories and round-trips requests and records', () => {
    const store = new JobStore(root());
    store.ensure();
    assert.equal(fs.statSync(store.root).mode & 0o777, 0o700);

    const value = request();
    store.createRequest(value);
    const claim = store.claimRequest(value.jobId);
    assert.equal(claim.claimed, true);
    assert.deepEqual(claim.value, value);
    assert.equal(store.abortRequest(value.jobId), false);
    store.deleteClaimed(value.jobId);
    assert.equal(store.hasClaimed(value.jobId), false);

    const job = record({ endedAt: 200, state: 'succeeded', exitCode: 0 });
    store.writeJob(job);
    assert.deepEqual(store.readJob(job.jobId), job);
    assert.equal(store.listJobs()[0].jobId, job.jobId);
    assert.equal(fs.statSync(path.join(store.root, 'jobs', `${job.jobId}.json`)).mode & 0o777, 0o600);
  });

  test('abortRequest removes only an unclaimed request', () => {
    const store = new JobStore(root());
    store.ensure();
    store.createRequest(request());
    assert.equal(store.abortRequest('job-aaaaaaaaaaaaaaaaaaaaaaaa'), true);
    assert.equal(store.abortRequest('job-aaaaaaaaaaaaaaaaaaaaaaaa'), false);
  });

  test('a lock is exclusive and carries the boot identity', () => {
    const store = new JobStore(root());
    store.ensure();
    const lock = {
      protocol: 1,
      version: 'test',
      instance: 'one',
      pid: process.pid,
      startedAt: 1,
      bootTime: currentBootTime(),
    };
    assert.equal(store.createLock(lock), true);
    assert.equal(store.createLock({ ...lock, instance: 'two' }), false);
    assert.deepEqual(store.readLock(), lock);
    store.releaseLock('not-the-owner');
    assert.deepEqual(store.readLock(), lock);
    store.releaseLock('one');
    assert.equal(store.readLock(), null);
  });

  test('prunes terminal records after retention but keeps running work', () => {
    const store = new JobStore(root());
    store.ensure();
    const old = Date.now() - 8 * 24 * 60 * 60 * 1000;
    store.writeJob(record({ jobId: 'job-cccccccccccccccccccccccc', state: 'succeeded', startedAt: old, endedAt: old, updatedAt: old }));
    store.writeJob(record({ jobId: 'job-dddddddddddddddddddddddd', state: 'running', startedAt: old, updatedAt: old }));
    assert.equal(store.prune(Date.now()), 1);
    assert.equal(store.readJob('job-cccccccccccccccccccccccc'), null);
    assert.ok(store.readJob('job-dddddddddddddddddddddddd'));
  });

  test('ignores malformed records and discovery files', () => {
    const store = new JobStore(root());
    store.ensure();
    fs.writeFileSync(path.join(store.root, 'jobs', 'job-eeeeeeeeeeeeeeeeeeeeeeee.json'), '{"version":1}');
    fs.writeFileSync(path.join(store.root, 'supervisor.json'), '{"protocol":1}');
    assert.deepEqual(store.listJobs(), []);
    assert.equal(store.readSupervisor(), null);
  });
});
