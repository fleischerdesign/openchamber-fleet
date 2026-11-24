import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { parseManifestJson } from '@openchamber/sdk/schemas';
import extensionPlugin from '../../extensions/openchamber/plugin/dist/plugin/index.js';

const root = path.resolve('extensions/openchamber');

describe('OpenChamber extension package', () => {
  test('manifest parses with the public SDK and covers every Fleet tool', async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const parsed = parseManifestJson(JSON.stringify(manifest));
    assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.error);
    if (!parsed.ok) return;
    assert.equal(parsed.manifest.contributes.panel.id, 'openchamber-fleet');
    assert.deepEqual(parsed.manifest.contributes.tools.map((tool) => tool.match).sort(), [
      'fleet_exec',
      'fleet_fetch',
      'fleet_job_cancel',
      'fleet_job_status',
      'fleet_recover',
      'fleet_status',
      'fleet_sync',
    ]);
    assert.equal(parsed.manifest.contributes.opencodePlugin, 'plugin');
    assert.equal(parsed.manifest.contributes.service.entry, 'service/main.js');
    assert.equal(parsed.manifest.contributes.statusSection.source.path, '/status-view');
  });

  test('ships built panel, service and a loadable dependency-free OpenCode plugin', async () => {
    assert.ok(fs.statSync(path.join(root, 'panel/main.js')).size > 1000);
    assert.ok(fs.statSync(path.join(root, 'service/main.js')).size > 1000);
    const tools = [];
    const cleanup = await extensionPlugin.setup({
      location: { directory: process.cwd() },
      tool: { transform: async (edit) => edit({ add: (tool) => tools.push(tool) }) },
      session: { get: async () => ({ location: { directory: process.cwd() } }), synthetic: async () => ({}) },
    });
    try {
      assert.equal(tools.length, 7);
      assert.ok(tools.some((tool) => tool.name === 'fleet_exec' && tool.output));
    } finally {
      await cleanup();
    }
  });
});
