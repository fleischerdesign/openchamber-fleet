import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { AgentError } from '../../dist/v1/errors.js';
import { connectProcess, openWorkspace, recoverWorkspace } from '../../dist/v1/operations.js';

const binary = process.env.FLEET_AGENT_BIN ?? path.resolve('agent/target/debug/fleet-agent');
const available = fs.existsSync(binary);
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-v1-fail-'));
const state = path.join(base, 'state');
const root = path.join(base, 'replica');
process.env.FLEET_AGENT_STATE_DIR = state;
fs.mkdirSync(state, { recursive: true });
after(() => fs.rmSync(base, { recursive: true, force: true }));

function lease(client, operationId) {
  return client.request('workspace.lease', { workspaceId: 'fail-demo', operationId, ttlMs: 60_000 });
}

describe('two controllers (WS-03)', { skip: !available && `agent binary not built at ${binary}` }, () => {
  test('the second lease is refused and released when the first connection dies', async () => {
    const first = await connectProcess(binary);
    const second = await connectProcess(binary);
    try {
      await openWorkspace(first, 'fail-demo', root, true);
      await openWorkspace(second, 'fail-demo', root, true);
      await lease(first, 'op-first');
      await assert.rejects(lease(second, 'op-second'), (error) => error instanceof AgentError && error.code === 'WORKSPACE_BUSY');

      first.close();
      await new Promise((resolve) => setTimeout(resolve, 150));
      const granted = await lease(second, 'op-second');
      assert.ok(granted.leaseId);
    } finally {
      second.close();
      first.close();
    }
  });
});

describe('recovery after a dead controller (FAIL-01)', { skip: !available && `agent binary not built at ${binary}` }, () => {
  test('an unfinished transaction is reported and can be aborted after a restart', async () => {
    const first = await connectProcess(binary);
    const workspace = await openWorkspace(first, 'fail-demo', root, true);
    const crashLease = await lease(first, 'op-crash');
    const begin = await first.request('sync.begin', {
      workspaceId: 'fail-demo',
      leaseId: crashLease.leaseId,
      baseGeneration: workspace.generation,
      policy: {},
    });
    await first.request('sync.entries', {
      txnId: begin.txnId,
      entries: [{ path: 'x.txt', type: 'file', mode: '0644', size: 1, mtimeMs: 0 }],
    });
    await first.request('sync.plan', { txnId: begin.txnId });
    first.close();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const second = await connectProcess(binary);
    try {
      const reopened = await openWorkspace(second, 'fail-demo', root, true);
      assert.equal(reopened.recovery, true);
      await assert.rejects(lease(second, 'op-after'), (error) => error instanceof AgentError && error.code === 'RECOVERY_REQUIRED');

      const inspected = await second.request('sync.inspect', { workspaceId: 'fail-demo' });
      assert.equal(inspected.state, 'RECOVERY');
      assert.equal(inspected.txnId, begin.txnId);

      const recoveryLease = await second.request('workspace.lease', { workspaceId: 'fail-demo', operationId: 'op-recover', ttlMs: 60_000, recovery: true, txnId: begin.txnId });
      await second.request('sync.abort', { txnId: begin.txnId, leaseId: recoveryLease.leaseId });
      await second.request('workspace.release', { leaseId: recoveryLease.leaseId });
      const status = await second.request('workspace.status', { workspaceId: 'fail-demo' });
      assert.equal(status.recovery, false);
      assert.equal(status.generation, workspace.generation);
      const after = await lease(second, 'op-after');
      assert.ok(after.leaseId);
    } finally {
      second.close();
    }
  });
});

describe('refusals (SYNC-06, SYNC-07, WS-04)', { skip: !available && `agent binary not built at ${binary}` }, () => {
  test('a commit with the wrong plan digest is refused', async () => {
    const client = await connectProcess(binary);
    try {
      const workspace = await openWorkspace(client, 'fail-demo', root, true);
      const planLease = await lease(client, 'op-plan');
      const begin = await client.request('sync.begin', { workspaceId: 'fail-demo', leaseId: planLease.leaseId, baseGeneration: workspace.generation, policy: {} });
      await client.request('sync.entries', { txnId: begin.txnId, entries: [] });
      await client.request('sync.plan', { txnId: begin.txnId });
      await assert.rejects(
        client.request('sync.commit', { txnId: begin.txnId, leaseId: planLease.leaseId, planDigest: 'sha256:' + '0'.repeat(64) }),
        (error) => error instanceof AgentError && error.code === 'PLAN_MISMATCH',
      );
      await client.request('sync.abort', { txnId: begin.txnId, leaseId: planLease.leaseId });
    } finally {
      client.close();
    }
  });

  test('a blob whose bytes do not match its digest is refused', async () => {
    const client = await connectProcess(binary);
    try {
      const workspace = await openWorkspace(client, 'fail-demo', root, true);
      const blobLease = await lease(client, 'op-blob');
      const digest = 'sha256:' + '1'.repeat(64);
      const begin = await client.request('sync.begin', { workspaceId: 'fail-demo', leaseId: blobLease.leaseId, baseGeneration: workspace.generation, policy: {} });
      await client.request('sync.entries', {
        txnId: begin.txnId,
        entries: [{ path: 'blob.txt', type: 'file', mode: '0644', size: 3, mtimeMs: 0, digest }],
      });
      await client.request('sync.plan', { txnId: begin.txnId });
      const put = await client.request('blob.put', { txnId: begin.txnId, digest, size: 3 });
      await assert.rejects(client.upload(put.streamId, Buffer.from('abc')), (error) => error instanceof AgentError && error.code === 'BLOB_CORRUPT');
      await client.request('sync.abort', { txnId: begin.txnId, leaseId: blobLease.leaseId });
    } finally {
      client.close();
    }
  });

  test('exec refuses an unexpected generation', async () => {
    const client = await connectProcess(binary);
    try {
      await openWorkspace(client, 'fail-demo', root, true);
      const genLease = await lease(client, 'op-gen');
      await assert.rejects(
        client.request('exec.start', {
          workspaceId: 'fail-demo',
          leaseId: genLease.leaseId,
          expectedGeneration: 999,
          argv: ['true'],
        }),
        (error) => error instanceof AgentError && error.code === 'GENERATION_MISMATCH',
      );
    } finally {
      client.close();
    }
  });
});

