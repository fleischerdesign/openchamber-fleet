import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';

describe('smoke', () => {
  test('the test harness runs', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'fleet-'));
    after(() => rm(dir, { recursive: true, force: true }));
    await writeFile(path.join(dir, 'x'), 'y');
    assert.equal(await readFile(path.join(dir, 'x'), 'utf8'), 'y');
  });
});
