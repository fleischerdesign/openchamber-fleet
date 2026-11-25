import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { defaultWorkspaceName } from '../../dist/config.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-cli-'));
const cli = path.resolve('bin/fleet.js');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function repository() {
  const root = fs.mkdtempSync(path.join(tmp, 'repo-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  const sub = path.join(root, 'sub');
  fs.mkdirSync(sub);
  return { root, sub };
}

describe('fail-closed command flags', () => {
  function configured() {
    const { root } = repository();
    const configDir = fs.mkdtempSync(path.join(tmp, 'flags-config-'));
    execFileSync(process.execPath, [cli, 'init', '--host', 'mob', '--ssh', 'u@h', '--name', 'flags', '--config-dir', configDir], {
      cwd: root,
      stdio: 'pipe',
    });
    return { root, configDir };
  }

  test('a false apply flag is not an apply', () => {
    const { root, configDir } = configured();
    const result = spawnSync(process.execPath, [cli, 'sync', '--host', 'mob', '--apply=false', '--config-dir', configDir], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /exactly one of --plan or --apply/);
  });

  test('a plan token without a value is refused before SSH', () => {
    const { root, configDir } = configured();
    const result = spawnSync(process.execPath, [cli, 'sync', '--host', 'mob', '--apply', '--plan-token', '--config-dir', configDir], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /plan-token requires a token value/);
  });

  test('sync rejects --sync, positionals and duplicate flags', () => {
    const { root, configDir } = configured();
    const syncFlag = spawnSync(process.execPath, [cli, 'sync', '--host', 'mob', '--plan', '--sync', 'plan', '--config-dir', configDir], { cwd: root, encoding: 'utf8' });
    assert.equal(syncFlag.status, 2);
    assert.match(syncFlag.stderr, /--sync/);
    const positional = spawnSync(process.execPath, [cli, 'sync', '--host', 'mob', '--plan', 'unexpected', '--config-dir', configDir], { cwd: root, encoding: 'utf8' });
    assert.equal(positional.status, 2);
    assert.match(positional.stderr, /positional/);
    const duplicate = spawnSync(process.execPath, [cli, 'sync', '--host', 'mob', '--plan', '--plan', '--config-dir', configDir], { cwd: root, encoding: 'utf8' });
    assert.equal(duplicate.status, 2);
    assert.match(duplicate.stderr, /more than once/);
  });

  test('run rejects conflicting plan flags and adopt', () => {
    const { root, configDir } = configured();
    const conflict = spawnSync(process.execPath, [cli, 'run', '--host', 'mob', '--plan', '--sync', 'plan', '--config-dir', configDir, '--', 'true'], { cwd: root, encoding: 'utf8' });
    assert.equal(conflict.status, 2);
    assert.match(conflict.stderr, /either --sync or --plan/);
    const adopt = spawnSync(process.execPath, [cli, 'run', '--host', 'mob', '--adopt', '--config-dir', configDir, '--', 'true'], { cwd: root, encoding: 'utf8' });
    assert.equal(adopt.status, 2);
    assert.match(adopt.stderr, /--adopt is only valid/);
  });
});

describe('fleet init', () => {
  test('--workspace-file writes at the repository root, not the current subdirectory', () => {
    const { root, sub } = repository();
    execFileSync(process.execPath, [cli, 'init', '--host', 'mob', '--ssh', 'u@h', '--workspace-file'], {
      cwd: sub,
      stdio: 'pipe',
    });

    assert.equal(fs.existsSync(path.join(root, 'fleet.json')), true);
    assert.equal(fs.existsSync(path.join(sub, 'fleet.json')), false);
    const legacy = JSON.parse(fs.readFileSync(path.join(root, 'fleet.json'), 'utf8'));
    assert.equal(legacy.name, defaultWorkspaceName(root));
    assert.equal(legacy.hosts.mob.ssh, 'u@h');
  });

  test('fleet hosts reports tags and auto-selection', () => {
    const { root } = repository();
    const configDir = fs.mkdtempSync(path.join(tmp, 'tags-config-'));
    execFileSync(process.execPath, [cli, 'init', '--host', 'mob', '--ssh', 'u@h', '--name', 'tagged', '--tag', 'linux,gpu', '--config-dir', configDir], {
      cwd: root,
      stdio: 'pipe',
    });
    const output = execFileSync(process.execPath, [cli, 'hosts', '--tag', 'gpu', '--json', '--config-dir', configDir], {
      cwd: root,
      encoding: 'utf8',
    });
    const value = JSON.parse(output);
    assert.deepEqual(value.hosts[0].tags, ['linux', 'gpu']);
    assert.equal(value.selected, 'mob');
  });

  test('fleet default serves projectless chats and fleet hosts survives clearing it', () => {
    const configDir = fs.mkdtempSync(path.join(tmp, 'default-config-'));
    const project = fs.mkdtempSync(path.join(tmp, 'default-project-'));
    execFileSync(process.execPath, [cli, 'init', '--host', 'mob', '--ssh', 'u@h', '--name', 'defaulted', '--config-dir', configDir], {
      cwd: project,
      stdio: 'pipe',
    });
    execFileSync(process.execPath, [cli, 'default', project, '--config-dir', configDir], { stdio: 'pipe' });

    const shown = JSON.parse(execFileSync(process.execPath, [cli, 'default', '--json', '--config-dir', configDir], { encoding: 'utf8' }));
    assert.equal(shown.directory, project);

    const chat = path.join(tmp, '.config', 'openchamber', 'chats', 'session-cli');
    fs.mkdirSync(chat, { recursive: true });
    const selected = JSON.parse(execFileSync(process.execPath, [cli, 'hosts', '--json', '--config-dir', configDir], {
      cwd: chat,
      encoding: 'utf8',
    }));
    assert.equal(selected.workspace, 'defaulted');
    assert.equal(selected.hosts[0].alias, 'mob');

    execFileSync(process.execPath, [cli, 'default', '--clear', '--config-dir', configDir], { stdio: 'pipe' });
    const global = JSON.parse(execFileSync(process.execPath, [cli, 'hosts', '--json', '--config-dir', configDir], {
      cwd: chat,
      encoding: 'utf8',
    }));
    assert.equal(global.workspace, 'no project');
    assert.equal(global.hosts[0].alias, 'mob');
  });

  test('--config-dir writes the split configuration outside the repository', () => {
    const { root } = repository();
    const configDir = fs.mkdtempSync(path.join(tmp, 'config-'));
    execFileSync(process.execPath, [cli, 'init', '--host', 'mob', '--ssh', 'u@h', '--name', 'split', '--config-dir', configDir], {
      cwd: root,
      stdio: 'pipe',
    });

    assert.equal(fs.existsSync(path.join(root, 'fleet.json')), false);
    assert.equal(fs.existsSync(path.join(configDir, 'hosts.json')), true);
    assert.equal(fs.readdirSync(path.join(configDir, 'workspaces')).length, 1);
  });
});
