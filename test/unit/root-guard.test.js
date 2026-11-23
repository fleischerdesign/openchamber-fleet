import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { assertSafeRemoteRoot } from '../../dist/sync.js';

describe('replica root guard (SYNC-42)', () => {
  test('accepts a dedicated directory', () => {
    assertSafeRemoteRoot('/home/philipp/.cache/openchamber-fleet/proj', '/home/philipp');
    assertSafeRemoteRoot('/srv/data/proj', '/root');
    assertSafeRemoteRoot('/tmp/fleet-it-abc/replica', '/root');
  });

  test('refuses roots whose deletion is destructive', () => {
    for (const root of ['/', '/home', '/root', '/usr', '/etc', '/srv', '/tmp']) {
      assert.throws(() => assertSafeRemoteRoot(root, '/home/philipp'), (error) => error.code === 'config-invalid', root);
    }
  });

  test('refuses the home directory itself', () => {
    assert.throws(() => assertSafeRemoteRoot('/home/philipp', '/home/philipp'), /too broad/);
    assert.throws(() => assertSafeRemoteRoot('/home/philipp/', '/home/philipp'), /too broad/);
  });
});
