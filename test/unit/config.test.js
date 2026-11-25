import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { selectHost } from '../../dist/hosts.js';
import {
  compileExcludes,
  initProjectConfig,
  isOpenChamberInternalDirectory,
  loadConfig,
  loadConfigDocuments,
  loadDefaults,
  loadHostsOnlyConfig,
  loadSessionConfig,
  saveConfigDocuments,
  saveDefaults,
} from '../../dist/config.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-config-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function writeConfig(value) {
  const dir = fs.mkdtempSync(path.join(tmp, 'ws-'));
  fs.writeFileSync(path.join(dir, 'fleet.json'), typeof value === 'string' ? value : JSON.stringify(value));
  return dir;
}

function projectDraft(overrides = {}) {
  return {
    version: 1,
    name: 'project',
    roots: {},
    excludes: [],
    env: {},
    shell: 'bash',
    ...overrides,
  };
}

function aliasesOf(workspace, configDir) {
  return Object.keys(loadConfig(workspace, { configDir }).hosts).sort();
}

describe('fleet.json validation (CFG-01…CFG-08)', () => {
  test('rejects a missing file', () => {
    const configDir = fs.mkdtempSync(path.join(tmp, 'missing-config-'));
    assert.throws(() => loadConfig(tmp, { configDir }), (error) => error.code === 'config-missing');
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
    assert.equal(secondConfig.label, path.basename(second).toLowerCase());
    assert.equal(secondConfig.source, 'project');
    assert.deepEqual(secondConfig.excludes, ['target/']);
  });

  test('a real project without a project file derives a safe workspace', () => {
    const workspace = fs.mkdtempSync(path.join(tmp, 'derived-project-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'derived-config-'));
    fs.writeFileSync(path.join(configDir, 'hosts.json'), JSON.stringify({
      version: 1,
      hosts: { node: { ssh: 'u@h' } },
    }));

    const config = loadConfig(workspace, { configDir });
    assert.equal(config.source, 'derived');
    assert.equal(config.label, path.basename(workspace).toLowerCase());
    assert.match(config.name, /^[a-z0-9._-]+-[0-9a-f]{10}$/);
    assert.deepEqual(config.excludes, ['.git', '.direnv/', 'result*']);
    assert.equal(config.hosts.node.root, `~/.cache/openchamber-fleet/${config.name}`);

    const documents = loadConfigDocuments(workspace, { configDir });
    assert.equal(documents.configSource, 'derived');
    assert.equal(documents.project.name, config.name);
    assert.deepEqual(documents.project.excludes, ['.git', '.direnv/', 'result*']);

    const saved = saveConfigDocuments(workspace, documents.hosts, documents.project, { configDir });
    assert.equal(saved.configSource, 'file');
    assert.equal(loadConfig(workspace, { configDir }).source, 'project');
  });

  test('two checkouts with the same basename derive distinct replicas', () => {
    const first = path.join(tmp, 'same-name', 'a', 'project');
    const second = path.join(tmp, 'same-name', 'b', 'project');
    fs.mkdirSync(first, { recursive: true });
    fs.mkdirSync(second, { recursive: true });
    const configDir = fs.mkdtempSync(path.join(tmp, 'same-name-config-'));
    fs.writeFileSync(path.join(configDir, 'hosts.json'), JSON.stringify({
      version: 1,
      hosts: { node: { ssh: 'u@h' } },
    }));

    const left = loadConfig(first, { configDir });
    const right = loadConfig(second, { configDir });
    assert.equal(left.label, 'project');
    assert.equal(right.label, 'project');
    assert.notEqual(left.name, right.name);
    assert.notEqual(left.hosts.node.root, right.hosts.node.root);
  });

  test('saving a derived config keeps replica identity per checkout', () => {
    const remote = 'https://example.invalid/team/shared.git';
    const first = path.join(tmp, 'scoped', 'first');
    const second = path.join(tmp, 'scoped', 'second');
    fs.mkdirSync(first, { recursive: true });
    fs.mkdirSync(second, { recursive: true });
    for (const checkout of [first, second]) {
      execFileSync('git', ['init', '-q', checkout]);
      execFileSync('git', ['-C', checkout, 'remote', 'add', 'origin', remote]);
    }
    const configDir = fs.mkdtempSync(path.join(tmp, 'scoped-config-'));
    fs.writeFileSync(path.join(configDir, 'hosts.json'), JSON.stringify({
      version: 1,
      hosts: { node: { ssh: 'u@h' } },
    }));

    const documents = loadConfigDocuments(first, { configDir });
    const saved = saveConfigDocuments(first, documents.hosts, documents.project, { configDir });
    assert.equal(saved.project.scope, 'checkout');

    const left = loadConfig(first, { configDir });
    const right = loadConfig(second, { configDir });
    assert.equal(left.label, 'first');
    assert.equal(right.label, 'second');
    assert.notEqual(left.name, right.name);
    assert.notEqual(left.hosts.node.root, right.hosts.node.root);
  });

  test('a real project derives its own workspace instead of borrowing the default', () => {
    const workspace = fs.mkdtempSync(path.join(tmp, 'derived-vs-default-'));
    const defaultProject = fs.mkdtempSync(path.join(tmp, 'derived-default-project-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'derived-default-config-'));
    initProjectConfig(defaultProject, { alias: 'node', ssh: 'u@h', name: 'default-project', configDir });
    saveDefaults(defaultProject, { configDir });

    const resolved = loadSessionConfig(workspace, { configDir });
    assert.equal(resolved.fallback, false);
    assert.equal(resolved.config.dir, fs.realpathSync(workspace));
    assert.equal(resolved.config.source, 'derived');
    assert.notEqual(resolved.config.name, 'default-project');
  });

  test('an implicit project uses every registry host', () => {
    const first = fs.mkdtempSync(path.join(tmp, 'implicit-all-first-'));
    const second = fs.mkdtempSync(path.join(tmp, 'implicit-all-second-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'implicit-all-config-'));
    initProjectConfig(first, { alias: 'mob', ssh: 'u@mob', name: 'first', configDir });
    initProjectConfig(second, { alias: 'work', ssh: 'u@work', name: 'second', configDir });

    assert.deepEqual(aliasesOf(first, configDir), ['mob', 'work']);
    assert.deepEqual(aliasesOf(second, configDir), ['mob', 'work']);
  });

  test('init keeps an implicit project implicit and extends an explicit allowlist', () => {
    const workspace = fs.mkdtempSync(path.join(tmp, 'init-allowlist-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'init-allowlist-config-'));
    initProjectConfig(workspace, { alias: 'mob', ssh: 'u@mob', configDir });
    const implicit = initProjectConfig(workspace, { alias: 'work', ssh: 'u@work', configDir });
    assert.equal(implicit.project.hosts, undefined);

    saveConfigDocuments(workspace, implicit.hosts, projectDraft({ hosts: ['mob'] }), { configDir });
    const explicit = initProjectConfig(workspace, { alias: 'work', ssh: 'u@work', configDir });
    assert.deepEqual(explicit.project.hosts, ['mob', 'work']);
    assert.deepEqual(aliasesOf(workspace, configDir), ['mob', 'work']);
  });

  test('an explicit hosts allowlist restricts the registry', () => {
    const first = fs.mkdtempSync(path.join(tmp, 'allowlist-first-'));
    const second = fs.mkdtempSync(path.join(tmp, 'allowlist-second-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'allowlist-config-'));
    initProjectConfig(first, { alias: 'mob', ssh: 'u@mob', name: 'first', configDir });
    const documents = initProjectConfig(second, {
      alias: 'work',
      ssh: 'u@work',
      name: 'second',
      configDir,
    });
    saveConfigDocuments(second, documents.hosts, projectDraft({
      name: 'second',
      hosts: ['mob'],
    }), { configDir });

    assert.deepEqual(aliasesOf(second, configDir), ['mob']);
    assert.deepEqual(aliasesOf(first, configDir), ['mob', 'work']);
  });

  test('requires filters hosts by every tag', () => {
    const workspace = fs.mkdtempSync(path.join(tmp, 'requires-workspace-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'requires-config-'));
    initProjectConfig(workspace, { alias: 'gpu', ssh: 'u@gpu', tags: ['linux', 'gpu'], configDir });
    const documents = initProjectConfig(workspace, { alias: 'cpu', ssh: 'u@cpu', tags: ['linux'], configDir });
    assert.deepEqual(aliasesOf(workspace, configDir), ['cpu', 'gpu']);

    const linuxOnly = saveConfigDocuments(workspace, documents.hosts, projectDraft({
      name: 'linux-only',
      requires: ['linux'],
    }), { configDir });
    assert.deepEqual(aliasesOf(workspace, configDir), ['cpu', 'gpu']);

    saveConfigDocuments(workspace, linuxOnly.hosts, projectDraft({
      name: 'linux-gpu',
      requires: ['linux', 'gpu'],
    }), { configDir });
    assert.deepEqual(aliasesOf(workspace, configDir), ['gpu']);
  });

  test('a selected host must satisfy requires', () => {
    const workspace = fs.mkdtempSync(path.join(tmp, 'requires-selected-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'requires-selected-config-'));
    initProjectConfig(workspace, { alias: 'linux', ssh: 'u@linux', tags: ['linux'], configDir });
    const documents = initProjectConfig(workspace, {
      alias: 'gpu',
      ssh: 'u@gpu',
      tags: ['gpu'],
      configDir,
    });

    assert.throws(
      () => saveConfigDocuments(workspace, documents.hosts, projectDraft({
        hosts: ['linux', 'gpu'],
        requires: ['linux'],
      }), { configDir }),
      /do not satisfy project\.requires: gpu lacks linux/,
    );
  });

  test('an empty or duplicate allowlist is rejected', () => {
    const workspace = fs.mkdtempSync(path.join(tmp, 'invalid-allowlist-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'invalid-allowlist-config-'));
    initProjectConfig(workspace, { alias: 'mob', ssh: 'u@h', configDir });
    const documents = loadConfigDocuments(workspace, { configDir });

    assert.throws(
      () => saveConfigDocuments(workspace, documents.hosts, projectDraft({ hosts: [] }), { configDir }),
      /project\.hosts is an empty allowlist/,
    );
    assert.throws(
      () => saveConfigDocuments(workspace, documents.hosts, projectDraft({ hosts: ['mob', 'mob'] }), { configDir }),
      /project\.hosts contains duplicate/,
    );
    assert.throws(
      () => saveConfigDocuments(workspace, documents.hosts, projectDraft({
        requires: ['linux', 'linux'],
      }), { configDir }),
      /project\.requires contains duplicate/,
    );
  });

  test('an empty allowlist is repairable in the editor but refused when loading', () => {
    const workspace = fs.mkdtempSync(path.join(tmp, 'repair-allowlist-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'repair-allowlist-config-'));
    const documents = initProjectConfig(workspace, { alias: 'mob', ssh: 'u@h', configDir });
    fs.writeFileSync(documents.projectFile, JSON.stringify({
      ...documents.project,
      hosts: [],
    }, null, 2));

    const editable = loadConfigDocuments(workspace, { configDir });
    assert.deepEqual(editable.project.hosts, []);
    assert.throws(() => loadConfig(workspace, { configDir }), /empty allowlist/);

    const repaired = saveConfigDocuments(workspace, editable.hosts, {
      ...editable.project,
      hosts: undefined,
    }, { configDir });
    assert.equal(repaired.project.hosts, undefined);
    assert.deepEqual(aliasesOf(workspace, configDir), ['mob']);
  });

  test('no host satisfying requires is a configuration error', () => {
    const workspace = fs.mkdtempSync(path.join(tmp, 'requires-none-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'requires-none-config-'));
    initProjectConfig(workspace, { alias: 'cpu', ssh: 'u@cpu', tags: ['linux'], configDir });
    const documents = loadConfigDocuments(workspace, { configDir });

    assert.throws(
      () => saveConfigDocuments(workspace, documents.hosts, projectDraft({
        requires: ['gpu'],
      }), { configDir }),
      /no configured host satisfies requires: gpu/,
    );
  });

  test('a replica root must target a selected host', () => {
    const workspace = fs.mkdtempSync(path.join(tmp, 'root-selected-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'root-selected-config-'));
    initProjectConfig(workspace, { alias: 'linux', ssh: 'u@linux', tags: ['linux'], configDir });
    const documents = initProjectConfig(workspace, {
      alias: 'gpu',
      ssh: 'u@gpu',
      tags: ['gpu'],
      configDir,
    });

    assert.throws(
      () => saveConfigDocuments(workspace, documents.hosts, projectDraft({
        requires: ['linux'],
        roots: { gpu: '/srv/gpu' },
      }), { configDir }),
      /roots for unselected host/,
    );
    assert.throws(
      () => saveConfigDocuments(workspace, documents.hosts, projectDraft({
        hosts: ['linux'],
        roots: { gpu: '/srv/gpu' },
      }), { configDir }),
      /roots for unselected host/,
    );
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

  test('host operation allowances are parsed, enforced and round-tripped', () => {
    const workspace = fs.mkdtempSync(path.join(tmp, 'allow-ops-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'allow-ops-config-'));
    fs.writeFileSync(path.join(configDir, 'hosts.json'), JSON.stringify({
      version: 1,
      hosts: { scratch: { ssh: 'u@h', allow: ['scratch'] } },
    }));
    const config = loadConfig(workspace, { configDir });
    assert.deepEqual(config.hosts.scratch.allow, ['scratch']);
    assert.equal(selectHost(config, { operation: 'scratch' }).alias, 'scratch');
    assert.throws(
      () => selectHost(config, { operation: 'workspace' }),
      /not allowed|no configured host matches/,
    );
    const documents = loadConfigDocuments(workspace, { configDir });
    assert.deepEqual(documents.hosts.hosts.scratch.allow, ['scratch']);
  });

  test('invalid host operation allowances are refused', () => {
    const workspace = fs.mkdtempSync(path.join(tmp, 'bad-allow-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'bad-allow-config-'));
    fs.writeFileSync(path.join(configDir, 'hosts.json'), JSON.stringify({
      version: 1,
      hosts: { node: { ssh: 'u@h', allow: ['everything'] } },
    }));
    assert.throws(() => loadConfig(workspace, { configDir }), /allow entries must be one of/);
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
    // A new project does not pin machines; it uses the global registry.
    assert.equal(documents.project.hosts, undefined);
    assert.equal(loadConfig(second, { configDir }).hosts.mob.ssh, 'u@h');
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

  test('save refuses to delete a host another project selects explicitly', () => {
    const first = fs.mkdtempSync(path.join(tmp, 'shared-first-'));
    const second = fs.mkdtempSync(path.join(tmp, 'shared-second-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'shared-config-'));
    const firstDocuments = initProjectConfig(first, { alias: 'mob', ssh: 'u@h', name: 'first', configDir });
    saveConfigDocuments(first, firstDocuments.hosts, {
      ...firstDocuments.project,
      hosts: ['mob'],
    }, { configDir });
    const secondDocuments = initProjectConfig(second, {
      alias: 'mob',
      ssh: 'u@h',
      name: 'second',
      configDir,
    });

    assert.throws(
      () => saveConfigDocuments(second, {
        version: 1,
        hosts: { other: { ssh: 'u@h' } },
      }, {
        ...secondDocuments.project,
        hosts: ['other'],
      }, { configDir }),
      /still referenced by another project/,
    );
  });

  test('save refuses to delete a host another project uses as a replica root', () => {
    const first = fs.mkdtempSync(path.join(tmp, 'root-first-'));
    const second = fs.mkdtempSync(path.join(tmp, 'root-second-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'root-config-'));
    const firstDocuments = initProjectConfig(first, { alias: 'mob', ssh: 'u@h', name: 'first', configDir });
    saveConfigDocuments(first, firstDocuments.hosts, {
      ...firstDocuments.project,
      roots: { mob: '/srv/first' },
    }, { configDir });
    const secondDocuments = initProjectConfig(second, {
      alias: 'mob',
      ssh: 'u@h',
      name: 'second',
      configDir,
    });

    assert.throws(
      () => saveConfigDocuments(second, {
        version: 1,
        hosts: { other: { ssh: 'u@h' } },
      }, {
        ...secondDocuments.project,
        hosts: ['other'],
      }, { configDir }),
      /still referenced by another project/,
    );
  });

  test('an implicit project follows host removal from the global registry', () => {
    const first = fs.mkdtempSync(path.join(tmp, 'implicit-first-'));
    const second = fs.mkdtempSync(path.join(tmp, 'implicit-second-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'implicit-config-'));
    initProjectConfig(first, { alias: 'mob', ssh: 'u@mob', name: 'first', configDir });
    initProjectConfig(second, { alias: 'work', ssh: 'u@work', name: 'second', configDir });

    assert.deepEqual(Object.keys(loadConfig(first, { configDir }).hosts).sort(), ['mob', 'work']);

    const documents = loadConfigDocuments(second, { configDir });
    saveConfigDocuments(second, {
      version: 1,
      hosts: { work: { ssh: 'u@work' } },
    }, documents.project, { configDir });

    assert.deepEqual(Object.keys(loadConfig(first, { configDir }).hosts), ['work']);
  });

  test('an editor view keeps the host registry for a new project', () => {
    const first = fs.mkdtempSync(path.join(tmp, 'editor-first-'));
    const second = fs.mkdtempSync(path.join(tmp, 'editor-second-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'editor-config-'));
    initProjectConfig(first, { alias: 'mob', ssh: 'u@h', name: 'first', configDir });

    const documents = loadConfigDocuments(second, { configDir });
    assert.deepEqual(Object.keys(documents.hosts.hosts), ['mob']);
    assert.equal(documents.project.hosts, undefined);
    assert.equal(documents.legacy, false);
  });

  test('an editor view still shows a project whose registry is missing', () => {
    const workspace = fs.mkdtempSync(path.join(tmp, 'editor-missing-registry-'));
    const configDir = fs.mkdtempSync(path.join(tmp, 'editor-missing-registry-config-'));
    const documents = initProjectConfig(workspace, {
      alias: 'mob',
      ssh: 'u@h',
      name: 'kept',
      configDir,
    });
    fs.rmSync(documents.hostsFile);

    const editable = loadConfigDocuments(workspace, { configDir });
    assert.equal(editable.project.name, 'kept');
    assert.equal(editable.project.hosts, undefined);
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
    assert.equal(empty.project.hosts, undefined);
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
    assert.equal(saved.project.scope, 'checkout');
    const loaded = loadConfig(workspace, { configDir });
    assert.equal(loaded.hosts.build.root, '~/.cache/openchamber-fleet/' + loaded.name);
  });
});

describe('projectless default workspace', () => {
  test('falls back only for OpenChamber chat directories, never for a real project', () => {
    const configDir = fs.mkdtempSync(path.join(tmp, 'defaults-'));
    const project = fs.mkdtempSync(path.join(tmp, 'default-project-'));
    initProjectConfig(project, { alias: 'mob', ssh: 'u@h', name: 'default-project', configDir });
    const chat = path.join(tmp, '.config', 'openchamber', 'chats', 'session-1');
    fs.mkdirSync(chat, { recursive: true });
    const unconfigured = fs.mkdtempSync(path.join(tmp, 'unconfigured-'));

    assert.equal(isOpenChamberInternalDirectory(chat), true);
    assert.equal(isOpenChamberInternalDirectory(project), false);
    assert.throws(() => loadSessionConfig(chat, { configDir }), (error) => error.code === 'config-missing');
    const derived = loadSessionConfig(unconfigured, { configDir });
    assert.equal(derived.fallback, false);
    assert.equal(derived.config.source, 'derived');
    assert.notEqual(derived.config.name, 'default-project');

    const saved = saveDefaults(project, { configDir });
    assert.equal(saved.directory, fs.realpathSync(project));
    assert.equal(loadDefaults({ configDir }).directory, fs.realpathSync(project));
    const resolved = loadSessionConfig(chat, { configDir });
    assert.equal(resolved.fallback, true);
    assert.equal(resolved.config.name, 'default-project');
    assert.equal(loadHostsOnlyConfig(chat, { configDir }).hosts.mob.ssh, 'u@h');
    const stillDerived = loadSessionConfig(unconfigured, { configDir });
    assert.equal(stillDerived.fallback, false);
    assert.equal(stillDerived.config.source, 'derived');

    saveDefaults(null, { configDir });
    assert.throws(() => loadSessionConfig(chat, { configDir }), /no default workspace/);
  });

  test('rejects a default that is not an existing directory', () => {
    const configDir = fs.mkdtempSync(path.join(tmp, 'defaults-invalid-'));
    assert.throws(() => saveDefaults(path.join(tmp, 'missing-directory'), { configDir }), /does not exist/);
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
