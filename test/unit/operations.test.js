import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { canonicalArtifactTarget } from '../../dist/v1/operations.js';
import { startExecCommand } from '../../dist/v1/operations.js';

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

describe('exec failure cleanup', () => {
  test('a stream failure cancels the remote job before releasing the lease', async () => {
    const calls = [];
    const client = {
      closed: false,
      request: async (method, params) => {
        calls.push(method);
        if (method === 'workspace.open') return { generation: 1, manifestDigest: 'sha256:x', recovery: false };
        if (method === 'workspace.lease') return { leaseId: 'lease' };
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
