/** Public API: configuration plus the fleet.agent.v1 controller. */

export {
  compileExcludes,
  configDirOf,
  configPaths,
  defaultRemoteRoot,
  defaultWorkspaceName,
  initProjectConfig,
  loadConfig,
  loadConfigDocuments,
  loadHostRegistry,
  loadProjectConfig,
  saveConfigDocuments,
} from './config.js';
export type {
  ConfigDocuments,
  ConfigPaths,
  ExcludeMatcher,
  HostConfig,
  HostRegistry,
  HostRegistryEntry,
  ProjectConfigFile,
  SaveConfigOptions,
  Shell,
  WorkspaceConfig,
} from './config.js';
export { FleetError, friendlyErrorMessage } from './errors.js';
export { hostViews, selectHost } from './hosts.js';
export type { HostQuery, HostView } from './hosts.js';
export { runWorkspace, syncForRun } from './run.js';
export type { RunOperations, RunOptions, RunResult, RunSyncMode, RunSyncSummary, SyncRunResult } from './run.js';
export { replicaState } from './status.js';
export type { ReplicaState, ReplicaStateInput, ReplicaTone } from './status.js';
export { AgentClient } from './v1/client.js';
export type { AgentInfo, CollectOptions } from './v1/client.js';
export { AgentError, exitCodeFor } from './v1/errors.js';
export {
  artifactTarget,
  canonicalArtifactTarget,
  connectProcess,
  connectSsh,
  execCommand,
  fetchArtifact,
  inspectRecovery,
  localDigest,
  openWorkspace,
  recoverWorkspace,
  startExecCommand,
  status,
  syncWorkspace,
} from './v1/operations.js';
export type {
  ExecHandle,
  ExecOptions,
  ExecProgress,
  ExecResult,
  FetchOptions,
  FetchProgress,
  FetchResult,
  Host,
  RecoveryInfo,
  SyncOptions,
  SyncProgress,
  SyncSummary,
  WorkspaceInfo,
} from './v1/operations.js';
export {
  CONTROL,
  DATA,
  DATA_HEADER_BYTES,
  MAX_CONTROL,
  MAX_DATA,
  MAX_DATA_BYTES,
  FrameDecoder,
  decodeData,
  encodeControl,
  encodeData,
  encodeFrame,
} from './v1/frame.js';
export type { DataHeader, Frame } from './v1/frame.js';
export { sshArgs, spawnTransport, sshTransport } from './v1/transport.js';
export type { AgentTransport, SshTarget } from './v1/transport.js';
export { manifestDigest, scanWorkspace, sha256File } from './v1/workspace.js';
export type { Entry, ScannedWorkspace } from './v1/workspace.js';
