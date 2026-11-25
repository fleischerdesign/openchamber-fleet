import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-service-supervisor-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe('Fleet service supervisor launcher', () => {
  test('starts a detached supervisor and replaces it after it dies', async () => {
    const port = await freePort();
    const token = 'service-supervisor-token';
    const stateRoot = fs.mkdtempSync(path.join(tmp, 'state-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'config-'));
    const dataDir = fs.mkdtempSync(path.join(tmp, 'data-'));
    const temp = fs.mkdtempSync(path.join(tmp, 'tmp-'));
    const child = spawn(process.execPath, [path.resolve('extensions/openchamber/service/main.js')], {
      env: {
        ...process.env,
        OPENCHAMBER_SERVICE_PORT: String(port),
        OPENCHAMBER_SERVICE_TOKEN: token,
        OPENCHAMBER_SERVICE_DATA_DIR: dataDir,
        FLEET_CONFIG_DIR: configDir,
        FLEET_STATE_DIR: stateRoot,
        FLEET_SUPERVISOR_IDLE_MS: '600000',
        TMPDIR: temp,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });

    const supervisorPids = [];
    try {
      await waitFor(async () => {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/health`, {
            headers: { authorization: `Bearer ${token}` },
          });
          return response.ok;
        } catch {
          return false;
        }
      }, 10_000, 'service health');

      const first = await waitFor(async () => {
        const file = path.join(stateRoot, 'supervisor.json');
        if (!fs.existsSync(file)) return null;
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      }, 15_000, 'first supervisor discovery');
      assert.equal(first.protocol, 1);
      assert.equal(first.pid > 0, true);
      supervisorPids.push(first.pid);

      process.kill(first.pid, 'SIGTERM');
      await waitFor(() => !fs.existsSync(path.join(stateRoot, 'supervisor.json')), 5000, 'discovery removal');

      const second = await waitFor(async () => {
        if (!fs.existsSync(path.join(stateRoot, 'supervisor.json'))) return null;
        const value = JSON.parse(fs.readFileSync(path.join(stateRoot, 'supervisor.json'), 'utf8'));
        return value.pid !== first.pid ? value : null;
      }, 20_000, 'replacement supervisor');
      supervisorPids.push(second.pid);
      assert.notEqual(second.pid, first.pid);
      assert.equal(second.protocol, 1);
    } finally {
      try {
        const file = path.join(stateRoot, 'supervisor.json');
        if (fs.existsSync(file)) {
          const pid = JSON.parse(fs.readFileSync(file, 'utf8')).pid;
          if (Number.isInteger(pid)) supervisorPids.push(pid);
        }
      } catch {
        // Discovery may already be gone.
      }
      for (const pid of new Set(supervisorPids)) {
        try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
      }
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 2000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
      if (stderr.trim()) process.stderr.write(`service supervisor test stderr:\n${stderr}\n`);
    }
  });
});
