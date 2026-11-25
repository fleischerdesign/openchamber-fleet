import assert from 'node:assert/strict';
import path from 'node:path';
import crypto from 'node:crypto';
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
fs.writeFileSync(path.join(configDir, 'hosts.json'), JSON.stringify({
  version: 1,
  hosts: { node: { ssh: 'test@127.0.0.1', port: 1 } },
}));
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
  test('registers the twelve V2 tools with input and output schemas', async () => {
    const { tools, cleanup } = await register(workspace);
    try {
      assert.deepEqual(tools.map((entry) => entry.name).sort(), [
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
        result.execute({ jobId: 'missing' }, context),
        /unknown job missing/,
      );
    } finally {
      await cleanup();
    }
  });

  test('scratch host listing works without a project config', async () => {
    const { tools, cleanup } = await register('/nonexistent');
    try {
      const result = await tool(tools, 'fleet_hosts').execute({ target: 'scratch' }, context);
      assert.equal(result.output.target, 'scratch');
      assert.deepEqual(result.output.hosts.map((host) => host.alias), ['node']);
    } finally {
      await cleanup();
    }
  });

  test('scratch sync is refused before any connection', async () => {
    const { tools, cleanup } = await register(workspace);
    try {
      await assert.rejects(
        tool(tools, 'fleet_run').execute({ host: 'node', target: 'scratch', argv: ['true'], sync: 'plan' }, context),
        /scratch has no source tree/,
      );
    } finally {
      await cleanup();
    }
  });

  test('scratch exec carries its target through the permissions', async () => {
    const { tools, cleanup, permissions } = await register(workspace);
    try {
      await assert.rejects(tool(tools, 'fleet_exec').execute({ host: 'node', target: 'scratch', argv: ['true'] }, context));
      assert.equal(permissions[0].metadata.target, 'scratch');
      assert.equal(permissions[1].metadata.target, 'scratch');
    } finally {
      await cleanup();
    }
  });

  test('a projectless chat without a default asks for an explicit target', async () => {
    const chat = path.join(workspace, '.config', 'openchamber', 'chats', 'session-missing');
    fs.mkdirSync(chat, { recursive: true });
    const { tools, cleanup } = await register(chat);
    try {
      const result = tool(tools, 'fleet_exec');
      await assert.rejects(
        result.execute({ host: 'node', argv: ['true'] }, context),
        /TARGET_REQUIRED|no project workspace/,
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

  test('cancel rejects an unknown job before asking for permission', async () => {
    const { tools, cleanup, permissions } = await register(workspace);
    try {
      const result = tool(tools, 'fleet_job_cancel');
      await assert.rejects(
        result.execute({ jobId: 'missing' }, context),
        /unknown job/,
      );
      assert.equal(permissions.length, 0);
    } finally {
      await cleanup();
    }
  });

  test('run permission binds target, sync mode and excludes', async () => {
    const { tools, cleanup, permissions } = await register(workspace);
    try {
      await assert.rejects(tool(tools, 'fleet_run').execute({
        host: 'node',
        argv: ['true'],
        sync: 'apply',
        excludes: ['secret/'],
      }, context));
      const descriptor = JSON.parse(permissions[0].resources[0]);
      assert.equal(descriptor.workspace, 'plugin-tests');
      assert.equal(descriptor.target, 'workspace');
      assert.equal(descriptor.sync, 'apply');
      assert.deepEqual(descriptor.excludes, ['secret/']);
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
      const descriptor = JSON.parse(permissions[0].resources[0]);
      assert.equal(descriptor.workspaceId, 'plugin-tests');
      assert.equal(descriptor.host, 'node');
      assert.equal(descriptor.ssh, 'test@127.0.0.1');
      assert.equal(descriptor.root, '~/.cache/openchamber-fleet/plugin-tests');
      assert.equal(descriptor.mode, 'apply');
      assert.equal(descriptor.planToken, null);
    } finally {
      await cleanup();
    }
  });

  test('upload asks for read and the transfer permission on the canonical source', async () => {
    const { tools, cleanup, permissions } = await register(workspace);
    const source = path.join(workspace, 'upload-source.txt');
    fs.writeFileSync(source, 'payload');
    try {
      await assert.rejects(tool(tools, 'fleet_upload').execute({
        host: 'node',
        target: 'scratch',
        localPath: 'upload-source.txt',
        remotePath: 'upload.txt',
      }, context));
      assert.deepEqual(permissions.map((entry) => entry.action), ['read', 'fleet.upload']);
      assert.deepEqual(permissions[0].resources, [source]);
      assert.deepEqual(permissions[1].resources, [`node@test@127.0.0.1:1:~/.cache/openchamber-fleet/scratch/${crypto.createHash('sha256').update(context.sessionID).digest('hex').slice(0,16)}:${source}->upload.txt`]);
    } finally {
      await cleanup();
    }
  });

  test('download binds edit and the transfer permission to the same canonical target', async () => {
    const { tools, cleanup, permissions } = await register(workspace);
    try {
      await assert.rejects(tool(tools, 'fleet_download').execute({
        host: 'node',
        target: 'scratch',
        remotePath: 'remote.txt',
        localPath: 'download-target.txt',
      }, context));
      assert.deepEqual(permissions.map((entry) => entry.action), ['edit', 'fleet.download']);
      const target = path.join(workspace, 'download-target.txt');
      assert.deepEqual(permissions[0].resources, [target]);
      assert.deepEqual(permissions[1].resources, [`node@test@127.0.0.1:1:~/.cache/openchamber-fleet/scratch/${crypto.createHash('sha256').update(context.sessionID).digest('hex').slice(0,16)}:remote.txt->${target}`]);
    } finally {
      await cleanup();
    }
  });

  test('fetch checks the final local edit target before connecting', async () => {
    const { tools, cleanup, permissions } = await register(workspace);
    try {
      const result = tool(tools, 'fleet_fetch');
      await assert.rejects(result.execute({ host: 'node', artifact: 'out.txt', dest: path.join(workspace, 'out') }, context));
      assert.deepEqual(permissions.map((entry) => entry.action), ['edit', 'fleet.download']);
      const target = path.join(workspace, 'out', 'out.txt');
      assert.deepEqual(permissions[0].resources, [target]);
      assert.deepEqual(permissions[1].resources, [`node@test@127.0.0.1:1:~/.cache/openchamber-fleet/plugin-tests:out.txt->${target}`]);
    } finally {
      await cleanup();
    }
  });
});
