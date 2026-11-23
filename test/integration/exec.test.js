import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../../dist/config.js';
import { execRemote } from '../../dist/exec.js';
import { applyWorkspace } from '../../dist/sync.js';
import { cleanup, makeWorkspace, writeFile } from '../fixtures/harness.mjs';

const workspace = makeWorkspace({
  name: 'exec-tests',
  files: { 'README.md': 'hello\n', 'src/app.txt': 'one\n' },
});
const config = loadConfig(workspace.source);
const host = config.hosts.node;
after(() => cleanup(workspace));

before(async () => {
  await applyWorkspace(config, host);
});

const run = (options) => execRemote({ config, host, ...options });

describe('remote exec (EXEC-01…EXEC-24)', () => {
  test('runs in the replica root (EXEC-11)', async () => {
    const result = await run({ argv: ['pwd'] });
    assert.equal(result.exitCode, 0);
    assert.equal(result.output.trim(), fs.realpathSync(workspace.replica));
  });

  test('propagates the exit code (EXEC-02)', async () => {
    const result = await run({ shell: 'exit 7' });
    assert.equal(result.exitCode, 7);
  });

  test('preserves argv boundaries (EXEC-03)', async () => {
    const result = await run({ argv: ['printf', '%s|', 'a b', "c'd"] });
    assert.equal(result.output, "a b|c'd|");
  });

  test('runs shell pipelines (EXEC-06)', async () => {
    const result = await run({ shell: 'echo hi | tr a-z A-Z' });
    assert.equal(result.output.trim(), 'HI');
  });

  test('does not leak the caller environment (EXEC-07)', async () => {
    process.env.FLEET_TEST_SECRET = 'leaked';
    const result = await run({ shell: 'echo "${FLEET_TEST_SECRET:-unset}"' });
    assert.equal(result.output.trim(), 'unset');
    delete process.env.FLEET_TEST_SECRET;
  });

  test('exposes declared env and a fixed locale (EXEC-08, EXEC-20)', async () => {
    const withEnv = { ...config, env: { FLEET_DECLARED: 'yes' } };
    const result = await execRemote({ config: withEnv, host, shell: 'printf "%s %s %s" "$FLEET_DECLARED" "$LANG" "$TZ"' });
    assert.equal(result.output, 'yes C.UTF-8 UTC');
  });

  test('captures stderr separately (EXEC-18)', async () => {
    const result = await run({ shell: 'echo out; echo err >&2' });
    assert.equal(result.output.trim(), 'out');
    assert.equal(result.stderr.trim(), 'err');
  });

  test('refuses a stale replica (I2)', async () => {
    writeFile(workspace.source, 'src/app.txt', 'changed\n');
    await assert.rejects(run({ argv: ['true'] }), (error) => error.code === 'replica-stale');
    await applyWorkspace(config, host);
  });

  test('allowStale runs and reports staleness (EXEC-13 escape hatch)', async () => {
    writeFile(workspace.source, 'src/app.txt', 'changed-again\n');
    const result = await run({ argv: ['true'], allowStale: true });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stale, true);
    await applyWorkspace(config, host);
  });

  test('times out and kills the process (EXEC-13)', async () => {
    await assert.rejects(
      run({ shell: 'sleep 30', timeoutMs: 800 }),
      (error) => error.code === 'timeout',
    );
  });

  test('a missing replica root exits 97 (EXEC-12)', async () => {
    const missing = {
      ...config,
      hosts: { node: { ...host, root: path.join(workspace.root, 'definitely-missing') } },
    };
    const result = await execRemote({ config: missing, host: missing.hosts.node, argv: ['true'], allowStale: true });
    assert.equal(result.exitCode, 97);
  });

  test('records a run with an exit code and a log (SEC-08)', async () => {
    const result = await run({ shell: 'echo recorded' });
    assert.equal(result.exitCode, 0);
    assert.ok(fs.existsSync(result.logPath));
    assert.match(fs.readFileSync(result.logPath, 'utf8'), /recorded/);
  });

  test('a second exec on the same workspace serialises (EXEC-23)', async () => {
    const first = run({ shell: 'sleep 0.6' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await assert.rejects(run({ argv: ['true'] }), (error) => error.code === 'lease-busy');
    await first;
  });
});
