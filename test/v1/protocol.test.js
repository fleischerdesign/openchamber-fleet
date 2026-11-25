import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { compileExcludes } from '../../dist/config.js';
import {
  connectProcess,
  downloadFile,
  execCommand,
  fetchArtifact,
  probeWorkspace,
  startExecCommand,
  status,
  syncWorkspace,
  uploadFile,
} from '../../dist/v1/operations.js';

const binary = process.env.FLEET_AGENT_BIN ?? path.resolve('agent/target/debug/fleet-agent');
const available = fs.existsSync(binary);
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-v1-'));
const source = path.join(base, 'source');
const replica = path.join(base, 'replica');
const state = path.join(base, 'state');

process.env.FLEET_AGENT_STATE_DIR = state;
fs.mkdirSync(source, { recursive: true });
fs.mkdirSync(state, { recursive: true });
fs.writeFileSync(path.join(source, 'fleet.json'), JSON.stringify({ name: 'v1-test' }));
fs.mkdirSync(path.join(source, 'src'), { recursive: true });
fs.writeFileSync(path.join(source, 'src/app.txt'), 'hello v1\n');
fs.mkdirSync(path.join(source, 'target'), { recursive: true });
fs.writeFileSync(path.join(source, 'target/build.bin'), 'excluded\n');

const matcher = compileExcludes(['target/']);
let client;

before(async () => {
  if (!available) return;
  client = await connectProcess(binary);
});
after(async () => {
  client?.close();
  fs.rmSync(base, { recursive: true, force: true });
});

