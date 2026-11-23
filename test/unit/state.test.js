import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, test } from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-state-'));
process.env.FLEET_STATE_DIR = path.join(root, 'state');

const { acquireLease, leaseFile, readLease, readState, recordWorkspace, stateDir, updateState } = await import('../../dist/state.js');

after(() => fs.rmSync(root, { recursive: true, force: true }));

beforeEach(() => {
  fs.rmSync(stateDir(), { recursive: true, force: true });
});

describe('state file (STATE-01…STATE-03)', () => {
  test('defaults to an empty state and creates the directory 0700', () => {
    assert.deepEqual(readState(), { version: 1, workspaces: {} });
    updateState((state) => { state.workspaces['a--b'] = { revision: 'sha256:x' }; });
    assert.equal(fs.statSync(stateDir()).mode & 0o777, 0o700);
    assert.equal(readState().workspaces['a--b'].revision, 'sha256:x');
  });

  test('a corrupt state file is reported, not replaced', () => {
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.writeFileSync(path.join(stateDir(), 'state.json'), '{broken');
    assert.throws(() => readState(), (error) => error.code === 'state-corrupt');
    assert.equal(fs.readFileSync(path.join(stateDir(), 'state.json'), 'utf8'), '{broken');
  });

  test('recordWorkspace merges fields', () => {
    recordWorkspace('a--b', { revision: 'sha256:1' });
    recordWorkspace('a--b', { planDigest: 'sha256:2' });
    assert.deepEqual(readState().workspaces['a--b'], { revision: 'sha256:1', planDigest: 'sha256:2' });
  });
});

describe('leases (STATE-04…STATE-06)', () => {
  test('a second acquire fails while the first is held', () => {
    const lease = acquireLease({ host: 'h', workspace: 'w' });
    assert.throws(() => acquireLease({ host: 'h', workspace: 'w' }), (error) => error.code === 'lease-busy');
    lease.release();
    assert.equal(readLease('h', 'w'), null);
  });

  test('an expired lease with a dead pid is reclaimed', () => {
    const file = leaseFile('h', 'w');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      runId: 'aaaaaaaaaaaa', pid: 999_999, startedAt: '2020-01-01T00:00:00.000Z',
      expiresAt: '2020-01-01T00:00:01.000Z',
    }));
    const lease = acquireLease({ host: 'h', workspace: 'w' });
    assert.notEqual(lease.runId, 'aaaaaaaaaaaa');
    lease.release();
  });

  test('an expired lease with a live pid is not stolen', () => {
    const file = leaseFile('h', 'w');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      runId: 'bbbbbbbbbbbb', pid: process.pid, startedAt: '2020-01-01T00:00:00.000Z',
      expiresAt: '2020-01-01T00:00:01.000Z',
    }));
    assert.throws(() => acquireLease({ host: 'h', workspace: 'w' }), (error) => error.code === 'lease-busy');
  });

  test('release only removes its own lease', () => {
    const lease = acquireLease({ host: 'h', workspace: 'w', runId: 'cccccccccccc' });
    const file = leaseFile('h', 'w');
    fs.writeFileSync(file, JSON.stringify({
      runId: 'dddddddddddd', pid: process.pid, startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }));
    lease.release();
    assert.equal(readLease('h', 'w')?.runId, 'dddddddddddd');
  });
});
