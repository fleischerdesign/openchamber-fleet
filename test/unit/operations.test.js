import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { canonicalArtifactTarget, startExecCommand, syncWorkspace } from '../../dist/v1/operations.js';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-operations-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));

describe('local artifact targets', () => {
  test('resolves destination symlinks before authorization and writing', () => {
    const workspace = path.join(base, 'workspace');
    const outside = path.join(base, 'outside');
    fs.mkdirSync(workspace);
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(workspace, 'link'));
    assert.equal(canonicalArtifactTarget(path.join(workspace, 'link'), 'out.txt'), path.join(outside, 'out.txt'));
  });

  test('rejects a dangling destination symlink', () => {
    const workspace = path.join(base, 'dangling');
    fs.mkdirSync(workspace);
    fs.symlinkSync(path.join(base, 'missing'), path.join(workspace, 'link'));
    assert.throws(() => canonicalArtifactTarget(path.join(workspace, 'link'), 'out.txt'), /dangling symlink/);
  });
});

describe('sync cancellation cleanup', () => {
  test('abort during sync.begin waits for the transaction id and aborts it', async () => {
    const source = path.join(base, 'sync-source');
    fs.mkdirSync(source);
    const controller = new AbortController();
    let beginResolve;
    const begin = new Promise((resolve) => { beginResolve = resolve; });
    const calls = [];
    const client = {
      info: { capabilities: { 'workspace.probe': 1 } },
      request: async (method, params) => {
        calls.push([method, params]);
        if (method === 'workspace.probe') return { state: 'READY', generation: 1, manifestDigest: 'sha256:x', recovery: false, root: '/replica' };
        if (method === 'workspace.open') return { generation: 1, manifestDigest: 'sha256:x', recovery: false };
        if (method === 'workspace.lease') return { leaseId: 'lease', generation: 1 };
        if (method === 'sync.begin') return begin;
        if (method === 'sync.abort') return { ok: true };
        if (method === 'workspace.release') return { ok: true };
        throw new Error(`unexpected ${method}`);
      },
      close: () => {},
    };
    const operation = syncWorkspace(client, { matches: () => false }, {
      workspaceId: 'workspace',
      source,
      root: '/replica',
      excludes: [],
      mode: 'plan',
      signal: controller.signal,
    });
    for (let attempt = 0; attempt < 20 && !calls.some(([method]) => method === 'sync.begin'); attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.ok(calls.some(([method]) => method === 'sync.begin'));
    controller.abort();
    beginResolve({ txnId: 'txn-1' });
    await assert.rejects(operation, /cancelled/);
    assert.ok(calls.some(([method, params]) => method === 'sync.abort' && params.txnId === 'txn-1'));
  });
});

describe('read-only planning', () => {
  test('plan on an absent replica probes and refuses without provisioning', async () => {
    const calls = [];
    const client = {
      info: { capabilities: { 'workspace.probe': 1 } },
      request: async (method, params) => {
        calls.push([method, params]);
        if (method === 'workspace.probe') {
          return { state: 'ABSENT', generation: 0, manifestDigest: '', recovery: false, root: '/replica' };
        }
        throw new Error(`unexpected ${method}`);
      },
      close: () => {},
    };
    await assert.rejects(syncWorkspace(client, { matches: () => false }, {
      workspaceId: 'absent-plan',
      source: base,
      root: '/replica',
      excludes: [],
      mode: 'plan',
    }), /does not exist yet/);
    assert.deepEqual(calls.map(([method]) => method), ['workspace.probe']);
  });
});

describe('exec failure cleanup', () => {
  test('a stream failure cancels the remote job before releasing the lease', async () => {
    const calls = [];
    const client = {
      closed: false,
      request: async (method, params) => {
        calls.push(method);
        if (method === 'workspace.probe') return { state: 'READY', generation: 1, manifestDigest: 'sha256:x', recovery: false, root: '/replica' };
        if (method === 'workspace.open') return { generation: 1, manifestDigest: 'sha256:x', recovery: false };
        if (method === 'workspace.lease') return { leaseId: 'lease', generation: 1 };
        if (method === 'exec.start') return { jobId: 'job-1', stdoutStream: 1, stderrStream: 2 };
        if (method === 'exec.cancel') {
          assert.equal(client.closed, false);
          return { accepted: true };
        }
        if (method === 'workspace.release') return { ok: true };
        throw new Error(`unexpected ${method}`);
      },
      collect: async () => { throw new Error('stream failed'); },
      close: () => { client.closed = true; },
    };
    const handle = await startExecCommand(client, {
      workspaceId: 'workspace',
      root: '/replica',
      argv: ['sleep', '5'],
    });
    await assert.rejects(handle.result, /stream failed/);
    assert.ok(calls.indexOf('exec.cancel') >= 0);
    assert.ok(calls.indexOf('exec.cancel') < calls.indexOf('workspace.release'));
  });
});
