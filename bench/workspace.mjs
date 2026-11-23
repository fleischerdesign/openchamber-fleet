#!/usr/bin/env node
/** Benchmark: scan, plan, commit and verify a large tree against the real agent. */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { connectProcess, syncWorkspace } from '../dist/v1/operations.js';
import { compileExcludes } from '../dist/config.js';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};

const files = Number(option('--files', '200000'));
const binary = option('--agent', process.env.FLEET_AGENT_BIN ?? 'agent/target/debug/fleet-agent');
const base = option('--base', '/tmp/fleet-bench');
const source = path.join(base, 'source');
const replica = path.join(base, 'replica');
const state = path.join(base, 'state');

process.env.FLEET_AGENT_STATE_DIR = state;

async function buildSource() {
  await fsp.rm(base, { recursive: true, force: true });
  await fsp.mkdir(state, { recursive: true });
  const perDirectory = 1000;
  for (let directory = 0; directory < Math.ceil(files / perDirectory); directory += 1) {
    const dir = path.join(source, `d${String(directory).padStart(4, '0')}`);
    await fsp.mkdir(dir, { recursive: true });
    await Promise.all(
      Array.from({ length: Math.min(perDirectory, files - directory * perDirectory) }, (_, index) =>
        fsp.writeFile(path.join(dir, `f${String(index).padStart(4, '0')}.txt`), ''),
      ),
    );
  }
  await fsp.writeFile(path.join(source, 'fleet.json'), JSON.stringify({ name: 'bench' }));
}

const now = () => Number(process.hrtime.bigint() / 1000000n);

await buildSource();
const startScan = now();
const { scanWorkspace } = await import('../dist/v1/workspace.js');
const scanned = await scanWorkspace(source, compileExcludes(['target/']));
const scanMs = now() - startScan;
console.log(`files=${files} entries=${scanned.entries.length} scan=${scanMs}ms`);

const client = await connectProcess(binary);
try {
  const startApply = now();
  const applied = await syncWorkspace(client, compileExcludes(['target/']), {
    workspaceId: 'bench',
    source,
    root: replica,
    excludes: ['target/'],
    mode: 'apply',
    adopt: true,
  });
  const applyMs = now() - startApply;
  console.log(`apply=${applyMs}ms changes=${applied.changes.length} generation=${applied.generation}`);

  const startVerify = now();
  const verified = await syncWorkspace(client, compileExcludes(['target/']), {
    workspaceId: 'bench',
    source,
    root: replica,
    excludes: ['target/'],
    mode: 'plan',
  });
  const verifyMs = now() - startVerify;
  console.log(`verify=${verifyMs}ms changes=${verified.changes.length}`);

  const memory = process.memoryUsage();
  console.log(`controller-rss=${Math.round(memory.rss / 1024 / 1024)}MiB`);
} finally {
  client.close();
}

await fsp.rm(base, { recursive: true, force: true });
