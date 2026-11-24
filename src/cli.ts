/** Command line interface on top of fleet.agent.v1. */

import fs from 'node:fs';
import path from 'node:path';
import { compileExcludes, configPaths, defaultWorkspaceName, initProjectConfig, loadConfig } from './config.js';
import type { HostConfig, WorkspaceConfig } from './config.js';
import { FleetError, friendlyErrorMessage } from './errors.js';
import { AgentError, exitCodeFor } from './v1/errors.js';
import {
  connectSsh,
  execCommand,
  fetchArtifact,
  recoverWorkspace,
  status,
  syncWorkspace,
} from './v1/operations.js';

interface Parsed {
  command: string;
  positional: string[];
  flags: Map<string, string | boolean>;
  rest: string[];
}

const BOOLEAN_FLAGS = new Set(['json', 'plan', 'apply', 'overwrite', 'force', 'adopt', 'abort', 'help', 'workspace-file']);

export async function main(argv: readonly string[]): Promise<void> {
  const parsed = parse(argv);
  if (parsed.command === '' || parsed.command === 'help' || parsed.flags.has('help')) {
    printHelp();
    return;
  }
  try {
    switch (parsed.command) {
      case 'init': return cmdInit(parsed);
      case 'doctor': return await cmdDoctor(parsed);
      case 'status': return await cmdStatus(parsed);
      case 'recover': return await cmdRecover(parsed);
      case 'sync': return await cmdSync(parsed);
      case 'exec': return await cmdExec(parsed);
      case 'fetch': return await cmdFetch(parsed);
      default: throw new FleetError('usage', `unknown command ${parsed.command}`);
    }
  } catch (error) {
    if (error instanceof AgentError) {
      process.stderr.write(`${error.code}: ${friendlyErrorMessage(error)}${error.retryable ? ' (retryable)' : ''}\n`);
      process.exitCode = exitCodeFor(error.code);
    } else if (error instanceof FleetError) {
      process.stderr.write(`${error.code}: ${friendlyErrorMessage(error)}\n`);
      process.exitCode = error.exitCode;
    } else {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`internal: ${message}\n`);
      process.exitCode = 6;
    }
  }
}

function parse(argv: readonly string[]): Parsed {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();
  const rest: string[] = [];
  let command = '';
  let index = 0;
  for (; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (token === '--') { rest.push(...argv.slice(index + 1)); break; }
    if (!token.startsWith('--')) {
      if (command === '') command = token;
      else positional.push(token);
      continue;
    }
    const [name, inline] = token.slice(2).split('=', 2) as [string, string | undefined];
    if (inline !== undefined) { flags.set(name, inline); continue; }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--') && !BOOLEAN_FLAGS.has(name)) {
      flags.set(name, next);
      index += 1;
    } else {
      flags.set(name, true);
    }
  }
  return { command, positional, flags, rest };
}

function configOf(flags: Map<string, string | boolean>): WorkspaceConfig {
  const config = flags.get('config');
  const configDir = flags.get('config-dir');
  return loadConfig(process.cwd(), {
    ...(typeof config === 'string' ? { config } : {}),
    ...(typeof configDir === 'string' ? { configDir } : {}),
  });
}

function hostOf(config: WorkspaceConfig, flags: Map<string, string | boolean>): HostConfig {
  const alias = flags.get('host');
  if (typeof alias !== 'string') throw new FleetError('usage', '--host <alias> is required');
  const host = config.hosts[alias];
  if (!host) {
    throw new FleetError('usage', `unknown host ${JSON.stringify(alias)}`, { known: Object.keys(config.hosts).join(', ') });
  }
  return host;
}

function agentPath(flags: Map<string, string | boolean>): string {
  const value = flags.get('agent-path') ?? process.env.FLEET_AGENT_PATH ?? 'fleet-agent';
  return String(value);
}

