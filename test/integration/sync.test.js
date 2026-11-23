import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { loadConfig } from '../../dist/config.js';
import { applyWorkspace, planWorkspace, verifyWorkspace } from '../../dist/sync.js';
import { cleanup, exists, makeWorkspace, readFile, writeFile } from '../fixtures/harness.mjs';

const spaces = makeWorkspace({
  name: 'sync-tests',
  files: {
    'README.md': 'hello\n',
    'src/app.txt': 'one\n',
    'src/nested/deep.txt': 'deep\n',
    'empty/.keep': '',
  },
});
after(() => cleanup(spaces));

const config = loadConfig(spaces.source);
const host = config.hosts.node;

describe('sync against a real rsync (SYNC-01…SYNC-05, SYNC-12…SYNC-21)', () => {
  test('first apply converges and the second plan is empty', async () => {
    const result = await applyWorkspace(config, host);
    assert.ok(result.applied > 0);
    assert.equal(readFile(spaces.replica, 'src/app.txt'), 'one\n');
    assert.equal(readFile(spaces.replica, 'README.md'), 'hello\n');
    const plan = await planWorkspace(config, host);
    assert.deepEqual(plan.entries, []);
  });

  test('an executable bit survives', async () => {
    writeFile(spaces.source, 'bin/run.sh', '#!/bin/sh\necho hi\n', 0o755);
    await applyWorkspace(config, host);
    assert.equal(fs.statSync(path.join(spaces.replica, 'bin/run.sh')).mode & 0o777, 0o755);
  });

  test('a deletion in canonical is propagated', async () => {
    fs.rmSync(path.join(spaces.source, 'src/nested/deep.txt'));
    const plan = await planWorkspace(config, host);
    assert.deepEqual(plan.entries.map((entry) => entry.action).filter((action) => action !== 'metadata'), ['delete']);
    await applyWorkspace(config, host);
    assert.equal(exists(spaces.replica, 'src/nested/deep.txt'), false);
  });

  test('an edit is propagated', async () => {
    writeFile(spaces.source, 'src/app.txt', 'two\n');
    await applyWorkspace(config, host);
    assert.equal(readFile(spaces.replica, 'src/app.txt'), 'two\n');
  });

  test('excluded caches are never transferred or deleted (SYNC-04, SYNC-05)', async () => {
    fs.mkdirSync(path.join(spaces.replica, 'target/debug'), { recursive: true });
    fs.writeFileSync(path.join(spaces.replica, 'target/debug/app'), 'built');
    writeFile(spaces.source, 'target/should-not-exist', 'x');
    await applyWorkspace(config, host);
    assert.equal(exists(spaces.replica, 'target/debug/app'), true);
    assert.equal(exists(spaces.replica, 'target/should-not-exist'), false);
  });

  test('a symlink is recreated as a link (SYNC-06, SYNC-08)', async () => {
    fs.symlinkSync('app.txt', path.join(spaces.source, 'src/link.txt'));
    fs.symlinkSync('missing-target', path.join(spaces.source, 'src/dangling'));
    fs.symlinkSync('/etc/hostname', path.join(spaces.source, 'src/absolute'));
    await applyWorkspace(config, host);
    assert.equal(fs.readlinkSync(path.join(spaces.replica, 'src/link.txt')), 'app.txt');
    assert.equal(fs.readlinkSync(path.join(spaces.replica, 'src/dangling')), 'missing-target');
    assert.equal(fs.readlinkSync(path.join(spaces.replica, 'src/absolute')), '/etc/hostname');
  });

  test('names with spaces, quotes and dashes survive (SYNC-15…SYNC-18)', async () => {
    writeFile(spaces.source, "odd/a b/c'd\"e$f`g.txt", 'odd\n');
    writeFile(spaces.source, 'odd/-leading-dash', 'dash\n');
    await applyWorkspace(config, host);
    assert.equal(readFile(spaces.replica, "odd/a b/c'd\"e$f`g.txt"), 'odd\n');
    assert.equal(readFile(spaces.replica, 'odd/-leading-dash'), 'dash\n');
  });

  test('an empty directory is created (SYNC-21)', async () => {
    fs.mkdirSync(path.join(spaces.source, 'empty-dir'), { recursive: true });
    await applyWorkspace(config, host);
    assert.equal(fs.statSync(path.join(spaces.replica, 'empty-dir')).isDirectory(), true);
  });

  test('a same-size, same-mtime edit is invisible without --checksum (SYNC-34)', async () => {
    const file = path.join(spaces.source, 'src/stable.txt');
    fs.writeFileSync(file, 'AAAA');
    await applyWorkspace(config, host);
    const stats = fs.statSync(file);
    fs.writeFileSync(file, 'BBBB');
    fs.utimesSync(file, stats.atime, stats.mtime);
    const quick = await verifyWorkspace(config, host);
    assert.equal(quick.entries.length, 0);
    const content = await verifyWorkspace(config, host, { checksum: true });
    assert.equal(content.entries.length, 1);
    await applyWorkspace(config, host, { checksum: true });
    assert.equal(readFile(spaces.replica, 'src/stable.txt'), 'BBBB');
  });

  test('a removed replica is rebuilt (SYNC-30)', async () => {
    fs.rmSync(spaces.replica, { recursive: true, force: true });
    fs.mkdirSync(spaces.replica);
    const plan = await planWorkspace(config, host);
    assert.ok(plan.entries.length > 0);
    await applyWorkspace(config, host);
    assert.equal(readFile(spaces.replica, 'src/app.txt'), 'two\n');
  });
});
