import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FleetError } from '../../dist/errors.js';
import { assertRelativePath, assertRemoteRoot, quoteArgv, quoteShell } from '../../dist/paths.js';

describe('path validation (SEC-04, SYNC-18)', () => {
  test('accepts and normalizes relative paths', () => {
    assert.equal(assertRelativePath('target/app'), 'target/app');
    assert.equal(assertRelativePath('./dist/../dist/app'), 'dist/app');
    assert.equal(assertRelativePath('with space/file'), 'with space/file');
  });

  test('rejects traversal and absolute paths', () => {
    for (const value of ['../x', 'a/../../x', '/etc/passwd', '..', '']) {
      assert.throws(() => assertRelativePath(value), (error) => error instanceof FleetError && error.code === 'usage');
    }
  });

  test('rejects NUL', () => {
    assert.throws(() => assertRelativePath('a\0b'), /NUL/);
  });

  test('remote roots must be absolute or ~/', () => {
    assert.equal(assertRemoteRoot('/srv/x/'), '/srv/x');
    assert.equal(assertRemoteRoot('~/x'), '~/x');
    assert.throws(() => assertRemoteRoot('relative/path'), /absolute/);
  });
});

describe('shell quoting (EXEC-03, EXEC-04)', () => {
  test('single quotes are escaped', () => {
    assert.equal(quoteShell("it's"), "'it'\\''s'");
  });

  test('argv quoting preserves boundaries', () => {
    assert.equal(quoteArgv(['a b', 'c']), "'a b' 'c'");
  });

  test('newlines survive quoting', () => {
    assert.equal(quoteShell('a\nb'), "'a\nb'");
  });
});