function cmdInit(parsed: Parsed): void {
  const host = parsed.flags.get('host');
  const ssh = parsed.flags.get('ssh');
  if (typeof host !== 'string' || typeof ssh !== 'string') {
    throw new FleetError('usage', 'init needs --host <alias> and --ssh <user@host>');
  }
  const configDir = parsed.flags.get('config-dir');
  const portValue = parsed.flags.get('port');
  const root = parsed.flags.get('root');
  const name = parsed.flags.get('name');

  if (parsed.flags.has('workspace-file')) {
    const file = path.join(configPaths(process.cwd()).workspaceRoot, 'fleet.json');
    if (fs.existsSync(file) && !parsed.flags.has('force')) {
      throw new FleetError('config-invalid', 'fleet.json already exists', { hint: 'pass --force to replace it' });
    }
    const workspaceName = typeof name === 'string' ? name : defaultWorkspaceName(process.cwd());
    const entry: Record<string, unknown> = { ssh };
    if (typeof portValue === 'string') entry.port = Number(portValue);
    if (typeof root === 'string') entry.root = root;
    const config = { name: workspaceName, hosts: { [host]: entry }, excludes: [], env: {} };
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    process.stdout.write(`wrote ${file}\n`);
    return;
  }

  const documents = initProjectConfig(process.cwd(), {
    alias: host,
    ssh,
    ...(typeof portValue === 'string' ? { port: Number(portValue) } : {}),
    ...(typeof root === 'string' ? { root } : {}),
    ...(typeof name === 'string' ? { name } : {}),
    ...(typeof configDir === 'string' ? { configDir } : {}),
    force: parsed.flags.has('force'),
  });
  process.stdout.write(`wrote ${documents.hostsFile}\n`);
  process.stdout.write(`wrote ${documents.projectFile}\n`);
}

async function cmdDoctor(parsed: Parsed): Promise<void> {
  const config = configOf(parsed.flags);
  const alias = typeof parsed.flags.get('host') === 'string' ? String(parsed.flags.get('host')) : undefined;
  const aliases = alias ? [alias] : Object.keys(config.hosts);
  process.stdout.write(`node ${process.version}\n`);
  for (const name of aliases) {
    const host = config.hosts[name];
    if (!host) throw new FleetError('usage', `unknown host ${name}`);
    const client = await connectSsh(host, { agentPath: agentPath(parsed.flags) });
    try {
      const info = (await client.request('doctor', {})) as Record<string, unknown>;
      const agent = info.agent as { version?: string } | undefined;
      process.stdout.write(`${name}: protocol ${(info.protocol as { major?: number }).major}, agent ${agent?.version}, state ${String(info.stateDir)}\n`);
    } finally {
      client.close();
    }
  }
}

async function cmdStatus(parsed: Parsed): Promise<void> {
  const config = configOf(parsed.flags);
  const host = hostOf(config, parsed.flags);
  const client = await connectSsh(host, { agentPath: agentPath(parsed.flags) });
  try {
    const info = await status(client, config.name, host.root);
    if (parsed.flags.has('json')) {
      process.stdout.write(JSON.stringify(info, null, 2) + '\n');
    } else {
      process.stdout.write(`${config.name}: generation ${info.generation} ${info.manifestDigest}${info.recovery ? ' RECOVERY' : ''}\n`);
    }
  } finally {
    client.close();
  }
}

async function cmdRecover(parsed: Parsed): Promise<void> {
  const config = configOf(parsed.flags);
  const host = hostOf(config, parsed.flags);
  const client = await connectSsh(host, { agentPath: agentPath(parsed.flags) });
  try {
    const result = await recoverWorkspace(
      client,
      config.name,
      host.root,
      parsed.flags.has('abort') ? 'abort' : 'recover',
    );
    if (parsed.flags.has('json')) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    if (result.state === 'READY' && !result.recovered) {
      process.stdout.write(`${config.name}@${host.alias}: READY\n`);
      return;
    }
    process.stdout.write(`${config.name}@${host.alias}: recovered generation ${result.generation ?? 'unknown'} ${result.manifestDigest ?? ''}\n`);
  } finally {
    client.close();
  }
}

function excludesOf(config: WorkspaceConfig, flags: Map<string, string | boolean>): string[] {
  const extra = flags.get('exclude');
  const additions = typeof extra === 'string'
    ? extra.split(',').map((value) => value.trim()).filter(Boolean)
    : [];
  return [...new Set([...config.excludes, ...additions])];
}

