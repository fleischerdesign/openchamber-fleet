/** Environment diagnostics: what the controller and a node need, and how to install it. */

import { spawnSync } from 'node:child_process';
import type { HostConfig, WorkspaceConfig } from './config.js';
import { FleetError } from './errors.js';
import { runRemote, scriptCommand, sshBinary } from './ssh.js';

export interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly hint?: string;
}

export interface DoctorReport {
  readonly local: Check[];
  readonly hosts: Record<string, Check[]>;
  readonly ok: boolean;
}

const MIN_RSYNC = [3, 1] as const;

export function parseRsyncVersion(output: string): [number, number, number] | null {
  const match = /rsync\s+version\s+(\d+)\.(\d+)(?:\.(\d+))?/i.exec(output);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

export function rsyncSatisfies(version: readonly [number, number, number] | null): boolean {
  if (version === null) return false;
  if (version[0] !== MIN_RSYNC[0]) return version[0] > MIN_RSYNC[0];
  return version[1] >= MIN_RSYNC[1];
}

function commandVersion(binary: string, args: readonly string[]): string | null {
  const result = spawnSync(binary, [...args], { encoding: 'utf8' });
  if (result.error) return null;
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
}

export function localChecks(): Check[] {
  const checks: Check[] = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({
    name: 'node',
    ok: nodeMajor >= 22,
    detail: process.version,
    hint: 'install Node 22 or newer',
  });
  const ssh = commandVersion(sshBinary(), ['-V']);
  checks.push({
    name: 'ssh',
    ok: ssh !== null,
    detail: ssh?.split('\n')[0] ?? 'not found',
    hint: 'install openssh-client',
  });
  const rsync = commandVersion('rsync', ['--version']);
  const version = rsync === null ? null : parseRsyncVersion(rsync);
  checks.push({
    name: 'rsync',
    ok: rsyncSatisfies(version),
    detail: version ? version.join('.') : 'not found or unreadable',
    hint: 'need rsync >= 3.1 (macOS ships openrsync: brew install rsync; Alpine: apk add rsync)',
  });
  return checks;
}

const PROBE = [
  'printf "home=%s\\n" "$HOME"',
  'if command -v rsync >/dev/null 2>&1; then rsync --version | head -1; else echo "rsync=MISSING"; fi',
  'command -v bash >/dev/null 2>&1 && echo "bash=ok" || echo "bash=MISSING"',
  'command -v base64 >/dev/null 2>&1 && echo "base64=ok" || echo "base64=MISSING"',
  'if command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1; then echo "sha256=ok"; else echo "sha256=MISSING"; fi',
].join('\n');

export function parseProbe(output: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('home=')) values.set('home', trimmed.slice(5));
    else if (trimmed.startsWith('rsync=')) values.set('rsync', trimmed.slice(6));
    else if (trimmed.includes('rsync  version')) values.set('rsyncLine', trimmed);
    else if (trimmed.startsWith('bash=')) values.set('bash', trimmed.slice(5));
    else if (trimmed.startsWith('base64=')) values.set('base64', trimmed.slice(7));
    else if (trimmed.startsWith('sha256=')) values.set('sha256', trimmed.slice(7));
  }
  return values;
}

function hostChecks(values: Map<string, string>): Check[] {
  const rsyncLine = values.get('rsyncLine') ?? '';
  const version = values.get('rsync') === 'MISSING' ? null : parseRsyncVersion(rsyncLine);
  return [
    {
      name: 'rsync',
      ok: rsyncSatisfies(version),
      detail: values.get('rsync') === 'MISSING' ? 'not found' : version ? version.join('.') : rsyncLine || 'unknown',
      hint: 'need rsync >= 3.1 (Debian/Ubuntu: apt install rsync; Alpine: apk add rsync; NixOS: environment.systemPackages)',
    },
    {
      name: 'bash',
      ok: values.get('bash') === 'ok',
      detail: values.get('bash') === 'ok' ? 'ok' : 'not found',
      hint: 'the remote wrapper runs through bash',
    },
    {
      name: 'base64',
      ok: values.get('base64') === 'ok',
      detail: values.get('base64') === 'ok' ? 'ok' : 'not found',
      hint: 'coreutils provides base64',
    },
    {
      name: 'sha256',
      ok: values.get('sha256') === 'ok',
      detail: values.get('sha256') === 'ok' ? 'ok' : 'not found',
      hint: 'only needed for fetch --verify (coreutils sha256sum or Perl shasum)',
    },
    {
      name: 'home',
      ok: values.get('home')?.startsWith('/') === true,
      detail: values.get('home') ?? 'unknown',
      hint: 'the replica root resolves relative to this directory',
    },
  ];
}

export async function doctor(config: WorkspaceConfig, hostAlias?: string): Promise<DoctorReport> {
  const local = localChecks();
  const hosts: Record<string, Check[]> = {};
  const aliases = hostAlias === undefined ? Object.keys(config.hosts) : [hostAlias];
  for (const alias of aliases) {
    const host = config.hosts[alias];
    if (!host) {
      throw new FleetError('usage', `unknown host ${JSON.stringify(alias)}`, { known: Object.keys(config.hosts).join(', ') });
    }
    hosts[alias] = await probeHostChecks(host);
  }
  const ok = local.every((check) => check.ok)
    && Object.values(hosts).every((checks) => checks.every((check) => check.ok));
  return { local, hosts, ok };
}

async function probeHostChecks(host: HostConfig): Promise<Check[]> {
  try {
    const result = await runRemote(host, scriptCommand(PROBE), { timeoutMs: 20_000 });
    if (result.code !== 0) {
      return [{ name: 'ssh', ok: false, detail: result.stderr.trim() || `exit ${String(result.code)}`, hint: 'check host key, user and port' }];
    }
    return hostChecks(parseProbe(result.stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [{ name: 'ssh', ok: false, detail: message, hint: 'check reachability, host key and credentials' }];
  }
}

export function formatDoctor(report: DoctorReport): string {
  const lines: string[] = [];
  const render = (scope: string, checks: readonly Check[]): void => {
    for (const check of checks) {
      const status = check.ok ? 'ok  ' : 'fail';
      lines.push(`${status} ${scope.padEnd(12)} ${check.name.padEnd(8)} ${check.detail}`);
      if (!check.ok && check.hint) lines.push(`     ${''.padEnd(12)} ${''.padEnd(8)} -> ${check.hint}`);
    }
  };
  render('local', report.local);
  for (const [alias, checks] of Object.entries(report.hosts)) render(alias, checks);
  lines.push(report.ok ? 'all checks passed' : 'one or more checks failed');
  return lines.join('\n');
}
