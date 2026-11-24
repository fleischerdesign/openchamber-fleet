import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { compileExcludes } from '../../dist/config.js';
import { connectProcess, execCommand, fetchArtifact, startExecCommand, syncWorkspace } from '../../dist/v1/operations.js';

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
