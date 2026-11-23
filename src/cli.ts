/** Command line interface. */

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import type { HostConfig, WorkspaceConfig } from './config.js';
import { FleetError, formatError, toFleetError } from './errors.js';
import { doctor, formatDoctor } from './doctor.js';
import { cancelRun, execRemote } from './exec.js';
import { fetchArtifacts } from './fetch.js';
import { quoteArgv } from './paths.js';
import { PRESET_NAMES, buildOutputHints, detectPresets, excludesFor } from './presets.js';
import { readRun, runLogPath } from './state.js';
import { statusReport } from './status.js';
import { applyWorkspace, planWorkspace, verifyWorkspace } from './sync.js';

interface Parsed {
  command: string;
  positional: string[];
  flags: Map<string, string | boolean>;
  rest: string[];
}

export async function main(argv: readonly string[]): Promise<void> {
  const parsed = parse(argv);
  if (parsed.command === '' || parsed.command === 'help' || parsed.flags.has('help')) {
    printHelp();
    return;
  }
  try {
    switch (parsed.command) {
      case 'init': return cmdInit(parsed);
      case 'status': return await cmdStatus(parsed);
      case 'sync': return await cmdSync(parsed);
      case 'exec': return await cmdExec(parsed);
      case 'fetch': return await cmdFetch(parsed);
      case 'cancel': return await cmdCancel(parsed);
      case 'logs': return cmdLogs(parsed);
      case 'doctor': return await cmdDoctor(parsed);
      default: throw new FleetError('usage', `unknown command ${parsed.command}`);
    }
  } catch (error) {
    const fleet = toFleetError(error);
    process.stderr.write(formatError(fleet) + '\n');
    process.exitCode = fleet.exitCode;
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
    if (next !== undefined && !next.startsWith('--') && name !== 'help' && !BOOLEAN_FLAGS.has(name)) {
      flags.set(name, next);
      index += 1;
    } else {
      flags.set(name, true);
    }
  }
  return { command, positional, flags, rest };
}

const BOOLEAN_FLAGS = new Set(['json', 'check', 'content', 'apply', 'plan', 'verify', 'overwrite', 'force', 'allow-stale', 'help']);

function hostOf(config: WorkspaceConfig, flags: Map<string, string | boolean>): HostConfig {
  const alias = flags.get('host');
  if (typeof alias !== 'string') throw new FleetError('usage', '--host <alias> is required');
  const host = config.hosts[alias];
  if (!host) {
    throw new FleetError('usage', `unknown host ${JSON.stringify(alias)}`, { known: Object.keys(config.hosts).join(', ') });
  }
  return host;
}

function configOf(flags: Map<string, string | boolean>): WorkspaceConfig {
  const config = flags.get('config');
  return loadConfig(process.cwd(), typeof config === 'string' ? { config } : {});
}

function cmdInit(parsed: Parsed): void {
  const file = path.join(process.cwd(), 'fleet.json');
  if (fs.existsSync(file) && !parsed.flags.has('force')) {
    throw new FleetError('config-invalid', 'fleet.json already exists', { hint: 'pass --force to replace it' });
  }
  const host = parsed.flags.get('host');
  const ssh = parsed.flags.get('ssh');
  if (typeof host !== 'string' || typeof ssh !== 'string') {
    throw new FleetError('usage', 'init needs --host <alias> and --ssh <user@host>');
  }
  const name = typeof parsed.flags.get('name') === 'string'
    ? String(parsed.flags.get('name'))
    : path.basename(process.cwd()).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const entry: Record<string, unknown> = { ssh };
  if (typeof parsed.flags.get('port') === 'string') entry.port = Number(parsed.flags.get('port'));
  if (typeof parsed.flags.get('root') === 'string') entry.root = String(parsed.flags.get('root'));
  const requested = typeof parsed.flags.get('preset') === 'string'
    ? String(parsed.flags.get('preset')).split(',').map((value) => value.trim()).filter(Boolean)
    : null;
  const presets = requested ?? detectPresets(process.cwd());
  const unknown = presets.filter((preset) => !PRESET_NAMES.includes(preset));
  if (unknown.length > 0) {
    throw new FleetError('usage', `unknown preset(s): ${unknown.join(', ')}`, { known: PRESET_NAMES.join(', ') });
  }
  const config = { name, hosts: { [host]: entry }, excludes: excludesFor(presets), env: {} };
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n', { mode: 0o644 });
  process.stdout.write(`wrote ${file} (presets: ${presets.join(', ') || 'none'})\n`);
}

async function cmdStatus(parsed: Parsed): Promise<void> {
  const config = configOf(parsed.flags);
  const report = await statusReport(config, { check: parsed.flags.has('check') });
  if (parsed.flags.has('json')) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }
  process.stdout.write(`workspace: ${report.workspace}\n`);
  process.stdout.write(`revision:  ${report.revision}\n`);
  for (const host of report.hosts) {
    const lease = host.lease ? `run ${host.lease.runId}` : '—';
    const changes = host.changes === undefined ? '' : ` (${host.changes} changes)`;
    process.stdout.write(`${host.alias.padEnd(14)} ${host.state.padEnd(9)} ${lease}${changes}\n`);
  }
}

async function cmdDoctor(parsed: Parsed): Promise<void> {
  const config = configOf(parsed.flags);
  const alias = typeof parsed.flags.get('host') === 'string' ? String(parsed.flags.get('host')) : undefined;
  const report = await doctor(config, alias);
  process.stdout.write(formatDoctor(report) + '\n');
  if (!report.ok) process.exitCode = 8;
}

