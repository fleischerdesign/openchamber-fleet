import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { FLEET_VERSION } from '../../dist/version.js';

function versionOf(relative) {
  const value = JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), 'utf8'));
  return value.version;
}

test('the handshake version matches the package and the extension manifest', () => {
  assert.equal(FLEET_VERSION, versionOf('../../package.json'));
  assert.equal(FLEET_VERSION, versionOf('../../extensions/openchamber/package.json'));
});