async function stageTransaction(client, workspaceId, rootDir, content) {
  const workspace = await openWorkspace(client, workspaceId, rootDir, true);
  const granted = await client.request('workspace.lease', {
    workspaceId,
    operationId: `op-${workspaceId}`,
    ttlMs: 60_000,
  });
  const lease = granted.leaseId;
  const begin = await client.request('sync.begin', {
    workspaceId,
    leaseId: lease,
    baseGeneration: workspace.generation,
    policy: {},
  });
  const digest = `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
  await client.request('sync.entries', {
    txnId: begin.txnId,
    entries: [{ path: 'file.txt', type: 'file', mode: '0644', size: content.length, mtimeMs: 0, digest }],
  });
  await client.request('sync.plan', { txnId: begin.txnId });
  const put = await client.request('blob.put', { txnId: begin.txnId, digest, size: content.length });
  await client.upload(put.streamId, content);
  return { txnId: begin.txnId, lease };
}

describe('crash during apply (SYNC-08)', { skip: !available && `agent binary not built at ${binary}` }, () => {
  test('a killed agent leaves RECOVERY and a forward recovery commits', async () => {
    const crashRoot = path.join(base, 'crash-replica');
    const content = Buffer.from('crash payload');
    process.env.FLEET_AGENT_FAULT = 'crash:applying';
    let first;
    let txnId;
    let lease;
    try {
      first = await connectProcess(binary);
      ({ txnId, lease } = await stageTransaction(first, 'fail-crash', crashRoot, content));
      const plan = await first.request('sync.inspect', { workspaceId: 'fail-crash' });
      await assert.rejects(first.request('sync.commit', { txnId, leaseId: lease, planDigest: plan.planDigest }));
    } finally {
      first?.close();
      delete process.env.FLEET_AGENT_FAULT;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));

    const second = await connectProcess(binary);
    try {
      const reopened = await openWorkspace(second, 'fail-crash', crashRoot, true);
      assert.equal(reopened.recovery, true);
      const inspected = await second.request('sync.inspect', { workspaceId: 'fail-crash' });
      assert.equal(inspected.state, 'RECOVERY');
      assert.equal(inspected.phase, 'applying');
      await assert.rejects(
        second.request('workspace.lease', { workspaceId: 'fail-crash', operationId: 'op-after', ttlMs: 60_000 }),
        (error) => error instanceof AgentError && error.code === 'RECOVERY_REQUIRED',
      );
      const recoveryLease = await second.request('workspace.lease', { workspaceId: 'fail-crash', operationId: 'op-crash-recover', ttlMs: 60_000, recovery: true, txnId });
      await assert.rejects(
        second.request('sync.abort', { txnId, leaseId: recoveryLease.leaseId }),
        (error) => error instanceof AgentError && error.code === 'RECOVERY_REQUIRED',
      );
      await second.request('workspace.release', { leaseId: recoveryLease.leaseId });
      const resumed = await recoverWorkspace(second, 'fail-crash', crashRoot, 'recover');
      assert.equal(resumed.generation, 1);
      assert.equal(resumed.recovered, true);
      assert.equal(fs.readFileSync(path.join(crashRoot, 'file.txt'), 'utf8'), 'crash payload');
      const lease = await second.request('workspace.lease', { workspaceId: 'fail-crash', operationId: 'op-after', ttlMs: 60_000 });
      assert.ok(lease.leaseId);
    } finally {
      second.close();
    }
  });
});

describe('disk full during apply', { skip: !available && `agent binary not built at ${binary}` }, () => {
  test('a simulated ENOSPC leaves RECOVERY and recovers forward', async () => {
    const fullRoot = path.join(base, 'full-replica');
    const content = Buffer.from('full payload');
    process.env.FLEET_AGENT_FAULT = 'disk-full:applying';
    let first;
    let txnId;
    let lease;
    try {
      first = await connectProcess(binary);
      ({ txnId, lease } = await stageTransaction(first, 'fail-full', fullRoot, content));
      const plan = await first.request('sync.inspect', { workspaceId: 'fail-full' });
      await assert.rejects(
        first.request('sync.commit', { txnId, leaseId: lease, planDigest: plan.planDigest }),
        (error) => error instanceof AgentError && error.code === 'DISK_FULL',
      );
    } finally {
      first?.close();
      delete process.env.FLEET_AGENT_FAULT;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));

    const second = await connectProcess(binary);
    try {
      const reopened = await openWorkspace(second, 'fail-full', fullRoot, true);
      assert.equal(reopened.recovery, true);
      const resumed = await recoverWorkspace(second, 'fail-full', fullRoot, 'recover');
      assert.equal(resumed.generation, 1);
      assert.equal(fs.readFileSync(path.join(fullRoot, 'file.txt'), 'utf8'), 'full payload');
    } finally {
      second.close();
    }
  });
});
