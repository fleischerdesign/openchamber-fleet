/** Public API: configuration plus the fleet.agent.v1 controller. */

export { compileExcludes, defaultRemoteRoot, loadConfig } from './config.js';
export type { ExcludeMatcher, HostConfig, Shell, WorkspaceConfig } from './config.js';
export { FleetError } from './errors.js';
export { AgentClient } from './v1/client.js';
export type { AgentInfo, CollectOptions } from './v1/client.js';
export { AgentError, exitCodeFor } from './v1/errors.js';
export {
  connectProcess,
  connectSsh,
  execCommand,
  fetchArtifact,
  localDigest,
  openWorkspace,
  status,
  syncWorkspace,
} from './v1/operations.js';
export type {
  ExecOptions,
  ExecResult,
  FetchOptions,
  FetchResult,
  Host,
  SyncOptions,
  SyncSummary,
  WorkspaceInfo,
} from './v1/operations.js';
export { CONTROL, DATA, MAX_CONTROL, MAX_DATA, FrameDecoder, decodeData, encodeControl, encodeData, encodeFrame } from './v1/frame.js';
export type { DataHeader, Frame } from './v1/frame.js';
export { sshArgs, spawnTransport, sshTransport } from './v1/transport.js';
export type { AgentTransport, SshTarget } from './v1/transport.js';
export { manifestDigest, scanWorkspace, sha256File } from './v1/workspace.js';
export type { Entry, ScannedWorkspace } from './v1/workspace.js';
