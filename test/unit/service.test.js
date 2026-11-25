import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-service-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startService() {
  const port = await freePort();
  const token = 'service-test-token';
  const configDir = fs.mkdtempSync(path.join(tmp, 'config-'));
  const dataDir = fs.mkdtempSync(path.join(tmp, 'data-'));
  const stateDir = fs.mkdtempSync(path.join(tmp, 'state-'));
  const temp = fs.mkdtempSync(path.join(tmp, 'tmp-'));
  const child = spawn(process.execPath, [path.resolve('extensions/openchamber/service/main.js')], {
    env: {
      ...process.env,
      OPENCHAMBER_SERVICE_PORT: String(port),
      OPENCHAMBER_SERVICE_TOKEN: token,
      OPENCHAMBER_SERVICE_DATA_DIR: dataDir,
      FLEET_CONFIG_DIR: configDir,
      FLEET_STATE_DIR: stateDir,
      FLEET_SUPERVISOR: 'off',
      TMPDIR: temp,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });

  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${base}/health`, { headers: { authorization: `Bearer ${token}` } });
      if (response.ok) return { child, base, token, configDir, stderr: () => stderr };
    } catch {
      // The listener is not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill();
  throw new Error(`Fleet service did not start: ${stderr}`);
}

async function request(service, method, route, body) {
  const response = await fetch(`${service.base}${route}`, {
    method,
    headers: {
      authorization: `Bearer ${service.token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

describe('Fleet service configuration route', () => {
  test('reads and saves the split documents outside the project', async () => {
    const service = await startService();
    const workspace = fs.mkdtempSync(path.join(tmp, 'workspace-'));
    try {
      const initial = await request(service, 'GET', `/config?directory=${encodeURIComponent(workspace)}`);
      assert.equal(initial.status, 200);
      assert.equal(initial.body.ok, true);
      const documents = initial.body.result;
      assert.equal(documents.project.hosts.length, 0);

      const project = {
        ...documents.project,
        name: 'service-test',
        hosts: ['mob'],
        excludes: ['target/'],
      };
      const saved = await request(service, 'POST', '/config', {
        directory: workspace,
        hosts: { version: 1, hosts: { mob: { ssh: 'u@h' } } },
        project,
        revision: documents.revision,
      });
      assert.equal(saved.status, 200);
      assert.equal(saved.body.ok, true);
      assert.equal(saved.body.result.project.name, 'service-test');
      assert.equal(fs.existsSync(path.join(service.configDir, 'hosts.json')), true);
      assert.equal(fs.existsSync(path.join(workspace, 'fleet.json')), false);

      const invalid = await request(service, 'POST', '/config', {
        directory: workspace,
        hosts: saved.body.result.hosts,
        project: { ...saved.body.result.project, excludes: ['../secret'] },
        revision: saved.body.result.revision,
      });
      assert.equal(invalid.status, 400);
      assert.equal(invalid.body.error.code, 'config-invalid');

      const stale = await request(service, 'POST', '/config', {
        directory: workspace,
        hosts: saved.body.result.hosts,
        project: saved.body.result.project,
        revision: 'stale',
      });
      assert.equal(stale.status, 400);
      assert.match(stale.body.error.message, /changed since it was loaded/);
    } finally {
      service.child.kill();
    }
  });
});
