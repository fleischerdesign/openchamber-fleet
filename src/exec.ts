/** Remote execution: deterministic environment, real timeout, recorded run. */

import fs from 'node:fs';
import type { HostConfig, WorkspaceConfig } from './config.js';
import { FleetError } from './errors.js';
import { quoteArgv, quoteShell } from './paths.js';
import { runRemote, scriptCommand } from './ssh.js';
import { acquireLease, newRunId, readState, recordRun, runLogPath } from './state.js';
import type { RunRecord } from './state.js';
import { verifyWorkspace, workspaceKey } from './sync.js';

const FIXED_PATH = '/run/current-system/sw/bin:/usr/local/bin:/usr/bin:/bin';
const DEFAULT_TIMEOUT_MS = 900_000;
const DEFAULT_CAP_BYTES = 256 * 1024;

export interface ExecRequest {
  readonly config: WorkspaceConfig;
  readonly host: HostConfig;
  readonly argv?: readonly string[];
  readonly shell?: string;
  readonly timeoutMs?: number;
  readonly allowStale?: boolean;
  readonly runId?: string;
  readonly capBytes?: number;
  readonly waitMs?: number;
  readonly signal?: AbortSignal;
  readonly onStdout?: (chunk: Buffer) => void;
  readonly onStderr?: (chunk: Buffer) => void;
}

export interface ExecResult {
  readonly runId: string;
  readonly exitCode: number;
  readonly signal: NodeJS.Signals | null;
  readonly output: string;
  readonly stderr: string;
  readonly truncated: boolean;
  readonly logPath: string;
  readonly revision: string;
  readonly stale: boolean;
  readonly durationMs: number;
}

/** Resolve a remote root that may start with `~/` into a shell-safe expression. */
export function remotePathExpression(remotePath: string): string {
  if (remotePath.startsWith('~/')) return `"$HOME"/${quoteShell(remotePath.slice(2))}`;
  return quoteShell(remotePath);
}

export function buildRemoteScript(request: ExecRequest & { readonly revision: string }): string {
  const { config, host } = request;
  const command = request.shell !== undefined
    ? request.shell
    : quoteArgv(request.argv ?? []);
  const env = Object.entries(config.env)
    .map(([key, value]) => `${key}=${quoteShell(value)}`)
    .join(' ');
  const pidExpression = `"$HOME"/${quoteShell('.cache/openchamber-fleet/run-' + String(request.runId) + '.pid')}`;
  const lines = [
    'set -u',
    'mkdir -p "$HOME"/' + quoteShell('.cache/openchamber-fleet') + ' || exit 96',
    `cd ${remotePathExpression(host.root)} || exit 97`,
    `SHELL_BIN=$(command -v ${config.shell}) || exit 98`,
    `echo $$ > ${pidExpression}`,
    'umask 0022',
    `exec env -i HOME="$HOME" PATH=${quoteShell(FIXED_PATH)} LANG=C.UTF-8 TZ=UTC ${env} "$SHELL_BIN" -c ${quoteShell(command)}`,
  ];
  return lines.join('\n') + '\n';
}

export function encodeScript(script: string): string {
  return Buffer.from(script, 'utf8').toString('base64');
}

/** A command to signal a recorded remote pid. Never interpolates user input. */
export function cancelCommand(runId: string): string {
  if (!/^[0-9a-f]{12}$/.test(runId)) throw new FleetError('usage', 'run id must be 12 hex characters');
  const pid = `"$HOME"/${quoteShell('.cache/openchamber-fleet/run-' + runId + '.pid')}`;
  return [
    `if [ -f ${pid} ]; then`,
    `  p=$(cat ${pid});`,
    '  kill -TERM -- -"$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null || true;',
    'fi',
  ].join(' ');
}

export async function cancelRun(host: HostConfig, runId: string): Promise<void> {
  await runRemote(host, scriptCommand(cancelCommand(runId)), { timeoutMs: 15_000 });
}