describe('fleet.agent.v1 controller', { skip: !available && `agent binary not built at ${binary}` }, () => {
  test('syncs a workspace over the protocol', async () => {
    const result = await syncWorkspace(client, matcher, {
      workspaceId: 'v1-test',
      source,
      root: replica,
      excludes: ['target/'],
      mode: 'apply',
    });
    assert.ok(result.changes.some((change) => change.path === 'src/app.txt'));
    assert.equal(fs.readFileSync(path.join(replica, 'src/app.txt'), 'utf8'), 'hello v1\n');
    assert.equal(fs.existsSync(path.join(replica, 'target/build.bin')), false);

    const second = await syncWorkspace(client, matcher, {
      workspaceId: 'v1-test',
      source,
      root: replica,
      excludes: ['target/'],
      mode: 'plan',
    });
    assert.deepEqual(second.changes, []);

    const noop = await syncWorkspace(client, matcher, {
      workspaceId: 'v1-test',
      source,
      root: replica,
      excludes: ['target/'],
      mode: 'apply',
    });
    assert.deepEqual(noop.changes, []);
    assert.equal(noop.generation, result.generation, 'a no-op apply must not bump the generation');
  });

  test('batches a manifest larger than one control frame', async () => {
    const many = path.join(base, 'many-source');
    const manyReplica = path.join(base, 'many-replica');
    fs.mkdirSync(many, { recursive: true });
    const prefix = 'x'.repeat(180);
    for (let index = 0; index < 450; index += 1) {
      fs.writeFileSync(path.join(many, `${prefix}-${String(index).padStart(4, '0')}.txt`), `${index}\n`);
    }
    const result = await syncWorkspace(client, compileExcludes([]), {
      workspaceId: 'v1-many',
      source: many,
      root: manyReplica,
      excludes: [],
      mode: 'apply',
    });
    assert.equal(result.changes.length, 450);
    assert.equal(fs.existsSync(path.join(manyReplica, `${prefix}-0449.txt`)), true);
  });

  test('plan previews an absent replica without creating root or state', async () => {
    const previewRoot = path.join(base, 'preview-replica');
    const result = await syncWorkspace(client, matcher, {
      workspaceId: 'v1-preview',
      source,
      root: previewRoot,
      excludes: ['target/'],
      mode: 'plan',
    });
    assert.ok(result.changes.some((change) => change.path === 'src/app.txt'));
    assert.ok(result.planToken);
    assert.equal(fs.existsSync(previewRoot), false);
    assert.equal(fs.existsSync(path.join(state, 'v1-preview')), false);
  });

  test('syncs a file larger than one DATA frame', async () => {
    const bigSource = path.join(base, 'big-source');
    const bigReplica = path.join(base, 'big-replica');
    fs.mkdirSync(bigSource, { recursive: true });
    const big = crypto.randomBytes(5 * 1024 * 1024);
    fs.writeFileSync(path.join(bigSource, 'big.bin'), big);
    const result = await syncWorkspace(client, compileExcludes([]), {
      workspaceId: 'v1-big',
      source: bigSource,
      root: bigReplica,
      excludes: [],
      mode: 'apply',
    });
    assert.ok(result.changes.some((change) => change.path === 'big.bin'));
    assert.equal(fs.readFileSync(path.join(bigReplica, 'big.bin')).length, big.length);
  });

  test('plan refuses adopt before changing an existing directory', async () => {
    const root = path.join(base, 'adopt-replica');
    fs.mkdirSync(root, { recursive: true, mode: 0o755 });
    fs.chmodSync(root, 0o755);
    await assert.rejects(syncWorkspace(client, matcher, {
      workspaceId: 'v1-test',
      source,
      root,
      excludes: ['target/'],
      mode: 'plan',
      adopt: true,
    }), /adopt is only valid/);
    assert.equal(fs.statSync(root).mode & 0o777, 0o755);
  });

  test('executes in the replica and streams output', async () => {
    const result = await execCommand(client, {
      workspaceId: 'v1-test',
      source,
      root: replica,
      argv: ['sh', '-c', 'cat src/app.txt; printf err >&2; exit 3'],
      timeoutMs: 30_000,
    });
    assert.equal(result.state, 'failed');
    assert.equal(result.exitCode, 3);
    assert.equal(result.stdout.toString(), 'hello v1\n');
    assert.equal(result.stderr.toString(), 'err');
  });

  test('starts a background exec, reports progress and cancels it through the protocol', async () => {
    const progress = [];
    const backgroundClient = await connectProcess(binary);
    const handle = await startExecCommand(backgroundClient, {
      workspaceId: 'v1-test',
      root: replica,
      argv: ['sh', '-c', 'printf started; sleep 5'],
      timeoutMs: 30_000,
      onProgress: (update) => progress.push(update),
    });
    try {
      assert.ok(handle.jobId);
      await handle.cancel(100);
      const result = await handle.result;
      assert.equal(result.state, 'cancelled');
      assert.ok(progress.some((update) => update.phase === 'starting'));
      assert.ok(progress.some((update) => update.phase === 'done'));
    } finally {
      handle.close();
    }
  });

  test('closing the agent session terminates its running job', async () => {
    const marker = path.join(base, 'leaked-marker');
    fs.rmSync(marker, { force: true });
    const connection = await connectProcess(binary);
    const handle = await startExecCommand(connection, {
      workspaceId: 'v1-test',
      root: replica,
      argv: ['sh', '-c', `sleep 2; printf leaked > ${JSON.stringify(marker)}`],
      timeoutMs: 30_000,
    });
    const settled = handle.result.catch(() => {});
    await connection.request('session.shutdown', {});
    await settled;
    await new Promise((resolve) => setTimeout(resolve, 2500));
    assert.equal(fs.existsSync(marker), false, 'the remote process group outlived its agent session');
  });

  test('fetches an artifact with digest verification', async () => {
    await execCommand(client, {
      workspaceId: 'v1-test',
      source,
      root: replica,
      argv: ['sh', '-c', 'printf artifact > out.txt'],
      timeoutMs: 30_000,
    });
    const dest = path.join(base, 'download');
    const fetched = await fetchArtifact(client, {
      workspaceId: 'v1-test',
      source,
      root: replica,
      artifact: 'out.txt',
      dest,
    });
    assert.equal(fs.readFileSync(fetched.file, 'utf8'), 'artifact');
    assert.match(fetched.digest, /^sha256:[0-9a-f]{64}$/);
  });

  test('probe is read-only and distinguishes an absent workspace', async () => {
    const absentRoot = path.join(base, 'absent-replica');
    const probe = await probeWorkspace(client, 'v1-absent', absentRoot);
    assert.equal(probe.state, 'ABSENT');
    assert.equal(fs.existsSync(absentRoot), false);
    const info = await status(client, 'v1-absent', absentRoot);
    assert.equal(info.generation, 0);
    assert.equal(info.recovery, false);
    assert.equal(fs.existsSync(absentRoot), false);
  });

  test('round-trips one file through the scratch transfer path', async () => {
    const transferRoot = path.join(base, 'transfer-replica');
    const local = path.join(base, 'upload.txt');
    const downloaded = path.join(base, 'download.txt');
    fs.writeFileSync(local, 'transfer payload\n');
    const uploaded = await uploadFile(client, {
      workspaceId: 'v1-transfer',
      root: transferRoot,
      path: 'upload.txt',
      source: local,
    });
    assert.equal(uploaded.bytes, 17);
    assert.match(uploaded.digest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(fs.readFileSync(path.join(transferRoot, 'upload.txt'), 'utf8'), 'transfer payload\n');

    await assert.rejects(uploadFile(client, {
      workspaceId: 'v1-transfer',
      root: transferRoot,
      path: 'upload.txt',
      source: local,
    }), (error) => error.code === 'DEST_EXISTS');

    const fetched = await downloadFile(client, {
      workspaceId: 'v1-transfer',
      root: transferRoot,
      path: 'upload.txt',
      dest: downloaded,
    });
    assert.equal(fs.readFileSync(fetched.file, 'utf8'), 'transfer payload\n');
    assert.equal(fetched.digest, uploaded.digest);
    await assert.rejects(downloadFile(client, {
      workspaceId: 'v1-transfer',
      root: transferRoot,
      path: 'upload.txt',
      dest: downloaded,
    }), /exists/i);
  });

  test('serializes concurrent root reservations across agent processes', async () => {
    const first = await connectProcess(binary);
    const second = await connectProcess(binary);
    const root = path.join(base, 'concurrent-root-replica');
    try {
      const results = await Promise.allSettled([
        first.request('workspace.open', { workspaceId: 'concurrent-a', root, adopt: false }),
        second.request('workspace.open', { workspaceId: 'concurrent-b', root, adopt: false }),
      ]);
      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter((result) => result.status === 'rejected');
      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 1);
      assert.equal(rejected[0].reason.code, 'WORKSPACE_ROOT_CONFLICT');
    } finally {
      first.close();
      second.close();
    }
  });

  test('refuses a nested replica root beneath an existing workspace', async () => {
    const parent = path.join(base, 'nested-root-replica');
    const child = path.join(parent, 'child');
    await client.request('workspace.open', { workspaceId: 'nested-parent', root: parent, adopt: false });
    await assert.rejects(
      client.request('workspace.open', { workspaceId: 'nested-child', root: child, adopt: false }),
      (error) => error.code === 'WORKSPACE_ROOT_CONFLICT',
    );
  });

  test('refuses to bind one replica root to two workspace ids', async () => {
    const root = path.join(base, 'root-conflict-replica');
    await client.request('workspace.open', { workspaceId: 'root-conflict-a', root, adopt: false });
    await assert.rejects(
      client.request('workspace.open', { workspaceId: 'root-conflict-b', root, adopt: false }),
      (error) => error.code === 'WORKSPACE_ROOT_CONFLICT',
    );
  });

  test('rejects a changed expected root before provisioning', async () => {
    const root = path.join(base, 'expected-root-replica');
    await assert.rejects(
      client.request('workspace.open', {
        workspaceId: 'expected-root',
        root,
        expectedRoot: path.join(base, 'different-root'),
        expectedState: 'ABSENT',
        expectedManifestDigest: 'sha256:' + '0'.repeat(64),
      }),
      (error) => error.code === 'PLAN_STALE',
    );
    assert.equal(fs.existsSync(root), false);
    assert.equal(fs.existsSync(path.join(state, 'expected-root')), false);
  });

  test('read-only open never creates an absent workspace', async () => {
    const root = path.join(base, 'readonly-absent-replica');
    const opened = await client.request('workspace.open', { workspaceId: 'readonly-absent', root, readOnly: true });
    assert.equal(opened.absent, true);
    assert.equal(fs.existsSync(root), false);
    assert.equal(fs.existsSync(path.join(state, 'readonly-absent')), false);
  });

  test('binds a lease to the workspace that acquired it', async () => {
    await client.request('workspace.open', {
      workspaceId: 'v1-transfer',
      root: path.join(base, 'transfer-replica'),
      adopt: false,
    });
    const lease = await client.request('workspace.lease', {
      workspaceId: 'v1-test',
      operationId: 'cross-workspace-lease',
      ttlMs: 60_000,
    });
    try {
      await assert.rejects(client.request('exec.start', {
        workspaceId: 'v1-transfer',
        leaseId: lease.leaseId,
        expectedGeneration: 0,
        argv: ['true'],
      }), (error) => error.code === 'LEASE_MISMATCH');
    } finally {
      await client.request('workspace.release', { leaseId: lease.leaseId });
    }
  });

  test('an apply only accepts the plan token it was given', async () => {
    const applySource = path.join(base, 'token-source');
    const applyReplica = path.join(base, 'token-replica');
    fs.mkdirSync(applySource, { recursive: true });
    fs.writeFileSync(path.join(applySource, 'file.txt'), 'first\n');
    await syncWorkspace(client, compileExcludes([]), {
      workspaceId: 'v1-token',
      source: applySource,
      root: applyReplica,
      excludes: [],
      mode: 'apply',
    });
    fs.writeFileSync(path.join(applySource, 'file.txt'), 'second\n');
    const planned = await syncWorkspace(client, compileExcludes([]), {
      workspaceId: 'v1-token',
      source: applySource,
      root: applyReplica,
      excludes: [],
      mode: 'plan',
    });
    assert.ok(planned.planToken);
    fs.writeFileSync(path.join(applySource, 'file.txt'), 'third\n');
    await assert.rejects(syncWorkspace(client, compileExcludes([]), {
      workspaceId: 'v1-token',
      source: applySource,
      root: applyReplica,
      excludes: [],
      mode: 'apply',
      planToken: planned.planToken,
    }), (error) => error.code === 'PLAN_STALE');
  });

  test('refuses a transfer through an intermediate symlink', async () => {
    const outside = path.join(base, 'outside-secret');
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'do not leak');
    fs.symlinkSync(outside, path.join(replica, 'leak'));
    await assert.rejects(downloadFile(client, {
      workspaceId: 'v1-test',
      root: replica,
      path: 'leak/secret.txt',
      dest: path.join(base, 'leaked.txt'),
    }), (error) => error.code === 'PATH_UNSAFE');
  });

  test('refuses cwd escapes and transfer path traversal', async () => {
    await assert.rejects(execCommand(client, {
      workspaceId: 'v1-test',
      root: replica,
      argv: ['true'],
      cwd: '..',
    }), /PATH_UNSAFE|unsafe path|escape/i);
    const local = path.join(base, 'traversal.txt');
    fs.writeFileSync(local, 'x');
    await assert.rejects(uploadFile(client, {
      workspaceId: 'v1-test',
      root: replica,
      path: '../escape.txt',
      source: local,
    }), /PATH_UNSAFE|unsafe path|escape/i);
  });
});

describe('large artifact', { skip: !available && `agent binary not built at ${binary}` }, () => {
  test('fetches a multi-frame artifact with digest verification', async () => {
    await syncWorkspace(client, matcher, {
      workspaceId: 'v1-test',
      source,
      root: replica,
      excludes: ['target/'],
      mode: 'apply',
      adopt: true,
    });
    const big = crypto.randomBytes(5 * 1024 * 1024);
    fs.writeFileSync(path.join(replica, 'big.bin'), big);
    const fetched = await fetchArtifact(client, {
      workspaceId: 'v1-test',
      root: replica,
      artifact: 'big.bin',
      dest: path.join(base, 'download-big'),
    });
    assert.equal(fs.readFileSync(fetched.file).length, big.length);
    assert.match(fetched.digest, /^sha256:[0-9a-f]{64}$/);
  });
});
