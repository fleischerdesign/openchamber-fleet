import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { parseManifestJson } from '@openchamber/sdk/schemas';
import extensionPlugin from '../../extensions/openchamber/plugin/dist/plugin/index.js';

const root = path.resolve('extensions/openchamber');

describe('OpenChamber extension package', () => {
  test('manifest parses with the public SDK and covers every Fleet tool', async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(manifest.openchamber.id, 'openchamber-fleet');
    assert.equal(manifest.openchamber.id.startsWith('openchamber-builtin-'), false);
    const parsed = parseManifestJson(JSON.stringify(manifest));
    assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.error);
    if (!parsed.ok) return;
    assert.equal(parsed.manifest.contributes.panel.id, 'openchamber-fleet');
    assert.equal(parsed.manifest.contributes.panel.name, 'Fleet');
    assert.equal(parsed.manifest.contributes.panel.icon, 'server');
    assert.equal(parsed.manifest.engines.openchamber, '>=2.8.0');
    assert.deepEqual(parsed.manifest.contributes.tools.map((tool) => tool.match).sort(), [
      'fleet_download',
      'fleet_exec',
      'fleet_fetch',
      'fleet_hosts',
      'fleet_job_cancel',
      'fleet_job_status',
      'fleet_jobs',
      'fleet_recover',
      'fleet_run',
      'fleet_status',
      'fleet_sync',
      'fleet_upload',
    ]);
    assert.equal(parsed.manifest.contributes.opencodePlugin, 'plugin');
    assert.equal(parsed.manifest.contributes.service.entry, 'service/main.js');
    assert.equal(parsed.manifest.contributes.statusSection.source.path, '/status-view');
  });

  test('ships built panel, service, supervisor and a loadable dependency-free OpenCode plugin', async () => {
    assert.ok(fs.statSync(path.join(root, 'panel/main.js')).size > 1000);
    assert.ok(fs.statSync(path.join(root, 'service/main.js')).size > 1000);
    assert.ok(fs.statSync(path.join(root, 'supervisor/main.js')).size > 1000);
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-extension-state-'));
    process.env.FLEET_STATE_DIR = stateDir;
    const tools = [];
    const cleanup = await extensionPlugin.setup({
      location: { directory: process.cwd() },
      tool: { transform: async (edit) => edit({ add: (tool) => tools.push(tool) }) },
      session: { get: async () => ({ location: { directory: process.cwd() } }), synthetic: async () => ({}) },
    });
    try {
      assert.equal(tools.length, 12);
      assert.ok(tools.some((tool) => tool.name === 'fleet_exec' && tool.output));
    } finally {
      await cleanup();
      delete process.env.FLEET_STATE_DIR;
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
