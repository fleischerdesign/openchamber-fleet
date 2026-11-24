import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
