import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseItemized, planDigest } from '../../dist/plan.js';

describe('itemized plan parsing (SYNC-01…SYNC-05)', () => {
  test('classifies adds, updates, metadata changes and deletions', () => {
    const output = [
      'sending incremental file list',
      '>f+++++++++ new.txt',
      '>f.st...... modified.txt',
      '.f..t...... touched.txt',
      'cd+++++++++ dir/',
      '*deleting   old.txt',
      'hf+++++++++ hardlink',
      '',
      'sent 123 bytes  received 45 bytes',
    ].join('\n');
    assert.deepEqual(parseItemized(output), [
      { action: 'add', path: 'new.txt' },
      { action: 'update', path: 'modified.txt' },
      { action: 'metadata', path: 'touched.txt' },
      { action: 'add', path: 'dir/' },
      { action: 'delete', path: 'old.txt' },
      { action: 'add', path: 'hardlink' },
    ]);
  });

  test('ignores rsync chatter', () => {
    assert.deepEqual(parseItemized('sending incremental file list\n\nsent 1 byte\n'), []);
  });

  test('keeps paths with spaces intact', () => {
    assert.deepEqual(parseItemized('>f+++++++++ a b/c d.txt\n'), [{ action: 'add', path: 'a b/c d.txt' }]);
  });

  test('the digest is stable and order-sensitive', () => {
    const first = planDigest([{ action: 'add', path: 'a' }, { action: 'delete', path: 'b' }]);
    const same = planDigest([{ action: 'add', path: 'a' }, { action: 'delete', path: 'b' }]);
    const reordered = planDigest([{ action: 'delete', path: 'b' }, { action: 'add', path: 'a' }]);
    assert.equal(first, same);
    assert.notEqual(first, reordered);
    assert.match(first, /^sha256:[0-9a-f]{64}$/);
  });
});
