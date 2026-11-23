import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { buildOutputHints, detectPresets, excludesFor } from '../../dist/presets.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-presets-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));

function workspace(files) {
  const dir = fs.mkdtempSync(path.join(root, 'ws-'));
  for (const file of files) fs.writeFileSync(path.join(dir, file), '');
  return dir;
}

describe('exclude presets', () => {
  test('detects project kinds from marker files', () => {
    assert.deepEqual(detectPresets(workspace(['Cargo.toml'])), ['rust']);
    assert.deepEqual(detectPresets(workspace(['package.json'])), ['node']);
    assert.deepEqual(detectPresets(workspace(['pyproject.toml'])), ['python']);
    assert.deepEqual(detectPresets(workspace(['flake.nix'])), ['nix']);
    assert.deepEqual(detectPresets(workspace(['README.md'])), []);
  });

  test('a project can match several presets', () => {
    const detected = detectPresets(workspace(['Cargo.toml', 'package.json', 'flake.nix']));
    assert.deepEqual(detected.sort(), ['nix', 'node', 'rust']);
  });

  test('excludes are the union, deduplicated, and always contain .direnv', () => {
    const excludes = excludesFor(['rust', 'node']);
    assert.equal(excludes.includes('target/'), true);
    assert.equal(excludes.includes('node_modules/'), true);
    assert.equal(excludes.includes('.direnv/'), true);
    assert.equal(new Set(excludes).size, excludes.length);
  });

  test('generated output in a plan is named', () => {
    const hints = buildOutputHints([
      { action: 'add', path: 'dist/app.js' },
      { action: 'update', path: 'packages/x/node_modules/y/index.js' },
      { action: 'add', path: 'src/app.ts' },
      { action: 'delete', path: 'build/old.js' },
    ]);
    assert.deepEqual(hints, ['dist', 'node_modules']);
  });
});
