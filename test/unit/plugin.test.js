import assert from 'node:assert/strict';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import plugin from '../../dist/plugin/index.js';
import fs from 'node:fs';
import os from 'node:os';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-plugin-'));
fs.writeFileSync(path.join(workspace, 'fleet.json'), JSON.stringify({
  name: 'plugin-tests',
  hosts: { node: { ssh: 'test@node' } },
  excludes: [],
}));
after(() => fs.rmSync(workspace, { recursive: true, force: true }));

async function register(sessionDirectory) {
  const tools = [];
  const ctx = {
    tool: { transform: async (edit) => edit({ add: (tool) => tools.push(tool) }) },
    session: {
      get: async () => ({ location: { directory: sessionDirectory ?? '/nonexistent' } }),
    },
  };
  await plugin.setup(ctx);
  return tools;
}

describe('OpenCode plugin surface', () => {
  test('registers the four v1 tools', async () => {
    const tools = await register();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [
      'fleet_exec',
      'fleet_fetch',
      'fleet_status',
      'fleet_sync',
    ]);
    for (const tool of tools) {
      assert.equal(tool.input.type, 'object');
      assert.equal(tool.input.additionalProperties, false);
      assert.equal(typeof tool.execute, 'function');
    }
  });

  test('the session directory wins over the server cwd', async () => {
    const previous = process.cwd();
    process.chdir(os.tmpdir());
    try {
      const tools = await register(workspace);
      const status = tools.find((tool) => tool.name === 'fleet_status');
      const result = await status.execute({ host: 'node' }, { sessionID: 'ses_test' });
      assert.doesNotMatch(result.content, /no fleet\.json/);
    } finally {
      process.chdir(previous);
    }
  });

  test('a missing config becomes a readable result, not a throw', async () => {
    const previous = process.cwd();
    process.chdir(os.tmpdir());
    try {
      const tools = await register();
      const status = tools.find((tool) => tool.name === 'fleet_status');
      const result = await status.execute({ host: 'node' });
      assert.match(result.content, /no fleet\.json/);
    } finally {
      process.chdir(previous);
    }
  });
});
