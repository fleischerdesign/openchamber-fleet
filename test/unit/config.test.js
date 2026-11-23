import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { compileExcludes, loadConfig } from '../../dist/config.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-config-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function writeConfig(value) {
  const dir = fs.mkdtempSync(path.join(tmp, 'ws-'));
  fs.writeFileSync(path.join(dir, 'fleet.json'), typeof value === 'string' ? value : JSON.stringify(value));
  return dir;
}

describe('fleet.json validation (CFG-01…CFG-08)', () => {
  test('rejects a missing file', () => {
    assert.throws(() => loadConfig(tmp), (error) => error.code === 'config-missing');
  });

  test('rejects unknown top-level keys', () => {
    const dir = writeConfig({ name: 'x', hosts: { a: { ssh: 'u@h' } }, exclueds: [] });
    assert.throws(() => loadConfig(dir), /unknown key/);
  });

  test('rejects an invalid workspace name', () => {
    const dir = writeConfig({ name: 'Bad Name', hosts: { a: { ssh: 'u@h' } } });
    assert.throws(() => loadConfig(dir), /workspace name/);
  });

  test('rejects a host without ssh', () => {
    const dir = writeConfig({ name: 'x', hosts: { a: {} } });
    assert.throws(() => loadConfig(dir), /ssh/);
  });

  test('rejects an invalid ssh target', () => {
    const dir = writeConfig({ name: 'x', hosts: { a: { ssh: 'no-at-sign' } } });
    assert.throws(() => loadConfig(dir), /user@host/);
  });

  test('rejects a relative root (CFG-05)', () => {
    const dir = writeConfig({ name: 'x', hosts: { a: { ssh: 'u@h', root: 'relative' } } });
    assert.throws(() => loadConfig(dir), /absolute/);
  });

  test('rejects non-string env values (CFG-08)', () => {
    const dir = writeConfig({ name: 'x', hosts: { a: { ssh: 'u@h' } }, env: { A: 1 } });
    assert.throws(() => loadConfig(dir), /must be a string/);
  });

  test('applies defaults and strips a trailing slash from root', () => {
    const dir = writeConfig({ name: 'x', hosts: { a: { ssh: 'u@h', root: '/srv/x/' } } });
    const config = loadConfig(dir);
    assert.equal(config.hosts.a.port, 22);
    assert.equal(config.hosts.a.root, '/srv/x');
    assert.equal(config.shell, "bash");
  });

  test('defaults the replica root from the workspace name', () => {
    const dir = writeConfig({ name: 'proj', hosts: { a: { ssh: 'u@h' } } });
    assert.equal(loadConfig(dir).hosts.a.root, '~/.cache/openchamber-fleet/proj');
  });

  test('accepts 1000 excludes', () => {
    const excludes = Array.from({ length: 1000 }, (_, index) => `dir-${index}/`);
    const dir = writeConfig({ name: 'x', hosts: { a: { ssh: 'u@h' } }, excludes });
    assert.equal(loadConfig(dir).excludes.length, 1000);
  });
});

describe('exclude semantics (SYNC-35…SYNC-38)', () => {
  test('name/ matches a directory at any depth and its contents', () => {
    const matcher = compileExcludes(['target/']);
    assert.equal(matcher.matches('target', true), true);
    assert.equal(matcher.matches('a/target', true), true);
    assert.equal(matcher.matches('a/target/file', false), true);
    assert.equal(matcher.matches('target.txt', false), false);
    assert.equal(matcher.matches('target', false), false);
  });

  test('/dist is anchored', () => {
    const matcher = compileExcludes(['/dist']);
    assert.equal(matcher.matches('dist', true), true);
    assert.equal(matcher.matches('dist/app.bin', false), true);
    assert.equal(matcher.matches('pkg/dist', true), false);
  });

  test('*.log matches basenames at any depth', () => {
    const matcher = compileExcludes(['*.log']);
    assert.equal(matcher.matches('a/b.log', false), true);
    assert.equal(matcher.matches('b.log', false), true);
    assert.equal(matcher.matches('a/blog', false), false);
    assert.equal(matcher.matches('logs.log/x', false), true);
  });

  test('dir/** matches the subtree', () => {
    const matcher = compileExcludes(['build/**']);
    assert.equal(matcher.matches('build/a/b', false), true);
    assert.equal(matcher.matches('build', true), false);
    assert.equal(matcher.matches('pkg/build/a', false), true);
  });

  test('**/tmp/ matches at any depth', () => {
    const matcher = compileExcludes(['**/tmp/']);
    assert.equal(matcher.matches('a/b/tmp', true), true);
    assert.equal(matcher.matches('a/b/tmp/x', false), true);
    assert.equal(matcher.matches("tmp", true), true);
  });
});
