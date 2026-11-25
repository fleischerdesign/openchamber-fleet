import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { hostViews, selectHost } from '../../dist/hosts.js';
import { runWorkspace, syncForRun } from '../../dist/run.js';
import { AgentError } from '../../dist/v1/errors.js';

function workspace() {
  return {
    name: 'project',
    dir: '/local/project',
    file: '/config/project.json',
    hosts: {
      a: { alias: 'a', ssh: 'u@a', port: 22, root: '/replica/a', tags: ['linux', 'gpu'] },
      b: { alias: 'b', ssh: 'u@b', port: 22, root: '/replica/b', tags: ['linux'] },
    },
    excludes: ['.git'],
    env: {},
    shell: 'bash',
    excludeMatcher: { matches: () => false },
  };
}

function syncSummary(changes = 0) {
  return {
    planDigest: 'sha256:plan',
    changes: Array.from({ length: changes }, (_, index) => ({ action: 'update', path: `file-${index}` })),
    needed: [],
    generation: 7,
    manifestDigest: 'sha256:manifest',
  };
}

const execResult = (state = 'succeeded', exitCode = 0) => ({
  jobId: 'job-1',
  state,
  exitCode,
  signal: null,
  stdout: Buffer.from('ok\n'),
  stderr: Buffer.alloc(0),
});

describe('host selection', () => {
  test('selects an alias and checks its tags', () => {
    const config = workspace();
    assert.equal(selectHost(config, { host: 'a' }).alias, 'a');
    assert.equal(selectHost(config, { host: 'b', tags: ['linux'] }).alias, 'b');
    assert.throws(() => selectHost(config, { host: 'b', tags: ['gpu'] }), /does not match tags/);
    assert.throws(() => selectHost(config, { host: 'missing' }), /unknown host/);
  });

  test('auto-selects the first host with every requested tag', () => {
    const config = workspace();
    assert.equal(selectHost(config, { tags: ['linux'] }).alias, 'a');
    assert.equal(selectHost(config, { tags: ['gpu'] }).alias, 'a');
    assert.equal(selectHost(config, { host: 'auto', tags: ['linux'] }).alias, 'a');
    assert.throws(() => selectHost(config, { tags: ['windows'] }), /no configured host matches/);
  });

  test('views expose a readable tag label', () => {
    assert.deepEqual(hostViews(workspace()).map((view) => [view.alias, view.tagsLabel]), [
      ['a', 'linux, gpu'],
      ['b', 'linux'],
    ]);
  });
});

describe('agent-first run', () => {
  test('auto-syncs and runs in one operation', async () => {
    const calls = [];
    const ops = {
      sync: async (_client, _matcher, options) => {
        calls.push(['sync', options.mode]);
        return syncSummary(2);
      },
      exec: async (_client, options) => {
        calls.push(['exec', options.argv]);
        return execResult();
      },
    };
    const result = await runWorkspace(null, workspace(), workspace().hosts.a, {
      argv: ['echo', 'hi'],
    }, ops);
    assert.deepEqual(calls, [['sync', 'apply'], ['exec', ['echo', 'hi']]]);
    assert.equal(result.state, 'succeeded');
    assert.equal(result.sync?.changes, 2);
    assert.equal(result.exec?.stdout.toString(), 'ok\n');
  });

  test('sync=never skips the workspace scan', async () => {
    let synced = false;
    const result = await runWorkspace(null, workspace(), workspace().hosts.a, {
      argv: ['true'],
      sync: 'never',
    }, {
      sync: async () => { synced = true; return syncSummary(); },
      exec: async () => execResult(),
    });
    assert.equal(synced, false);
    assert.equal(result.sync, null);
    assert.equal(result.state, 'succeeded');
  });

  test('sync=plan reports changes without running the command', async () => {
    let executed = false;
    const result = await runWorkspace(null, workspace(), workspace().hosts.a, {
      argv: ['true'],
      sync: 'plan',
    }, {
      sync: async () => syncSummary(1),
      exec: async () => { executed = true; return execResult(); },
    });
    assert.equal(result.state, 'sync-required');
    assert.equal(result.exec, null);
    assert.equal(executed, false);
    assert.equal(result.sync?.mode, 'plan');
  });

  test('sync=plan never executes, even when the replica is current', async () => {
    let executed = false;
    const result = await runWorkspace(null, workspace(), workspace().hosts.a, {
      argv: ['true'],
      sync: 'plan',
    }, {
      sync: async () => syncSummary(0),
      exec: async () => { executed = true; return execResult(); },
    });
    assert.equal(result.state, 'sync-planned');
    assert.equal(result.exec, null);
    assert.equal(executed, false);
  });

  test('retries a busy workspace with backoff', async () => {
    let attempts = 0;
    const result = await runWorkspace(null, workspace(), workspace().hosts.a, {
      argv: ['true'],
      retryDelayMs: 0,
    }, {
      sync: async () => {
        attempts += 1;
        if (attempts === 1) throw new AgentError('WORKSPACE_BUSY', 'busy', true);
        return syncSummary(0);
      },
      exec: async () => execResult(),
    });
    assert.equal(attempts, 2);
    assert.equal(result.state, 'succeeded');
  });

  test('runs through the pre-exec hook only after synchronization', async () => {
    const events = [];
    await runWorkspace(null, workspace(), workspace().hosts.a, {
      argv: ['true'],
      beforeExec: async () => { events.push('permission'); },
    }, {
      sync: async () => { events.push('sync'); return syncSummary(0); },
      exec: async () => { events.push('exec'); return execResult(); },
    });
    assert.deepEqual(events, ['sync', 'permission', 'exec']);
  });

  test('syncForRun reports a required sync for plan mode', async () => {
    const prepared = await syncForRun(null, workspace(), workspace().hosts.a, {
      argv: ['true'],
      sync: 'plan',
    }, {
      sync: async () => syncSummary(1),
    });
    assert.equal(prepared.required, true);
    assert.equal(prepared.sync?.changes, 1);
  });
});
