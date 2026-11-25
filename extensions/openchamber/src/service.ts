import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compileExcludes,
  loadConfig,
  loadConfigDocuments,
  saveConfigDocuments,
} from '../../../src/config.js';
import type { HostConfig, WorkspaceConfig } from '../../../src/config.js';
import { FleetError, friendlyErrorMessage } from '../../../src/errors.js';
import {
  configuredStateRoot,
  removeServiceHeartbeat,
  writeRuntimePointer,
  writeServiceHeartbeat,
} from '../../../src/jobs/paths.js';
import { replicaState } from '../../../src/status.js';
import { AgentError } from '../../../src/v1/errors.js';
import { ensureSupervisor, type SupervisorState } from './supervisor-launch.js';
import {
  connectSsh,
  inspectRecovery,
  status,
  syncWorkspace,
} from '../../../src/v1/operations.js';
import type { GuestStatusRow, GuestStatusView } from '@openchamber/sdk';

const port = Number(process.env.OPENCHAMBER_SERVICE_PORT || 0);
const token = process.env.OPENCHAMBER_SERVICE_TOKEN || '';
const dataDir = process.env.OPENCHAMBER_SERVICE_DATA_DIR || '';
const MAX_BODY = 1024 * 1024;

if (!port || !token || !dataDir) {
  process.stderr.write('openchamber-fleet service: missing service environment\n');
  process.exit(1);
}

interface CacheEntry {
  at: number;
  view: GuestStatusView;
}

const cache = new Map<string, CacheEntry>();
let lastDirectory: string | null = null;

function reply(response: http.ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function errorFields(error: unknown): { code: string; message: string } {
  if (error instanceof AgentError) return { code: error.code, message: friendlyErrorMessage(error) };
  if (error instanceof FleetError) return { code: error.code, message: friendlyErrorMessage(error) };
  if (error instanceof Error) return { code: 'INTERNAL', message: friendlyErrorMessage(error) };
  return { code: 'INTERNAL', message: String(error) };
}

function errorLabel(error: unknown): string {
  const code = error instanceof AgentError || error instanceof FleetError ? error.code : 'INTERNAL';
  switch (code) {
    case 'WORKSPACE_BUSY':
    case 'lease-busy':
      return 'Busy';
    case 'RECOVERY_REQUIRED':
      return 'Recovery needed';
    case 'NOT_INITIALIZED':
    case 'WORKSPACE_UNKNOWN':
      return 'Not synced';
    case 'config-missing':
      return 'Not configured';
    case 'config-invalid':
      return 'Configuration error';
    case 'node-unreachable':
    case 'ssh-auth-failed':
    case 'host-key-mismatch':
      return 'Unreachable';
    default:
      return code;
  }
}

async function readBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > MAX_BODY) {
        request.destroy();
        reject(new AgentError('INVALID_REQUEST', 'request body too large'));
      }
    });
    request.on('end', () => {
      try {
        const value = JSON.parse(body || '{}') as unknown;
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected an object');
        resolve(value as Record<string, unknown>);
      } catch (error) {
        reject(new AgentError('INVALID_REQUEST', error instanceof Error ? error.message : String(error)));
      }
    });
  });
}

function directoryOf(value: Record<string, unknown>): string {
  const directory = value.directory;
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
    throw new AgentError('INVALID_REQUEST', 'an absolute project directory is required');
  }
  return directory;
}

function directoryOfQuery(value: string | null): string {
  if (!value || !path.isAbsolute(value)) {
    throw new AgentError('INVALID_REQUEST', 'an absolute project directory is required');
  }
  return value;
}

function hostOf(config: WorkspaceConfig, value: Record<string, unknown>): HostConfig {
  const alias = value.host;
  if (typeof alias !== 'string' || !config.hosts[alias]) {
    throw new AgentError('INVALID_REQUEST', `unknown host ${JSON.stringify(alias)}`);
  }
  return config.hosts[alias]!;
}

function agentPath(): string {
  return process.env.FLEET_AGENT_PATH ?? 'fleet-agent';
}

async function refresh(directory: string): Promise<GuestStatusView> {
  lastDirectory = directory;
  let config: WorkspaceConfig;
  try {
    config = loadConfig(directory);
  } catch (error) {
    const fields = errorFields(error);
    const view: GuestStatusView = {
      rows: [{ kind: 'note', id: 'config', text: `${fields.code}: ${fields.message}`, tone: 'warning' }],
    };
    cache.set(directory, { at: Date.now(), view });
    return view;
  }

  const aliases = Object.keys(config.hosts).slice(0, 12);
  const results = await Promise.allSettled(aliases.map(async (alias) => {
    const host = config.hosts[alias]!;
    const client = await connectSsh(host, { agentPath: agentPath() });
    try {
      return { alias, info: await status(client, config.name, host.root) };
    } finally {
      client.close();
    }
  }));
  const rows: GuestStatusRow[] = [];
  results.forEach((result, index) => {
    const alias = aliases[index]!;
    if (result.status === 'fulfilled') {
      const state = replicaState(result.value.info);
      rows.push({
        kind: 'line',
        id: alias,
        label: alias,
        value: state.label,
        dot: state.tone,
        tooltip: state.tooltip,
      });
    } else {
      const fields = errorFields(result.reason);
      rows.push({
        kind: 'line',
        id: alias,
        label: alias,
        value: errorLabel(result.reason),
        dot: 'error',
        tooltip: fields.message.slice(0, 300),
      });
    }
  });
  if (aliases.length < Object.keys(config.hosts).length) {
    rows.push({ kind: 'note', id: 'limited', text: 'Showing the first 12 configured hosts.', tone: 'muted' });
  }
  const view: GuestStatusView = { rows };
  cache.set(directory, { at: Date.now(), view });
  return view;
}

