import assert from 'node:assert/strict';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import plugin from '../../dist/plugin/index.js';
import fs from 'node:fs';
import os from 'node:os';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-plugin-'));
fs.writeFileSync(path.join(workspace, 'fleet.json'), JSON.stringify({
  name: 'plugin-tests',
  hosts: { node: { ssh: 'test@127.0.0.1', port: 1 } },
  excludes: [],
}));
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-plugin-config-'));
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-plugin-state-'));
process.env.FLEET_CONFIG_DIR = configDir;
process.env.FLEET_STATE_DIR = stateDir;
after(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.rmSync(configDir, { recursive: true, force: true });
  fs.rmSync(stateDir, { recursive: true, force: true });
});

async function register(sessionDirectory) {
  const tools = [];
  const permissions = [];
  const storage = new Map();
  const ctx = {
    location: { directory: '/different-server-directory' },
    tool: { transform: async (edit) => edit({ add: (tool) => tools.push(tool) }) },
    session: {
      get: async () => ({ location: { directory: sessionDirectory ?? '/nonexistent' } }),
      synthetic: async () => ({}),
    },
    permission: { assert: async (input) => permissions.push(input) },
    storage: {
      get: async (key) => storage.get(key),
      set: async (key, value) => storage.set(key, value),
      remove: async (key) => storage.delete(key),
      scan: async ({ prefix }) => ({ entries: [...storage].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value })) }),
    },
  };
  const cleanup = await plugin.setup(ctx);
  return { tools, cleanup, ctx, permissions };
}

function tool(tools, name) {
  const found = tools.find((entry) => entry.name === name);
  assert.ok(found, `missing tool ${name}`);
  return found;
}

const context = { sessionID: 'ses_test', agent: 'build', messageID: 'msg_test', id: 'call_test' };

describe('OpenCode plugin surface', () => {
  test('registers the ten V2 tools with input and output schemas', async () => {
    const { tools, cleanup } = await register(workspace);
    try {
      assert.deepEqual(tools.map((entry) => entry.name).sort(), [
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
      ]);
      for (const entry of tools) {
        assert.equal(entry.input.type, 'object');
        assert.equal(entry.input.additionalProperties, false);
        assert.equal(entry.output.type, 'object');
        assert.equal(typeof entry.execute, 'function');
      }
    } finally {
      await cleanup();
    }
  });

  test('the session directory wins over the server cwd', async () => {
    const { tools, cleanup } = await register(workspace);
    try {
      const result = tool(tools, 'fleet_job_status');
      await assert.rejects(
        result.execute({ host: 'node', jobId: 'missing' }, context),
        /unknown job missing/,
      );
    } finally {
      await cleanup();
    }
  });

  test('a missing config is a real tool failure', async () => {
    const { tools, cleanup } = await register('/nonexistent');
    try {
      const result = tool(tools, 'fleet_job_status');
      await assert.rejects(
        result.execute({ host: 'node', jobId: 'missing' }, context),
        /no Fleet host registry/,
      );
    } finally {
      await cleanup();
    }
  });

  test('exec evaluates shell permissions for host and exact argv before connecting', async () => {
    const { tools, cleanup, permissions } = await register(workspace);
    try {
      const result = tool(tools, 'fleet_exec');
      await assert.rejects(result.execute({ host: 'node', argv: ['echo', 'hello world'] }, context));
      assert.deepEqual(permissions.map((entry) => entry.action), ['fleet.exec', 'shell']);
      assert.deepEqual(permissions[1].resources, ["echo 'hello world'"]);
      assert.deepEqual(permissions[1].save, ["echo 'hello world'"]);
      assert.match(permissions[0].resources[0], /"host":"node"/);
    } finally {
      await cleanup();
    }
  });

  test('exec approval changes when an environment value changes', async () => {
    const { tools, cleanup, permissions } = await register(workspace);
    try {
      const result = tool(tools, 'fleet_exec');
      await assert.rejects(result.execute({ host: 'node', argv: ['true'], env: { MODE: 'one' } }, context));
      await assert.rejects(result.execute({ host: 'node', argv: ['true'], env: { MODE: 'two' } }, context));
      const descriptors = permissions.filter((entry) => entry.action === 'fleet.exec').map((entry) => entry.resources[0]);
      assert.equal(descriptors.length, 2);
      assert.notEqual(descriptors[0], descriptors[1]);
    } finally {
      await cleanup();
    }
  });

  test('cancel does not send an undefined save field to the permission API', async () => {
    const { tools, cleanup, permissions } = await register(workspace);
    try {
      const result = tool(tools, 'fleet_job_cancel');
      await assert.rejects(
        result.execute({ host: 'node', jobId: 'missing' }, context),
        /unknown job/,
      );
      assert.equal(permissions.length, 1);
      assert.equal(permissions[0].action, 'fleet.job.cancel');
      assert.equal('save' in permissions[0], false);
    } finally {
      await cleanup();
    }
  });

  test('sync apply uses its dedicated permission', async () => {
    const { tools, cleanup, permissions } = await register(workspace);
    try {
      const result = tool(tools, 'fleet_sync');
      await assert.rejects(result.execute({ host: 'node', mode: 'apply' }, context));
      assert.equal(permissions.length, 1);
      assert.equal(permissions[0].action, 'fleet.sync');
      assert.deepEqual(permissions[0].resources, ['plugin-tests@node']);
    } finally {
      await cleanup();
    }
  });

  test('fetch checks the final local edit target before connecting', async () => {
    const { tools, cleanup, permissions } = await register(workspace);
    try {
      const result = tool(tools, 'fleet_fetch');
      await assert.rejects(result.execute({ host: 'node', artifact: 'out.txt', dest: path.join(workspace, 'out') }, context));
      assert.equal(permissions.length, 1);
      assert.equal(permissions[0].action, 'edit');
      assert.deepEqual(permissions[0].resources, [path.join(workspace, 'out', 'out.txt')]);
    } finally {
      await cleanup();
    }
  });
});
