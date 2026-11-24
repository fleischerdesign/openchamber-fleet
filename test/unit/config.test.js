import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import {
  compileExcludes,
  initProjectConfig,
  loadConfig,
  loadConfigDocuments,
  saveConfigDocuments,
} from '../../dist/config.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-config-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function writeConfig(value) {
  const dir = fs.mkdtempSync(path.join(tmp, 'ws-'));
  fs.writeFileSync(path.join(dir, 'fleet.json'), typeof value === 'string' ? value : JSON.stringify(value));
  return dir;
}

describe('fleet.json validation (CFG-01…CFG-08)', () => {
  test('rejects a missing file', () => {
    assert.throws(() => loadConfig(tmp), (error) => error.code === 'config-missing');
  });

  test('rejects unknown top-level keys', () => {
    const dir = writeConfig({ name: 'x', hosts: { a: { ssh: 'u@h' } }, exclueds: [] });
    assert.throws(() => loadConfig(dir), /unknown key/);
  });

  test('rejects an invalid workspace name', () => {
    const dir = writeConfig({ name: 'Bad Name', hosts: { a: { ssh: 'u@h' } } });
    assert.throws(() => loadConfig(dir), /workspace name/);
  });

  test('rejects a host without ssh', () => {
    const dir = writeConfig({ name: 'x', hosts: { a: {} } });
    assert.throws(() => loadConfig(dir), /ssh/);
  });

  test('rejects an invalid ssh target', () => {
    const dir = writeConfig({ name: 'x', hosts: { a: { ssh: 'no-at-sign' } } });
    assert.throws(() => loadConfig(dir), /user@host/);
  });

  test('rejects a relative root (CFG-05)', () => {
    const dir = writeConfig({ name: 'x', hosts: { a: { ssh: 'u@h', root: 'relative' } } });
    assert.throws(() => loadConfig(dir), /absolute/);
  });

  test('rejects non-string env values (CFG-08)', () => {
    const dir = writeConfig({ name: 'x', hosts: { a: { ssh: 'u@h' } }, env: { A: 1 } });
    assert.throws(() => loadConfig(dir), /must be a string/);
  });

  test('applies defaults and strips a trailing slash from root', () => {
    const dir = writeConfig({ name: 'x', hosts: { a: { ssh: 'u@h', root: '/srv/x/' } } });
    const config = loadConfig(dir);
    assert.equal(config.hosts.a.port, 22);
    assert.equal(config.hosts.a.root, '/srv/x');
    assert.equal(config.shell, "bash");
  });

  test('defaults the replica root from the workspace name', () => {
    const dir = writeConfig({ name: 'proj', hosts: { a: { ssh: 'u@h' } } });
    assert.equal(loadConfig(dir).hosts.a.root, '~/.cache/openchamber-fleet/proj');
  });

  test('accepts 1000 excludes', () => {
    const excludes = Array.from({ length: 1000 }, (_, index) => `dir-${index}/`);
    const dir = writeConfig({ name: 'x', hosts: { a: { ssh: 'u@h' } }, excludes });
    assert.equal(loadConfig(dir).excludes.length, 1000);
  });
});

