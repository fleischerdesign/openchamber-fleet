import assert from 'node:assert/strict';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import plugin from '../../dist/plugin/index.js';
import { cleanup, makeWorkspace } from '../fixtures/harness.mjs';

const workspace = makeWorkspace({
  name: 'plugin-tests',
  files: { 'a.txt': 'a\n' },
});
after(() => cleanup(workspace));

async function register() {
  const tools = [];
  const ctx = {
    tool: {
      transform: async (edit) => edit({ add: (tool) => tools.push(tool) }),
    },
  };
  await plugin.setup(ctx);
  return tools;
}

describe('OpenCode plugin surface (ADR-0004)', () => {
  test('registers exactly the five documented tools', async () => {
    const tools = await register();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [
      'fleet_cancel',
      'fleet_exec',
      'fleet_fetch',
      'fleet_status',
      'fleet_sync',
    ]);
    for (const tool of tools) {
      assert.equal(tool.input.type, 'object');
      assert.equal(tool.input.additionalProperties, false);
      assert.equal(typeof tool.execute, 'function');
      assert.equal(tool.options.codemode, false);
    }
  });

  test('fleet_status reads the workspace in the session directory', async () => {
    const previous = process.cwd();
    process.chdir(workspace.source);
    try {
      const tools = await register();
      const status = tools.find((tool) => tool.name === 'fleet_status');
      const result = await status.execute({});
      assert.match(result.content, /workspace plugin-tests/);
      assert.match(result.content, /node: unknown/);
    } finally {
      process.chdir(previous);
    }
  });

  test('a missing config becomes a readable tool result, not a throw', async () => {
    const previous = process.cwd();
    process.chdir(path.dirname(workspace.root));
    try {
      const tools = await register();
      const status = tools.find((tool) => tool.name === 'fleet_status');
      const result = await status.execute({});
      assert.match(result.content, /config-missing/);
    } finally {
      process.chdir(previous);
    }
  });
});
