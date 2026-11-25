/** Per-user job state and the tiny runtime pointer shared by the service and the plugin. */

import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { ensurePrivateDir, readJsonFile, removeFile, writeJsonAtomic } from './io.js';
import {
  isRuntimePointer,
  isServiceHeartbeat,
  type RuntimePointer,
  type ServiceHeartbeat,
} from './protocol.js';

function homeOf(env: NodeJS.ProcessEnv): string {
  const home = env.HOME ?? env.USERPROFILE;
  if (home && path.isAbsolute(home)) return home;
  return os.homedir();
}

/** State root from configuration and HOME only; never from the runtime pointer. */
export function configuredStateRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.FLEET_STATE_DIR;
  if (override && path.isAbsolute(override)) return path.resolve(override);
  return path.join(homeOf(env), '.local', 'state', 'openchamber-fleet');
}

function runtimeIdentity(env: NodeJS.ProcessEnv): string {
  if (typeof process.getuid === 'function') return String(process.getuid());
  const name = env.USERNAME ?? env.USER ?? safeUserName();
  return crypto.createHash('sha256').update(name).digest('hex').slice(0, 12);
}

function safeUserName(): string {
  try {
    return os.userInfo().username;
  } catch {
    return 'user';
  }
}

/** Directory for the service heartbeat and the pointer to the state root. */
export function runtimeStateDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(os.tmpdir(), `openchamber-fleet-${runtimeIdentity(env)}`);
}

export function runtimePointerPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(runtimeStateDir(env), 'state.json');
}

export function serviceHeartbeatPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(runtimeStateDir(env), 'service.json');
}

export function readRuntimePointer(env: NodeJS.ProcessEnv = process.env): RuntimePointer | null {
  try {
    const value = readJsonFile(runtimePointerPath(env));
    return isRuntimePointer(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeRuntimePointer(stateRoot: string, servicePid: number, env: NodeJS.ProcessEnv = process.env): void {
  ensurePrivateDir(runtimeStateDir(env));
  writeJsonAtomic(runtimePointerPath(env), {
    version: 1,
    stateRoot: path.resolve(stateRoot),
    servicePid,
    updatedAt: Date.now(),
  } satisfies RuntimePointer);
}

export function readServiceHeartbeat(env: NodeJS.ProcessEnv = process.env): ServiceHeartbeat | null {
  try {
    const value = readJsonFile(serviceHeartbeatPath(env));
    return isServiceHeartbeat(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeServiceHeartbeat(env: NodeJS.ProcessEnv = process.env): void {
  ensurePrivateDir(runtimeStateDir(env));
  writeJsonAtomic(serviceHeartbeatPath(env), {
    pid: process.pid,
    updatedAt: Date.now(),
  } satisfies ServiceHeartbeat);
}

export function removeServiceHeartbeat(env: NodeJS.ProcessEnv = process.env): void {
  try {
    const current = readServiceHeartbeat(env);
    // A shutting-down old service must not remove its successor's heartbeat.
    if (current === null || current.pid === process.pid) removeFile(serviceHeartbeatPath(env));
  } catch {
    // Best effort on shutdown.
  }
}

/**
 * The state root the plugin uses: an explicit override, the service's pointer, or the
 * plugin's own HOME. The pointer prevents a different HOME between OpenChamber and
 * OpenCode from splitting the two halves of the spool.
 */
export function resolveStateRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.FLEET_STATE_DIR;
  if (override && path.isAbsolute(override)) return path.resolve(override);
  const pointer = readRuntimePointer(env);
  if (pointer && path.isAbsolute(pointer.stateRoot)) return path.resolve(pointer.stateRoot);
  return configuredStateRoot(env);
}