function signalExitCode(signal: NodeJS.Signals | null): number {
  const map: Record<string, number> = { SIGHUP: 129, SIGINT: 130, SIGKILL: 137, SIGTERM: 143 };
  return signal ? map[signal] ?? 1 : 1;
}

export async function execRemote(request: ExecRequest): Promise<ExecResult> {
  const { config, host } = request;
  if (request.shell === undefined && (request.argv === undefined || request.argv.length === 0)) {
    throw new FleetError('usage', 'exec needs a command (argv) or --shell');
  }
  const runId = request.runId ?? newRunId();
  const configured = Number(process.env.FLEET_TIMEOUT ?? "");
  const timeoutMs = request.timeoutMs ?? (Number.isFinite(configured) && configured > 0 ? configured * 1000 : DEFAULT_TIMEOUT_MS);
  const capBytes = request.capBytes ?? DEFAULT_CAP_BYTES;
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const lease = acquireLease({ host: host.alias, workspace: config.name, runId, waitMs: request.waitMs ?? 0 });
  const logPath = runLogPath(runId);
  const log = fs.createWriteStream(logPath, { mode: 0o600 });
  let captured = '';
  let stderr = '';
  let outputBytes = 0;
  let truncated = false;

  const record = (fields: Partial<RunRecord>): void => {
    try {
      recordRun({
        runId,
        kind: 'exec',
        host: host.alias,
        workspace: config.name,
        command: request.shell ?? (request.argv ?? []).join(' '),
        startedAt,
        user: process.env.USER,
        controller: process.env.HOSTNAME,
        allowStale: request.allowStale === true,
        ...fields,
      });
    } catch {
      // A failed audit write must not mask the command result; it is reported on the next status.
    }
  };

  try {
    let revision = '';
    const stale = request.allowStale === true;
    if (request.allowStale !== true) {
      const verified = await verifyWorkspace(config, host);
      revision = verified.revision;
      const recorded = readState().workspaces[workspaceKey(config, host)]?.revision;
      if (recorded !== undefined && recorded !== revision) {
        throw new FleetError('replica-stale', 'replica was last synced at a different revision', {
          recorded,
          current: revision,
        });
      }
      if (verified.entries.length > 0) {
        throw new FleetError('replica-stale', 'replica does not match the canonical tree', {
          changes: verified.entries.length,
          first: verified.entries[0]?.path ?? '',
        });
      }
    }

    const script = buildRemoteScript({ ...request, runId, revision });
    const remoteCommand = scriptCommand(script);

    const result = await runRemote(host, remoteCommand, {
      timeoutMs,
      signal: request.signal,
      onStdout: (chunk) => {
        log.write(chunk);
        outputBytes += chunk.length;
        request.onStdout?.(chunk);
        if (Buffer.byteLength(captured) < capBytes) captured += chunk.toString();
        else truncated = true;
      },
      onStderr: (chunk) => {
        log.write(chunk);
        outputBytes += chunk.length;
        request.onStderr?.(chunk);
        if (stderr.length < capBytes) stderr += chunk.toString();
      },
    });

    const exitCode = result.code ?? signalExitCode(result.signal);
    const durationMs = Date.now() - start;
    record({ exitCode, revision, endedAt: new Date().toISOString(), outputBytes });
    if (exitCode !== 0 && result.code === 255 && /Host key|Permission denied|Connection/.test(result.stderr)) {
      throw new FleetError('node-unreachable', 'ssh failed before the command ran', { stderr: result.stderr.trim() });
    }
    return {
      runId,
      exitCode,
      signal: result.signal,
      output: captured,
      stderr,
      truncated,
      logPath,
      revision,
      stale,
      durationMs,
    };
  } catch (error) {
    record({ exitCode: null, endedAt: new Date().toISOString(), outputBytes });
    throw error;
  } finally {
    log.end();
    lease.release();
  }
}

export function workspaceLabel(config: WorkspaceConfig, host: HostConfig): string {
  return workspaceKey(config, host);
}