const server = http.createServer(async (request, response) => {
  if (request.headers.authorization !== `Bearer ${token}`) {
    return reply(response, 401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'invalid service token' } });
  }
  try {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/health') {
      return reply(response, 200, { ok: true });
    }
    if (request.method === 'GET' && url.pathname === '/status-view') {
      const directory = url.searchParams.get('directory');
      if (!directory || !path.isAbsolute(directory)) {
        return reply(response, 200, { rows: [{ kind: 'note', id: 'project', text: 'Open a project to inspect its Fleet hosts.', tone: 'muted' }] });
      }
      const cached = cache.get(directory);
      const view = cached && Date.now() - cached.at < 15_000 ? cached.view : await refresh(directory);
      return reply(response, 200, view);
    }
    if (request.method === 'GET' && url.pathname === '/config') {
      try {
        return reply(response, 200, {
          ok: true,
          result: loadConfigDocuments(directoryOfQuery(url.searchParams.get('directory'))),
        });
      } catch (error) {
        const fields = errorFields(error);
        return reply(response, 400, { ok: false, error: fields });
      }
    }
    if (request.method !== 'POST') {
      return reply(response, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'unknown service route' } });
    }

    const body = await readBody(request);
    const directory = directoryOf(body);
    lastDirectory = directory;

    if (url.pathname === '/config') {
      const result = saveConfigDocuments(directory, body.hosts, body.project, {
        ...(typeof body.revision === 'string' ? { expectedRevision: body.revision } : {}),
      });
      cache.delete(directory);
      return reply(response, 200, { ok: true, result });
    }

    const config = loadConfig(directory);
    const host = hostOf(config, body);

    if (url.pathname === '/status') {
      const client = await connectSsh(host, { agentPath: agentPath() });
      try {
        const info = await status(client, config.name, host.root);
        cache.delete(directory);
        return reply(response, 200, { ok: true, result: { workspace: config.name, host: host.alias, ...info } });
      } finally {
        client.close();
      }
    }
    if (url.pathname === '/plan') {
      const excludes = [...new Set([...config.excludes, ...(Array.isArray(body.excludes) ? body.excludes.map(String) : [])])];
      const client = await connectSsh(host, { agentPath: agentPath() });
      try {
        const result = await syncWorkspace(client, compileExcludes(excludes), {
          workspaceId: config.name,
          source: config.dir,
          root: host.root,
          excludes,
          mode: 'plan',
        });
        cache.delete(directory);
        return reply(response, 200, {
          ok: true,
          result: {
            workspace: config.name,
            host: host.alias,
            mode: 'plan',
            planDigest: result.planDigest,
            changes: result.changes.length,
            needed: result.needed.length,
            items: result.changes.slice(0, 200),
          },
        });
      } finally {
        client.close();
      }
    }
    if (url.pathname === '/recovery') {
      const client = await connectSsh(host, { agentPath: agentPath() });
      try {
        const result = await inspectRecovery(client, config.name, host.root);
        return reply(response, 200, { ok: true, result: { workspace: config.name, host: host.alias, ...result } });
      } finally {
        client.close();
      }
    }
    return reply(response, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'unknown service route' } });
  } catch (error) {
    const fields = errorFields(error);
    return reply(response, 400, { ok: false, error: fields });
  }
});

server.listen(port, '127.0.0.1');
setInterval(() => {
  if (lastDirectory) void refresh(lastDirectory).catch(() => {});
}, 30_000).unref();

function packageVersion(): string {
  try {
    const value = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version?: unknown };
    return typeof value.version === 'string' ? value.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

const stateRoot = configuredStateRoot();
const version = packageVersion();
let lastSupervisor: SupervisorState | null = null;
const logSupervisor = (message: string): void => {
  console.warn(`openchamber-fleet supervisor: ${message}`);
};
const ensure = (): void => {
  void ensureSupervisor({ stateRoot, version, log: logSupervisor }).then((state) => {
    if (state === lastSupervisor) return;
    lastSupervisor = state;
    if (state === 'unavailable') logSupervisor('unavailable; background jobs stay bound to the OpenCode runtime');
    else if (state !== 'disabled') console.log(`openchamber-fleet supervisor: ${state}`);
  }).catch((error: unknown) => {
    logSupervisor(error instanceof Error ? error.message : String(error));
  });
};

try {
  writeRuntimePointer(stateRoot, process.pid);
  writeServiceHeartbeat();
} catch (error) {
  logSupervisor(`could not write the runtime pointer: ${error instanceof Error ? error.message : String(error)}`);
}
ensure();
setInterval(() => {
  try {
    writeServiceHeartbeat();
  } catch (error) {
    logSupervisor(`could not write the service heartbeat: ${error instanceof Error ? error.message : String(error)}`);
  }
  ensure();
}, 5000).unref();

const shutdown = (): void => {
  removeServiceHeartbeat();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
