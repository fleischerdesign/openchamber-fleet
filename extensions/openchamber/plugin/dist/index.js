/** Public API: configuration plus the fleet.agent.v1 controller. */
export { compileExcludes, defaultRemoteRoot, loadConfig } from './config.js';
export { FleetError } from './errors.js';
export { AgentClient } from './v1/client.js';
export { AgentError, exitCodeFor } from './v1/errors.js';
export { artifactTarget, connectProcess, connectSsh, execCommand, fetchArtifact, inspectRecovery, localDigest, openWorkspace, recoverWorkspace, startExecCommand, status, syncWorkspace, } from './v1/operations.js';
export { CONTROL, DATA, MAX_CONTROL, MAX_DATA, FrameDecoder, decodeData, encodeControl, encodeData, encodeFrame } from './v1/frame.js';
export { sshArgs, spawnTransport, sshTransport } from './v1/transport.js';
export { manifestDigest, scanWorkspace, sha256File } from './v1/workspace.js';
//# sourceMappingURL=index.js.map