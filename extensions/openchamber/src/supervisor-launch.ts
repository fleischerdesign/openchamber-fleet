/** The extension service is the only component that knows how to launch the app runtime. */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JobStore } from '../../../src/jobs/store.js';
import { lockActive, readHealthySupervisor, supervisorVersionDecision } from '../../../src/jobs/health.js';
import type { SupervisorDiscovery } from '../../../src/jobs/protocol.js';

export type SupervisorState = 'healthy' | 'started' | 'unavailable' | 'disabled';

export interface EnsureSupervisorOptions {
  readonly stateRoot: string;
  readonly version: string;
  readonly log: (message: string) => void;
  readonly entry?: string;
}

let inFlight: Promise<SupervisorState> | null = null;
let deferredPid: number | null = null;

function disabled(): boolean {
  const value = process.env.FLEET_SUPERVISOR;
  return value === 'off' || value === '0' || value === 'false';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealthy(store: JobStore, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (readHealthySupervisor(store)) return true;
    if (Date.now() >= deadline) return false;
    await delay(100);
  }
}

async function retireStale(
  store: JobStore,
  record: SupervisorDiscovery,
  options: EnsureSupervisorOptions,
): Promise<boolean> {
  options.log(`retiring supervisor ${record.pid} version ${record.version} for ${options.version}`);
  try {
    process.kill(record.pid, 'SIGTERM');
  } catch {
    // The process may already be gone; the discovery check below decides.
  }
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const current = readHealthySupervisor(store);
    if (!current || current.pid !== record.pid) {
      store.removeSupervisor(record.instance);
      return true;
    }
    await delay(100);
  }
  options.log(`supervisor ${record.pid} did not retire within 6s`);
  return false;
}

async function ensure(options: EnsureSupervisorOptions): Promise<SupervisorState> {
  if (disabled()) return 'disabled';
  const store = new JobStore(options.stateRoot);
  try {
    store.ensure();
  } catch (error) {
    options.log(`supervisor state directory is unusable: ${error instanceof Error ? error.message : String(error)}`);
    return 'unavailable';
  }
  const healthy = readHealthySupervisor(store);
  const decision = supervisorVersionDecision(healthy, options.version);
  if (decision === 'reuse') {
    deferredPid = null;
    return 'healthy';
  }
  if (decision === 'defer') {
    if (deferredPid !== healthy?.pid) {
      deferredPid = healthy?.pid ?? null;
      options.log(
        `supervisor ${healthy?.pid} runs ${healthy?.version} with active work; handover deferred until it is idle`,
      );
    }
    return 'healthy';
  }
  if (decision === 'replace' && healthy) {
    const retired = await retireStale(store, healthy, options);
    if (!retired) return 'healthy';
  }
  deferredPid = null;

  const lock = store.readLock();
  if (lock && lockActive(lock)) {
    // Another supervisor is starting; give it a moment instead of spawning a second.
    if (await waitForHealthy(store, 3000)) return 'healthy';
    options.log(`supervisor pid ${lock.pid} holds the lock but did not become healthy`);
    return 'unavailable';
  }
  if (lock) store.clearLock();
  store.removeSupervisor();

  const entry = options.entry ?? fileURLToPath(new URL('../supervisor/main.js', import.meta.url));
  if (!fs.existsSync(entry)) {
    options.log(`supervisor entry is missing: ${entry}`);
    return 'unavailable';
  }

  const inherited = [
    'HOME',
    'USERPROFILE',
    'PATH',
    'TMPDIR',
    'TMP',
    'TEMP',
    'LANG',
    'LC_ALL',
    'USER',
    'LOGNAME',
    'SHELL',
    'SSH_AUTH_SOCK',
    'FLEET_SSH_PATH',
    'FLEET_SUPERVISOR_IDLE_MS',
    'XDG_RUNTIME_DIR',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'PATHEXT',
  ];
  const environment: NodeJS.ProcessEnv = {};
  for (const key of inherited) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  environment.FLEET_STATE_DIR = options.stateRoot;
  environment.FLEET_SUPERVISOR_VERSION = options.version;
  environment.ELECTRON_RUN_AS_NODE = '1';

  let child;
  try {
    child = spawn(process.execPath, [entry], {
      detached: true,
      stdio: 'ignore',
      cwd: options.stateRoot,
      env: environment,
    });
  } catch (error) {
    options.log(`could not spawn the supervisor: ${error instanceof Error ? error.message : String(error)}`);
    return 'unavailable';
  }
  child.on('error', (error) => options.log(`supervisor process error: ${error.message}`));
  child.unref();

  if (await waitForHealthy(store, 8000)) return 'started';
  options.log('supervisor did not become healthy after 8s');
  return 'unavailable';
}

export function ensureSupervisor(options: EnsureSupervisorOptions): Promise<SupervisorState> {
  if (disabled()) return Promise.resolve('disabled');
  if (inFlight) return inFlight;
  inFlight = ensure(options).finally(() => {
    inFlight = null;
  });
  return inFlight;
}
