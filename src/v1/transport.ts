/** Transport: a spawned process speaking the protocol over stdio. SSH is one command line. */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface AgentTransport {
  readonly stdin: NodeJS.WritableStream;
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  readonly pid?: number;
  kill(): void;
}

export interface SshTarget {
  readonly ssh: string;
  readonly port: number;
}

const SAFE_AGENT_PATH = /^[A-Za-z0-9._/+-]+$/;

export function sshArgs(host: SshTarget, agentPath: string): string[] {
  if (!SAFE_AGENT_PATH.test(agentPath)) {
    throw new Error(`agent path ${JSON.stringify(agentPath)} contains characters that are unsafe over SSH`);
  }
  return [
    '-T',
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=4',
    '-p', String(host.port),
    host.ssh,
    agentPath,
    'stdio',
  ];
}

export function spawnTransport(command: string, args: readonly string[], env?: NodeJS.ProcessEnv): AgentTransport {
  const child: ChildProcessWithoutNullStreams = spawn(command, [...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: env ?? process.env,
  });
  child.on('error', () => {
    // The client observes a closed stream and reports it with context.
  });
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    pid: child.pid,
    kill: () => {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }, 2000).unref();
    },
  };
}

export function sshTransport(
  host: SshTarget,
  agentPath: string,
  env?: Record<string, string>,
  sshPath?: string,
): AgentTransport {
  return spawnTransport(
    sshPath ?? process.env.FLEET_SSH_PATH ?? 'ssh',
    sshArgs(host, agentPath),
    env === undefined ? process.env : { ...process.env, ...env },
  );
}