async function cmdSync(parsed: Parsed): Promise<void> {
  const config = configOf(parsed.flags);
  const host = hostOf(config, parsed.flags);
  const checksum = parsed.flags.has('content');
  if (parsed.flags.has('apply')) {
    const result = await applyWorkspace(config, host, { checksum });
    process.stdout.write(`applied ${result.applied} changes\n`);
    process.stdout.write(`revision ${result.plan.revision}\n`);
    return;
  }
  if (parsed.flags.has('verify')) {
    const result = await verifyWorkspace(config, host, { checksum });
    if (result.entries.length === 0) {
      process.stdout.write(`verified: replica matches ${result.revision}\n`);
      return;
    }
    process.stdout.write(`replica differs in ${result.entries.length} path(s):\n`);
    for (const entry of result.entries.slice(0, 50)) process.stdout.write(`  ${entry.action.padEnd(11)} ${entry.path}\n`);
    process.exitCode = 6;
    return;
  }
  const plan = await planWorkspace(config, host, { checksum });
  process.stdout.write(`plan ${plan.entries.length} change(s) ${plan.digest}\n`);
  for (const entry of plan.entries.slice(0, 50)) process.stdout.write(`  ${entry.action.padEnd(11)} ${entry.path}\n`);
  const hints = buildOutputHints(plan.entries);
  if (hints.length > 0) {
    process.stderr.write(`note: generated output would be replicated: ${hints.join(', ')} — add it to excludes if a build produces it\n`);
  }
}

async function cmdExec(parsed: Parsed): Promise<void> {
  const config = configOf(parsed.flags);
  const host = hostOf(config, parsed.flags);
  const shell = typeof parsed.flags.get('shell') === 'string' ? String(parsed.flags.get('shell')) : undefined;
  const argv = parsed.rest.length > 0 ? parsed.rest : parsed.positional;
  if (shell === undefined && argv.length === 0) throw new FleetError('usage', 'exec needs a command after -- or --shell');
  const timeout = parsed.flags.get('timeout');
  const result = await execRemote({
    config,
    host,
    shell,
    argv: shell === undefined ? argv : undefined,
    timeoutMs: typeof timeout === 'string' ? Number(timeout) * 1000 : undefined,
    allowStale: parsed.flags.has('allow-stale'),
    onStdout: (chunk) => process.stdout.write(chunk),
    onStderr: (chunk) => process.stderr.write(chunk),
  });
  if (parsed.flags.has('json')) {
    process.stdout.write(JSON.stringify({ ...result, output: undefined }, null, 2) + '\n');
  }
  process.exitCode = result.exitCode === 0 ? 0 : Math.min(result.exitCode, 125);
}

async function cmdFetch(parsed: Parsed): Promise<void> {
  const config = configOf(parsed.flags);
  const host = hostOf(config, parsed.flags);
  const dest = parsed.flags.get('dest');
  if (typeof dest !== 'string') throw new FleetError('usage', '--dest <dir> is required');
  const paths = parsed.rest.length > 0 ? parsed.rest : parsed.positional;
  const result = await fetchArtifacts({
    config,
    host,
    paths,
    dest,
    overwrite: parsed.flags.has('overwrite'),
    verify: parsed.flags.has('verify'),
  });
  process.stdout.write(`fetched ${result.paths.length} path(s), ${result.bytes} bytes\n`);
}

async function cmdCancel(parsed: Parsed): Promise<void> {
  const config = configOf(parsed.flags);
  const host = hostOf(config, parsed.flags);
  const runId = parsed.flags.get('run');
  if (typeof runId !== 'string' || !/^[0-9a-f]{12}$/.test(runId)) {
    throw new FleetError('usage', 'cancel needs --run <12 hex characters>');
  }
  await cancelRun(host, runId);
  process.stdout.write(`sent SIGTERM for run ${runId}\n`);
}

function cmdLogs(parsed: Parsed): void {
  const runId = parsed.positional[0] ?? parsed.flags.get('run');
  if (typeof runId !== 'string') throw new FleetError('usage', 'logs needs a run id');
  const run = readRun(runId);
  process.stdout.write(`# ${run.kind} ${run.host}/${run.workspace} exit ${String(run.exitCode)} ${run.startedAt}\n`);
  process.stdout.write(fs.readFileSync(runLogPath(runId), 'utf8'));
}

function printHelp(): void {
  process.stdout.write([
    'fleet — replicate a workspace to a node and run one command there',
    '',
    'usage:',
    '  fleet init --host <alias> --ssh <user@host> [--port N] [--root PATH] [--name NAME] [--preset node,rust] [--force]',
    '  fleet status [--check] [--json]',
    '  fleet sync --host <alias> (--plan | --apply | --verify) [--content]',
    '  fleet exec --host <alias> [--timeout SEC] [--allow-stale] [--json] -- <command…>',
    '  fleet exec --host <alias> --shell "<command string>"',
    '  fleet fetch --host <alias> --dest <dir> [--overwrite] [--verify] -- <path…>',
    '  fleet cancel --host <alias> --run <runId>',
    '  fleet logs <runId>',
    '  fleet doctor [--host <alias>]',
    '',
    'environment:',
    '  FLEET_STATE_DIR  state directory (default ~/.local/state/openchamber-fleet)',
    '  FLEET_TIMEOUT    default exec timeout in seconds',
    '',
  ].join('\n'));
}

export { quoteArgv };
