import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { canonicalArtifactTarget, canonicalTransferSource, canonicalTransferTarget, startExecCommand, syncPlanToken, syncWorkspace } from '../../dist/v1/operations.js';

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
      info: { capabilities: { 'workspace.probe': 1, 'workspace.preview': 1 }, agent: { installationId: 'test-agent' } },
      request: async (method, params) => {
        calls.push([method, params]);
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
      mode: 'apply',
      signal: controller.signal,
    });
    for (let attempt = 0; attempt < 20 && !calls.some(([method]) => method === 'sync.begin'); attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.ok(calls.some(([method]) => method === 'sync.begin'));
    controller.abort();
    beginResolve({ txnId: 'txn-1' });
    await assert.rejects(operation, /cancelled/);
    for (let attempt = 0; attempt < 20 && !calls.some(([method]) => method === 'sync.abort'); attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.ok(calls.some(([method, params]) => method === 'sync.abort' && params.txnId === 'txn-1' && typeof params.leaseId === 'string'));
  });
});

describe('transfer path policy', () => {
  test('rejects a symlinked source and a symlinked destination parent', () => {
    const real = path.join(base, 'real-file.txt');
    const link = path.join(base, 'link-file.txt');
    fs.writeFileSync(real, 'payload');
    fs.symlinkSync(real, link);
    assert.throws(() => canonicalTransferSource(link), /symlink/);
    const outside = path.join(base, 'outside-dir');
    fs.mkdirSync(outside, { recursive: true });
    const parent = path.join(base, 'linked-parent');
    fs.symlinkSync(outside, parent);
    assert.throws(() => canonicalTransferTarget(path.join(parent, 'out.txt')), /symlink/);
  });
});

describe('plan approval binding', () => {
  const baseToken = {
    workspaceId: 'workspace',
    source: '/local/source',
    root: '/replica',
    generation: 4,
    excludes: ['.git'],
    planDigest: 'sha256:plan',
    changes: [{ action: 'update', path: 'src/app.txt' }],
    needed: ['sha256:blob'],
    hostIdentity: 'u@host:22',
    agentIdentity: 'agent-1',
    sourceDigest: 'sha256:source',
    resolvedRoot: '/srv/replica',
    baseManifestDigest: 'sha256:base',
    baseState: 'READY',
  };

  test('binds host, agent, source content and the plan', () => {
    const token = syncPlanToken(baseToken);
    assert.notEqual(syncPlanToken({ ...baseToken, hostIdentity: 'u@other:22' }), token);
    assert.notEqual(syncPlanToken({ ...baseToken, agentIdentity: 'agent-2' }), token);
    assert.notEqual(syncPlanToken({ ...baseToken, sourceDigest: 'sha256:other' }), token);
    assert.notEqual(syncPlanToken({ ...baseToken, generation: 5 }), token);
    assert.notEqual(syncPlanToken({ ...baseToken, resolvedRoot: '/srv/other' }), token);
    assert.notEqual(syncPlanToken({ ...baseToken, baseManifestDigest: 'sha256:other-base' }), token);
    assert.notEqual(syncPlanToken({ ...baseToken, baseState: 'ABSENT' }), token);
    assert.equal(syncPlanToken({ ...baseToken, needed: ['sha256:different-cache-state'] }), token);
  });
});

