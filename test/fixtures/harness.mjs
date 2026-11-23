// Shared harness: a temporary workspace, a temporary replica, and the fake SSH transport.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const fakeSsh = path.join(here, 'fake-ssh.mjs');

/**
 * @param {{ name?: string, files?: Record<string, string>, excludes?: string[] }} [options]
 */
export function makeWorkspace(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-it-'));
  const source = path.join(root, 'src');
  const replica = path.join(root, 'replica');
  const state = path.join(root, 'state');
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(replica, { recursive: true });
  fs.mkdirSync(state, { recursive: true });
  const name = options.name ?? 'project';
  fs.writeFileSync(path.join(source, 'fleet.json'), JSON.stringify({
    name,
    hosts: { node: { ssh: 'test@node', root: replica } },
    excludes: options.excludes ?? ['target/', 'node_modules/', '.direnv/'],
    env: {},
  }, null, 2));
  for (const [relative, content] of Object.entries(options.files ?? {})) {
    const target = path.join(source, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  process.env.FLEET_SSH = fakeSsh;
  process.env.FLEET_STATE_DIR = state;
  return { root, source, replica, state, name };
}

export function writeFile(base, relative, content, mode) {
  const target = path.join(base, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  if (mode !== undefined) fs.chmodSync(target, mode);
}

export function readFile(base, relative) {
  return fs.readFileSync(path.join(base, relative), 'utf8');
}

export function exists(base, relative) {
  return fs.existsSync(path.join(base, relative));
}

export function cleanup(workspace) {
  fs.rmSync(workspace.root, { recursive: true, force: true });
}
