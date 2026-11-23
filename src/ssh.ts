/** SSH argv construction, host-key policy, and one spawn helper. */

import { spawn } from 'node:child_process';
import { FleetError } from './errors.js';
import { quoteShell } from './paths.js';

const CONNECT_TIMEOUT = '10';

export interface SshTarget {
  readonly ssh: string;
  readonly port: number;
}

export interface RemoteResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunRemoteOptions {
  readonly input?: string;
  readonly onStdout?: (chunk: Buffer) => void;
  readonly onStderr?: (chunk: Buffer) => void;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export function sshBinary(): string {
  return process.env.FLEET_SSH ?? 'ssh';
}

export function sshOptions(host: SshTarget): string[] {
  return [
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', `ConnectTimeout=${CONNECT_TIMEOUT}`,
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=4',
    '-p', String(host.port),
    '-T',
  ];
}

/** The `-e` value for rsync; rsync parses it as a shell word list. */
export function rsyncRsh(host: SshTarget): string {
  return [
    quoteShell(sshBinary()),
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', `ConnectTimeout=${CONNECT_TIMEOUT}`,
    '-p', String(host.port),
  ].join(' ');
}

export function classifyFailure(stderr: string, code: number | null): FleetError {
  const text = stderr.trim();
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(text)) {
    return new FleetError('host-key-mismatch', 'host key verification failed; nothing was executed', { stderr: text });
  }
  if (/Permission denied|Authentication failed|no mutual signature/i.test(text)) {
    return new FleetError('ssh-auth-failed', 'SSH authentication failed', { stderr: text });
  }
  if (/rsync: command not found|rsync: not found/i.test(text)) {
    return new FleetError('rsync-missing', 'rsync is not installed on the node', { stderr: text });
  }
  if (code === 255 || /Connection refused|Connection timed out|No route to host|Could not resolve hostname/i.test(text)) {
    return new FleetError('node-unreachable', 'ssh to the node failed', { stderr: text || 'exit 255' });
  }
  return new FleetError('node-unreachable', 'remote command failed', { stderr: text || `exit ${String(code)}` });
}

/**
 * Run one command over SSH. Resolves with the exit code even when it is non-zero: the caller knows
 * whether it ran a control command or the user's command.
 */
export function runRemote(host: SshTarget, command: string, options: RunRemoteOptions = {}): Promise<RemoteResult> {
  const args = [...sshOptions(host), host.ssh, command];
  return new Promise<RemoteResult>((resolve, reject) => {
    const child = spawn(sshBinary(), args, { stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (error: FleetError | null, result?: RemoteResult): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else if (result) resolve(result);
    };

    const killGroup = (signal: NodeJS.Signals): void => {
      if (child.pid === undefined) return;
      try { process.kill(-child.pid, signal); } catch { /* already gone */ }
    };

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < 1_000_000) stdout += chunk.toString();
      options.onStdout?.(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 200_000) stderr += chunk.toString();
      options.onStderr?.(chunk);
    });
    child.on('error', (error: Error) => {
      finish(new FleetError('node-unreachable', `cannot run ${sshBinary()}: ${error.message}`));
    });
    child.on('close', (code, signal) => {
      finish(null, { code, signal, stdout, stderr });
    });

    child.stdin.end(options.input ?? '');

    if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        killGroup('SIGTERM');
        setTimeout(() => { killGroup('SIGKILL'); }, 2000).unref();
        finish(new FleetError('timeout', 'remote command exceeded its timeout', { timeoutMs: options.timeoutMs }));
      }, options.timeoutMs);
      timer.unref();
    }

    if (options.signal) {
      const abort = (): void => {
        killGroup('SIGTERM');
        finish(new FleetError('timeout', 'remote command interrupted'));
      };
      if (options.signal.aborted) abort();
      else options.signal.addEventListener('abort', abort, { once: true });
    }
  });
}

/** Turn a non-zero control result into the right error, leaving command exits alone. */
export function assertControlSuccess(result: RemoteResult, fallbackCode: 'node-unreachable' | 'sync-failed' = 'node-unreachable'): RemoteResult {
  if (result.code === 0) return result;
  const error = classifyFailure(result.stderr, result.code);
  if (error.code === 'node-unreachable' && fallbackCode !== 'node-unreachable') {
    throw new FleetError(fallbackCode, error.message, error.details);
  }
  throw error;
}

export async function probeHost(host: SshTarget): Promise<boolean> {
  try {
    const result = await runRemote(host, 'true', { timeoutMs: 15_000 });
    return result.code === 0;
  } catch {
    return false;
  }
}

const homeCache = new Map<string, string>();

/** Resolve the remote user's home once per process; rsync never expands `~`. */
export async function remoteHome(host: SshTarget): Promise<string> {
  const key = `${host.ssh}:${host.port}`;
  const cached = homeCache.get(key);
  if (cached !== undefined) return cached;
  const result = await runRemote(host, 'printf %s "$HOME"', { timeoutMs: 15_000 });
  assertControlSuccess(result);
  const home = result.stdout.trim();
  if (!home.startsWith('/')) {
    throw new FleetError('node-unreachable', 'remote $HOME is not an absolute path', { home });
  }
  homeCache.set(key, home);
  return home;
}

/** Expand a leading `~/` into the node's home directory. */
export async function resolveRemotePath(host: SshTarget, remotePath: string): Promise<string> {
  if (!remotePath.startsWith('~/')) return remotePath;
  return `${await remoteHome(host)}/${remotePath.slice(2)}`;
}

/** Transport a script as base64 so the node's login shell cannot reinterpret it. */
export function scriptCommand(script: string): string {
  return `echo ${Buffer.from(script, 'utf8').toString('base64')} | base64 -d | bash -s`;
}

/** True when stderr names a transport problem rather than a file-level rsync error. */
export function isTransportFailure(stderr: string): boolean {
  return /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|Permission denied|Authentication failed|Connection refused|Connection timed out|No route to host|Could not resolve hostname/i.test(stderr);
}
