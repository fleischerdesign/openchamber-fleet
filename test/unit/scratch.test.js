import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { scratchConfig, scratchIdentity } from '../../dist/scratch.js';

const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-scratch-config-'));
after(() => {
  delete process.env.FLEET_CONFIG_DIR;
  fs.rmSync(configDir, { recursive: true, force: true });
});
fs.writeFileSync(path.join(configDir, 'hosts.json'), JSON.stringify({
  version: 1,
  hosts: { node: { ssh: 'u@h' } },
}));
process.env.FLEET_CONFIG_DIR = configDir;

test('scratch identity is stable, filesystem-safe and root-based', () => {
  const first = scratchIdentity('ses_example');
  const second = scratchIdentity('ses_example');
  assert.deepEqual(first, second);
  assert.match(first.id, /^[0-9a-f]{16}$/);
  assert.equal(first.workspaceId, `scratch-${first.id}`);
  assert.equal(first.root, `~/.cache/openchamber-fleet/scratch/${first.id}`);
  assert.notDeepEqual(first, scratchIdentity('ses_other'));
});

test('scratch config has no source exclusions and one root for every host', () => {
  const config = scratchConfig({ seed: 'ses_example', directory: '/tmp/chat' });
  assert.equal(config.name, scratchIdentity('ses_example').workspaceId);
  assert.equal(config.dir, '/tmp/chat');
  assert.deepEqual(config.excludes, []);
  assert.ok(Object.keys(config.hosts).length > 0);
  for (const host of Object.values(config.hosts)) {
    assert.equal(host.root, scratchIdentity('ses_example').root);
  }
});