async function cmdSync(parsed: Parsed): Promise<void> {
  const config = configOf(parsed.flags);
  const host = hostOf(config, parsed.flags);
  const excludes = excludesOf(config, parsed.flags);
  const matcher = compileExcludes(excludes);
  const client = await connectSsh(host, { agentPath: agentPath(parsed.flags) });
  try {
    const result = await syncWorkspace(client, matcher, {
      workspaceId: config.name,
      source: config.dir,
      root: host.root,
      excludes,
      mode: parsed.flags.has('plan') ? 'plan' : 'apply',
      adopt: parsed.flags.has('adopt'),
    });
    process.stdout.write(`plan ${result.changes.length} change(s) ${result.planDigest}\n`);
    for (const change of result.changes.slice(0, 50)) {
      process.stdout.write(`  ${change.action.padEnd(7)} ${change.path}\n`);
    }
    if (result.generation !== undefined) {
      process.stdout.write(`generation ${result.generation} ${result.manifestDigest}\n`);
    }
  } finally {
    client.close();
  }
}

async function cmdExec(parsed: Parsed): Promise<void> {
  const config = configOf(parsed.flags);
  const host = hostOf(config, parsed.flags);
  const argv = parsed.rest.length > 0 ? parsed.rest : parsed.positional;
  if (argv.length === 0) throw new FleetError('usage', 'exec needs a command after --');
  const timeout = parsed.flags.get('timeout');
  const env: Record<string, string> = {};
  const envFlag = parsed.flags.get('env');
  if (typeof envFlag === 'string') {
    for (const pair of envFlag.split(',')) {
      const [key, ...rest] = pair.split('=');
      if (key) env[key] = rest.join('=');
    }
  }
  const cwd = typeof parsed.flags.get('cwd') === 'string' ? String(parsed.flags.get('cwd')) : undefined;
  const client = await connectSsh(host, { agentPath: agentPath(parsed.flags) });
  try {
    const result = await execCommand(client, {
      workspaceId: config.name,
      root: host.root,
      argv,
      cwd,
      env,
      timeoutMs: typeof timeout === 'string' ? Number(timeout) * 1000 : undefined,
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    if (parsed.flags.has('json')) {
      process.stdout.write(JSON.stringify({ jobId: result.jobId, state: result.state, exitCode: result.exitCode }, null, 2) + '\n');
    }
    process.exitCode = result.exitCode ?? 1;
  } finally {
    client.close();
  }
}

async function cmdFetch(parsed: Parsed): Promise<void> {
  const config = configOf(parsed.flags);
  const host = hostOf(config, parsed.flags);
  const dest = parsed.flags.get('dest');
  if (typeof dest !== 'string') throw new FleetError('usage', '--dest <dir> is required');
  const artifact = parsed.rest[0] ?? parsed.positional[0];
  if (!artifact) throw new FleetError('usage', 'fetch needs an artifact path');
  const client = await connectSsh(host, { agentPath: agentPath(parsed.flags) });
  try {
    const result = await fetchArtifact(client, {
      workspaceId: config.name,
      root: host.root,
      artifact,
      dest,
      overwrite: parsed.flags.has('overwrite'),
    });
    process.stdout.write(`fetched ${result.file} (${result.bytes} bytes) ${result.digest}\n`);
  } finally {
    client.close();
  }
}

function printHelp(): void {
  process.stdout.write([
    'fleet — run work on a machine that has the cores',
    '',
    'usage:',
    '  fleet init --host <alias> --ssh <user@host> [--port N] [--root PATH] [--name NAME] [--force]',
    '               writes $XDG_CONFIG_HOME/openchamber-fleet/ (use --workspace-file for legacy fleet.json)',
    '  fleet doctor [--host <alias>] [--agent-path PATH]',
    '  fleet status --host <alias> [--json]',
    '  fleet recover --host <alias> [--abort] [--json]',
    '  fleet sync --host <alias> (--plan | --apply) [--exclude pat,pat] [--adopt]',
    '  fleet exec --host <alias> [--cwd P] [--env K=V,...] [--timeout SEC] [--json] -- <command…>',
    '  fleet fetch --host <alias> --dest <dir> [--overwrite] -- <path>',
    '  all commands accept --config-dir <dir>',
    '',
  ].join('\n'));
}
