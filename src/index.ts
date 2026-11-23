/** Public API. The CLI and the plugin are both thin adapters over these exports. */

export { compileExcludes, defaultRemoteRoot, loadConfig } from './config.js';
export type { ExcludeMatcher, HostConfig, Shell, WorkspaceConfig } from './config.js';
export { EXIT, FleetError, formatError, toFleetError } from './errors.js';
export type { ErrorCode, FleetErrorDetails } from './errors.js';
export { cancelRun, execRemote } from './exec.js';
export type { ExecRequest, ExecResult } from './exec.js';
export { fetchArtifacts } from './fetch.js';
export type { FetchRequest, FetchResult } from './fetch.js';
export { computeRevision, walkTree } from './manifest.js';
export type { ManifestEntry } from './manifest.js';
export { assertRelativePath, quoteArgv, quoteShell } from './paths.js';
export { parseItemized, planDigest, rsyncArgs } from './plan.js';
export type { PlanAction, PlanEntry, PlanResult } from './plan.js';
export { statusReport } from './status.js';
export type { HostStatus, ReplicaState, StatusReport } from './status.js';
export { applyWorkspace, planWorkspace, verifyWorkspace, workspaceKey } from './sync.js';
export type { ApplyResult, SyncOptions } from './sync.js';
export { doctor, formatDoctor, parseRsyncVersion, rsyncSatisfies } from './doctor.js';
export type { Check, DoctorReport } from './doctor.js';
