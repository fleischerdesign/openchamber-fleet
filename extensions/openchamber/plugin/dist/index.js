/** Public API: configuration plus the fleet.agent.v1 controller. */
export { compileExcludes, configDirOf, configPaths, defaultRemoteRoot, defaultWorkspaceName, initProjectConfig, loadConfig, loadConfigDocuments, loadHostRegistry, loadProjectConfig, saveConfigDocuments, } from './config.js';
export { FleetError, friendlyErrorMessage } from './errors.js';
export { hostViews, selectHost } from './hosts.js';
export { runWorkspace, syncForRun } from './run.js';
export { replicaState } from './status.js';
export { AgentClient } from './v1/client.js';
export { AgentError, exitCodeFor } from './v1/errors.js';
export { artifactTarget, canonicalArtifactTarget, connectProcess, connectSsh, execCommand, fetchArtifact, inspectRecovery, localDigest, openWorkspace, recoverWorkspace, startExecCommand, status, syncWorkspace, } from './v1/operations.js';
export { CONTROL, DATA, DATA_HEADER_BYTES, MAX_CONTROL, MAX_DATA, MAX_DATA_BYTES, FrameDecoder, decodeData, encodeControl, encodeData, encodeFrame, } from './v1/frame.js';
export { sshArgs, spawnTransport, sshTransport } from './v1/transport.js';
export { manifestDigest, scanWorkspace, sha256File } from './v1/workspace.js';
//# sourceMappingURL=index.js.map