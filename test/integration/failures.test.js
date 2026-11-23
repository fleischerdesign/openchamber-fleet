import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, beforeEach, describe, test } from 'node:test';
import { loadConfig } from '../../dist/config.js';
import { execRemote } from '../../dist/exec.js';
import { applyWorkspace, planWorkspace } from '../../dist/sync.js';
import { fetchArtifacts } from '../../dist/fetch.js';
import { readState } from '../../dist/state.js';
import { cleanup, makeWorkspace, writeFile } from '../fixtures/harness.mjs';

const workspace = makeWorkspace({ name: 'failure-tests', files: { 'a.txt': 'a\n' } });
const config = loadConfig(workspace.source);
const host = config.hosts.node;
after(() => cleanup(workspace));

const originalPath = process.env.PATH;
beforeEach(() => {
  delete process.env.FAKE_SSH_FAIL;
  process.env.PATH = originalPath;
});

describe('transport failures (SEC-01…SEC-03)', () => {
  test('an unreachable node is a named failure', async () => {
    process.env.FAKE_SSH_FAIL = 'refused';
    await assert.rejects(planWorkspace(config, host), (error) => error.code === 'node-unreachable');
  });

  test('a changed host key is a hard failure, not a warning', async () => {
    process.env.FAKE_SSH_FAIL = 'hostkey';
    await assert.rejects(planWorkspace(config, host), (error) => error.code === 'host-key-mismatch');
  });

  test('failed authentication is classified', async () => {
    process.env.FAKE_SSH_FAIL = 'auth';
    await assert.rejects(planWorkspace(config, host), (error) => error.code === 'ssh-auth-failed');
  });

  test('exec on an unreachable node reports the transport, not a command failure', async () => {
    process.env.FAKE_SSH_FAIL = 'refused';
    await assert.rejects(
      execRemote({ config, host, argv: ['true'], allowStale: true }),
      (error) => error.code === 'node-unreachable',
    );
  });
});

describe('sync failures leave no false state (STATE-07, SYNC-26, SYNC-27)', () => {
  function withFailingRsync(exitCode, script) {
    const dir = fs.mkdtempSync(path.join(workspace.root, 'shim-'));
    const shim = path.join(dir, 'rsync');
    fs.writeFileSync(shim, script);
    fs.chmodSync(shim, 0o755);
    process.env.PATH = `${dir}:${originalPath}`;
    return exitCode;
  }

  test('a failing rsync is sync-failed and records nothing', async () => {
    withFailingRsync(23, '#!/bin/sh\necho "rsync: simulated failure" >&2\nexit 23\n');
    await assert.rejects(applyWorkspace(config, host), (error) => error.code === 'sync-failed');
    assert.equal(readState().workspaces['node--failure-tests'], undefined);
  });

  test('a disk-full exit is sync-failed', async () => {
    withFailingRsync(11, '#!/bin/sh\necho "No space left on device" >&2\nexit 11\n');
    await assert.rejects(applyWorkspace(config, host), (error) => error.code === 'sync-failed');
  });

  test('an interrupted transfer cannot mark the replica current', async () => {
    withFailingRsync(1, '#!/bin/sh\necho partial >&2\nexit 1\n');
    await assert.rejects(applyWorkspace(config, host), (error) => error.code === 'sync-failed');
    assert.equal(readState().workspaces['node--failure-tests']?.revision, undefined);
  });
});

describe('fetch safety (FETCH-03…FETCH-05, SEC-04)', () => {
  beforeEach(async () => {
    process.env.PATH = originalPath;
    await applyWorkspace(config, host);
  });

  test('rejects traversal and absolute paths before any transfer', async () => {
    await assert.rejects(
      fetchArtifacts({ config, host, paths: ['../secret'], dest: path.join(workspace.root, 'out1') }),
      (error) => error.code === 'usage',
    );
    await assert.rejects(
      fetchArtifacts({ config, host, paths: ['/etc/passwd'], dest: path.join(workspace.root, 'out2') }),
      (error) => error.code === 'usage',
    );
  });

  test('refuses to overwrite an existing destination', async () => {
    const dest = path.join(workspace.root, 'out3');
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'a.txt'), 'old');
    await assert.rejects(
      fetchArtifacts({ config, host, paths: ['a.txt'], dest }),
      (error) => error.code === 'artifact-missing',
    );
  });

  test('does not follow a symlink that leaves the replica (FETCH-05)', async () => {
    fs.symlinkSync('/etc/passwd', path.join(workspace.replica, 'escape'));
    const dest = path.join(workspace.root, 'out4');
    await assert.rejects(
      fetchArtifacts({ config, host, paths: ['escape'], dest }),
      (error) => error.code === 'artifact-missing',
    );
    assert.equal(fs.existsSync(path.join(dest, 'escape')), false);
  });

  test('a missing artifact is named', async () => {
    await assert.rejects(
      fetchArtifacts({ config, host, paths: ['nope.bin'], dest: path.join(workspace.root, 'out5') }),
      (error) => error.code === 'artifact-missing',
    );
  });
});

describe('state permissions (SEC-07)', () => {
  test('state files are 0600 and directories 0700', async () => {
    await applyWorkspace(config, host);
    const stateDir = process.env.FLEET_STATE_DIR;
    assert.equal(fs.statSync(stateDir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(stateDir, 'state.json')).mode & 0o777, 0o600);
  });
});