describe('read-only planning', () => {
  test('plan on an absent replica previews without provisioning or a journal', async () => {
    const source = path.join(base, 'empty-source');
    fs.mkdirSync(source);
    const calls = [];
    const client = {
      info: { capabilities: { 'workspace.probe': 1, 'workspace.preview': 1 }, agent: { installationId: 'test-agent' } },
      request: async (method, params) => {
        calls.push([method, params]);
        if (method === 'sync.previewBegin') return { txnId: 'preview-1', generation: 0, state: 'ABSENT' };
        if (method === 'sync.previewEntries') return { accepted: true };
        if (method === 'sync.previewPlan') return { planDigest: 'sha256:plan', changes: 0, needed: 0 };
        if (method === 'sync.previewPage') return { items: [], total: 0, offset: 0 };
        if (method === 'sync.previewEnd') return { ok: true };
        throw new Error(`unexpected ${method}`);
      },
      close: () => {},
    };
    const result = await syncWorkspace(client, { matches: () => false }, {
      workspaceId: 'absent-plan',
      source,
      root: '/replica',
      excludes: [],
      mode: 'plan',
    });
    assert.equal(result.changes.length, 0);
    assert.ok(result.planToken);
    const methods = calls.map(([method]) => method);
    assert.deepEqual(methods, [
      'sync.previewBegin',
      'sync.previewPlan',
      'sync.previewPage',
      'sync.previewPage',
      'sync.previewEnd',
    ]);
    assert.equal(methods.includes('workspace.open'), false);
    assert.equal(methods.includes('sync.begin'), false);
  });

  test('a token from one resolved root is stale for another root', async () => {
    const source = path.join(base, 'root-token-source');
    fs.mkdirSync(source);
    let resolved = '/replica-a';
    let sequence = 0;
    const calls = [];
    const client = {
      info: { capabilities: { 'workspace.probe': 1, 'workspace.preview': 1 }, agent: { installationId: 'test-agent' } },
      request: async (method, params) => {
        calls.push([method, params]);
        if (method === 'sync.previewBegin') {
          sequence += 1;
          return { txnId: `preview-${sequence}`, generation: 0, state: 'ABSENT', root: resolved, manifestDigest: 'sha256:base' };
        }
        if (method === 'sync.previewEntries') return { accepted: true };
        if (method === 'sync.previewPlan') return { planDigest: 'sha256:plan', changes: 0, needed: 0 };
        if (method === 'sync.previewPage') return { items: [], total: 0, offset: 0 };
        if (method === 'sync.previewEnd') return { ok: true };
        if (method === 'workspace.open') return { generation: 0, manifestDigest: 'sha256:base', recovery: false, root: resolved, state: 'ABSENT' };
        throw new Error(`unexpected ${method}`);
      },
      close: () => {},
    };
    const planned = await syncWorkspace(client, { matches: () => false }, {
      workspaceId: 'root-token',
      source,
      root: '/configured-root',
      excludes: [],
      mode: 'plan',
    });
    resolved = '/replica-b';
    const before = calls.filter(([method]) => method === 'workspace.open').length;
    await assert.rejects(syncWorkspace(client, { matches: () => false }, {
      workspaceId: 'root-token',
      source,
      root: '/configured-root',
      excludes: [],
      mode: 'apply',
      planToken: planned.planToken,
    }), (error) => error.code === 'PLAN_STALE');
    assert.equal(calls.filter(([method]) => method === 'workspace.open').length, before);
  });

  test('a stale apply is refused before workspace.open can provision', async () => {
    const source = path.join(base, 'stale-source');
    fs.mkdirSync(source);
    const calls = [];
    const client = {
      info: { capabilities: { 'workspace.probe': 1, 'workspace.preview': 1 }, agent: { installationId: 'test-agent' } },
      request: async (method, params) => {
        calls.push([method, params]);
        if (method === 'sync.previewBegin') return { txnId: 'preview-stale', generation: 0, state: 'ABSENT' };
        if (method === 'sync.previewEntries') return { accepted: true };
        if (method === 'sync.previewPlan') return { planDigest: 'sha256:plan', changes: 0, needed: 0 };
        if (method === 'sync.previewPage') return { items: [], total: 0, offset: 0 };
        if (method === 'sync.previewEnd') return { ok: true };
        if (method === 'workspace.open') return { generation: 0, manifestDigest: '', recovery: false };
        throw new Error(`unexpected ${method}`);
      },
      close: () => {},
    };
    await assert.rejects(syncWorkspace(client, { matches: () => false }, {
      workspaceId: 'stale-apply',
      source,
      root: '/replica',
      excludes: [],
      mode: 'apply',
      planToken: 'sha256:not-the-plan',
    }), (error) => error.code === 'PLAN_STALE');
    assert.equal(calls.some(([method]) => method === 'workspace.open'), false);
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
