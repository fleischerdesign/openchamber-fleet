import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { loadConfig } from '../../dist/config.js';
import { applyWorkspace, planWorkspace } from '../../dist/sync.js';
import { cleanup, makeWorkspace, writeFile } from '../fixtures/harness.mjs';

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function compareTrees(left, right, relative = '') {
  const leftEntries = fs.readdirSync(path.join(left, relative), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  const rightEntries = fs.readdirSync(path.join(right, relative), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(leftEntries.map((entry) => entry.name), rightEntries.map((entry) => entry.name), `entries at ${relative}`);
  for (const entry of leftEntries) {
    const next = relative === '' ? entry.name : `${relative}/${entry.name}`;
    const leftPath = path.join(left, next);
    const rightPath = path.join(right, next);
    if (entry.isDirectory()) {
      compareTrees(left, right, next);
    } else {
      assert.equal(fs.readFileSync(leftPath, 'utf8'), fs.readFileSync(rightPath, 'utf8'), `content of ${next}`);
    }
  }
}

describe('convergence and idempotence (property)', () => {
  for (const seed of [1, 7, 42]) {
    test(`random tree converges, seed ${seed}`, async () => {
      const workspace = makeWorkspace({ name: `prop-${seed}` });
      try {
        const config = loadConfig(workspace.source);
        const host = config.hosts.node;
        const random = mulberry32(seed);
        const files = new Set();
        const pick = (list) => list[Math.floor(random() * list.length)];

        for (let index = 0; index < 8; index += 1) {
          const name = `dir-${Math.floor(random() * 3)}/file-${index}.txt`;
          writeFile(workspace.source, name, `initial ${index}\n`);
          files.add(name);
        }

        await applyWorkspace(config, host);
        compareTrees(workspace.source, workspace.replica);
        assert.deepEqual((await planWorkspace(config, host)).entries, []);

        for (let step = 0; step < 12; step += 1) {
          const roll = random();
          if (roll < 0.4 || files.size === 0) {
            const name = `dir-${Math.floor(random() * 4)}/new-${step}-${Math.floor(random() * 1000)}.txt`;
            writeFile(workspace.source, name, `step ${step}\n`);
            files.add(name);
          } else if (roll < 0.75) {
            const name = pick([...files]);
            writeFile(workspace.source, name, `modified at ${step}\n`);
          } else {
            const name = pick([...files]);
            fs.rmSync(path.join(workspace.source, name));
            files.delete(name);
          }
          const applied = await applyWorkspace(config, host);
          assert.deepEqual((await planWorkspace(config, host)).entries, [], `plan empty after step ${step}`);
          if (step % 3 === 0) compareTrees(workspace.source, workspace.replica);
          assert.ok(applied.applied >= 0);
        }

        const noop = await applyWorkspace(config, host);
        assert.equal(noop.applied, 0, 'a second apply is a no-op');
        compareTrees(workspace.source, workspace.replica);
      } finally {
        cleanup(workspace);
      }
    });
  }
});