describe('split host registry and project configuration', () => {
  test('init writes outside the workspace and resolves the selected host', () => {
    const workspace = fs.mkdtempSync(path.join(tmp, 'project-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'config-'));
    const documents = initProjectConfig(workspace, {
      alias: 'mob',
      ssh: 'philipp@10.10.100.30',
      port: 2222,
      root: '/srv/nixfiles',
      name: 'nixfiles',
      configDir,
    });

    assert.equal(fs.existsSync(path.join(workspace, 'fleet.json')), false);
    assert.equal(path.dirname(documents.hostsFile), configDir);
    assert.equal(path.dirname(documents.projectFile), path.join(configDir, 'workspaces'));

    const config = loadConfig(workspace, { configDir });
    assert.equal(config.name, 'nixfiles');
    assert.equal(config.hosts.mob.ssh, 'philipp@10.10.100.30');
    assert.equal(config.hosts.mob.port, 2222);
    assert.equal(config.hosts.mob.root, '/srv/nixfiles');
    assert.equal(config.source, 'project');
  });

  test('one host registry serves multiple projects', () => {
    const first = fs.mkdtempSync(path.join(tmp, 'first-'));
    const second = fs.mkdtempSync(path.join(tmp, 'second-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'shared-'));
    const documents = initProjectConfig(first, {
      alias: 'mob',
      ssh: 'philipp@10.10.100.30',
      name: 'first',
      configDir,
    });
    saveConfigDocuments(second, documents.hosts, {
      ...documents.project,
      name: 'second',
      hosts: ['mob'],
      excludes: ['target/'],
    }, { configDir });

    assert.equal(loadConfig(first, { configDir }).hosts.mob.ssh, 'philipp@10.10.100.30');
    const secondConfig = loadConfig(second, { configDir });
    assert.equal(secondConfig.name, 'second');
    assert.deepEqual(secondConfig.excludes, ['target/']);
  });

  test('rejects a project that selects an undefined host', () => {
    const workspace = fs.mkdtempSync(path.join(tmp, 'missing-host-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'missing-host-config-'));
    assert.throws(
      () => saveConfigDocuments(workspace, {
        version: 1,
        hosts: { other: { ssh: 'u@h' } },
      }, {
        version: 1,
        name: 'proj',
        hosts: ['nope'],
        roots: {},
        excludes: [],
        env: {},
        shell: 'bash',
      }, { configDir }),
      /unknown host alias/,
    );
  });

  test('init migrates a legacy fleet.json without losing project settings', () => {
    const workspace = writeConfig({
      name: 'legacy',
      hosts: { old: { ssh: 'u@old', port: 2222, root: '/srv/old' } },
      excludes: ['secret/'],
      env: { TOKEN: 'token' },
      shell: 'zsh',
    });
    const configDir = fs.mkdtempSync(path.join(tmp, 'legacy-config-'));
    const legacy = loadConfig(workspace, { configDir });
    assert.equal(legacy.source, 'legacy');
    assert.equal(legacy.name, 'legacy');

    initProjectConfig(workspace, { alias: 'new', ssh: 'u@new', configDir });
    const migrated = loadConfig(workspace, { configDir });
    assert.equal(migrated.source, 'project');
    assert.equal(migrated.name, 'legacy');
    assert.deepEqual(Object.keys(migrated.hosts).sort(), ['new', 'old']);
    assert.equal(migrated.hosts.old.ssh, 'u@old');
    assert.equal(migrated.hosts.old.port, 2222);
    assert.equal(migrated.hosts.old.root, '/srv/old');
    assert.equal(migrated.hosts.new.root, '~/.cache/openchamber-fleet/legacy');
    assert.deepEqual(migrated.excludes, ['secret/']);
    assert.deepEqual(migrated.env, { TOKEN: 'token' });
    assert.equal(migrated.shell, 'zsh');
  });

  test('host tags round-trip through the split documents', () => {
    const workspace = fs.mkdtempSync(path.join(tmp, 'tags-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'tags-config-'));
    const documents = initProjectConfig(workspace, {
      alias: 'mob',
      ssh: 'u@h',
      name: 'tagged',
      tags: ['linux', 'gpu'],
      configDir,
    });
    assert.deepEqual(documents.hosts.hosts.mob.tags, ['linux', 'gpu']);
    assert.deepEqual(loadConfig(workspace, { configDir }).hosts.mob.tags, ['linux', 'gpu']);

    const editable = loadConfigDocuments(workspace, { configDir });
    saveConfigDocuments(workspace, editable.hosts, editable.project, { configDir });
    assert.deepEqual(loadConfig(workspace, { configDir }).hosts.mob.tags, ['linux', 'gpu']);
  });

  test('rejects invalid host tags', () => {
    const workspace = fs.mkdtempSync(path.join(tmp, 'bad-tag-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'bad-tag-config-'));
    assert.throws(
      () => initProjectConfig(workspace, { alias: 'mob', ssh: 'u@h', tags: ['Bad Tag'], configDir }),
      /host tag/,
    );
  });

  test('legacy host tags survive migration', () => {
    const workspace = writeConfig({
      name: 'legacy-tags',
      hosts: { old: { ssh: 'u@h', tags: ['legacy'] } },
    });
    const configDir = fs.mkdtempSync(path.join(tmp, 'legacy-tags-config-'));
    initProjectConfig(workspace, { alias: 'new', ssh: 'u@h', configDir });
    const config = loadConfig(workspace, { configDir });
    assert.deepEqual(config.hosts.old.tags, ['legacy']);
    assert.deepEqual(config.hosts.new.tags, []);
  });

  test('init selects an existing host without rebinding it', () => {
    const first = fs.mkdtempSync(path.join(tmp, 'select-first-'));
    const second = fs.mkdtempSync(path.join(tmp, 'select-second-'));
    const third = fs.mkdtempSync(path.join(tmp, 'select-third-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'select-config-'));
    initProjectConfig(first, { alias: 'mob', ssh: 'u@h', name: 'first', configDir });

    const documents = initProjectConfig(second, { alias: 'mob', ssh: 'u@h', name: 'second', configDir });
    assert.deepEqual(documents.project.hosts, ['mob']);
    assert.throws(
      () => initProjectConfig(third, { alias: 'mob', ssh: 'u@other', configDir }),
      /different SSH target/,
    );
    const forced = initProjectConfig(third, { alias: 'mob', ssh: 'u@other', configDir, force: true });
    assert.equal(forced.hosts.hosts.mob.ssh, 'u@other');
  });

  test('save rejects an invalid exclude instead of writing a broken project', () => {
    const workspace = fs.mkdtempSync(path.join(tmp, 'invalid-exclude-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'invalid-exclude-config-'));
    initProjectConfig(workspace, { alias: 'mob', ssh: 'u@h', configDir });
    const documents = loadConfigDocuments(workspace, { configDir });
    assert.throws(
      () => saveConfigDocuments(workspace, documents.hosts, {
        ...documents.project,
        excludes: ['../secret'],
      }, { configDir }),
      /must not contain/,
    );
  });

  test('save rejects a stale revision and accepts a fresh one', () => {
    const workspace = fs.mkdtempSync(path.join(tmp, 'revision-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'revision-config-'));
    initProjectConfig(workspace, { alias: 'mob', ssh: 'u@h', configDir });
    const documents = loadConfigDocuments(workspace, { configDir });

    const hostsFile = path.join(configDir, 'hosts.json');
    const changed = JSON.parse(fs.readFileSync(hostsFile, 'utf8'));
    changed.hosts.other = { ssh: 'u@other' };
    fs.writeFileSync(hostsFile, JSON.stringify(changed, null, 2));

    assert.throws(
      () => saveConfigDocuments(workspace, documents.hosts, documents.project, {
        configDir,
        expectedRevision: documents.revision,
      }),
      /changed since it was loaded/,
    );

    const fresh = loadConfigDocuments(workspace, { configDir });
    const saved = saveConfigDocuments(workspace, fresh.hosts, {
      ...fresh.project,
      excludes: ['target/'],
    }, { configDir, expectedRevision: fresh.revision });
    assert.equal(saved.project.excludes[0], 'target/');
  });

  test('a legacy revision covers the legacy file itself', () => {
    const workspace = writeConfig({ name: 'legacy', hosts: { old: { ssh: 'u@h' } } });
    const configDir = fs.mkdtempSync(path.join(tmp, 'legacy-revision-config-'));
    const documents = loadConfigDocuments(workspace, { configDir });
    assert.equal(documents.legacy, true);

    fs.writeFileSync(path.join(workspace, 'fleet.json'), JSON.stringify({
      name: 'changed',
      hosts: { old: { ssh: 'u@other' } },
    }));
    assert.throws(
      () => saveConfigDocuments(workspace, documents.hosts, documents.project, {
        configDir,
        expectedRevision: documents.revision,
      }),
      /changed since it was loaded/,
    );
  });

  test('save refuses to delete a host another project still selects', () => {
    const first = fs.mkdtempSync(path.join(tmp, 'shared-first-'));
    const second = fs.mkdtempSync(path.join(tmp, 'shared-second-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'shared-config-'));
    const firstDocuments = initProjectConfig(first, { alias: 'mob', ssh: 'u@h', name: 'first', configDir });
    saveConfigDocuments(second, firstDocuments.hosts, {
      ...firstDocuments.project,
      name: 'second',
      hosts: ['mob'],
    }, { configDir });

    assert.throws(
      () => saveConfigDocuments(second, {
        version: 1,
        hosts: { other: { ssh: 'u@h' } },
      }, {
        ...firstDocuments.project,
        name: 'second',
        hosts: ['other'],
      }, { configDir }),
      /still selected by another project/,
    );
  });

  test('an editor view keeps the host registry for a new project', () => {
    const first = fs.mkdtempSync(path.join(tmp, 'editor-first-'));
    const second = fs.mkdtempSync(path.join(tmp, 'editor-second-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'editor-config-'));
    initProjectConfig(first, { alias: 'mob', ssh: 'u@h', name: 'first', configDir });

    const documents = loadConfigDocuments(second, { configDir });
    assert.deepEqual(Object.keys(documents.hosts.hosts), ['mob']);
    assert.equal(documents.project.hosts.length, 0);
    assert.equal(documents.legacy, false);
  });

  test('an editor view still shows a project whose registry is missing', () => {
    const workspace = fs.mkdtempSync(path.join(tmp, 'editor-missing-registry-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'editor-missing-registry-config-'));
    const documents = initProjectConfig(workspace, { alias: 'mob', ssh: 'u@h', configDir });
    fs.rmSync(documents.hostsFile);

    const editable = loadConfigDocuments(workspace, { configDir });
    assert.deepEqual(editable.project.hosts, ['mob']);
    assert.deepEqual(editable.hosts.hosts, {});
  });

  test('a split project is not reported as legacy while fleet.json remains', () => {
    const workspace = writeConfig({ name: 'legacy', hosts: { old: { ssh: 'u@h' } } });
    const configDir = fs.mkdtempSync(path.join(tmp, 'editor-legacy-config-'));
    initProjectConfig(workspace, { alias: 'new', ssh: 'u@h', configDir });

    const documents = loadConfigDocuments(workspace, { configDir });
    assert.equal(documents.legacy, false);
    assert.deepEqual(documents.project.hosts.sort(), ['new', 'old']);
  });

  test('documents default cleanly and round-trip through save', () => {
    const workspace = fs.mkdtempSync(path.join(tmp, 'docs-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'docs-config-'));
    const empty = loadConfigDocuments(workspace, { configDir });
    assert.equal(empty.project.hosts.length, 0);
    assert.equal(empty.hosts.hosts && Object.keys(empty.hosts.hosts).length, 0);

    const saved = saveConfigDocuments(workspace, {
      version: 1,
      hosts: { build: { ssh: 'u@h' } },
    }, {
      ...empty.project,
      hosts: ['build'],
      excludes: ['.direnv/'],
    }, { configDir });
    assert.equal(saved.project.hosts[0], 'build');
    assert.equal(loadConfig(workspace, { configDir }).hosts.build.root, '~/.cache/openchamber-fleet/' + empty.project.name);
  });
});

describe('exclude semantics (SYNC-35…SYNC-38)', () => {
  test('name/ matches a directory at any depth and its contents', () => {
    const matcher = compileExcludes(['target/']);
    assert.equal(matcher.matches('target', true), true);
    assert.equal(matcher.matches('a/target', true), true);
    assert.equal(matcher.matches('a/target/file', false), true);
    assert.equal(matcher.matches('target.txt', false), false);
    assert.equal(matcher.matches('target', false), false);
  });

  test('/dist is anchored', () => {
    const matcher = compileExcludes(['/dist']);
    assert.equal(matcher.matches('dist', true), true);
    assert.equal(matcher.matches('dist/app.bin', false), true);
    assert.equal(matcher.matches('pkg/dist', true), false);
  });

  test('*.log matches basenames at any depth', () => {
    const matcher = compileExcludes(['*.log']);
    assert.equal(matcher.matches('a/b.log', false), true);
    assert.equal(matcher.matches('b.log', false), true);
    assert.equal(matcher.matches('a/blog', false), false);
    assert.equal(matcher.matches('logs.log/x', false), true);
  });

  test('dir/** matches the subtree', () => {
    const matcher = compileExcludes(['build/**']);
    assert.equal(matcher.matches('build/a/b', false), true);
    assert.equal(matcher.matches('build', true), false);
    assert.equal(matcher.matches('pkg/build/a', false), true);
  });

  test('**/tmp/ matches at any depth', () => {
    const matcher = compileExcludes(['**/tmp/']);
    assert.equal(matcher.matches('a/b/tmp', true), true);
    assert.equal(matcher.matches('a/b/tmp/x', false), true);
    assert.equal(matcher.matches("tmp", true), true);
  });
});
