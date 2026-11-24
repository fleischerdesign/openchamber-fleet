/** Transport: a spawned process speaking the protocol over stdio. SSH is one command line. */
import { spawn } from 'node:child_process';
const SAFE_AGENT_PATH = /^[A-Za-z0-9._/+-]+$/;
export function sshArgs(host, agentPath) {
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
export function spawnTransport(command, args, env) {
    const child = spawn(command, [...args], {
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
            try {
                child.kill('SIGTERM');
            }
            catch { /* already gone */ }
            setTimeout(() => {
                try {
                    child.kill('SIGKILL');
                }
                catch { /* already gone */ }
            }, 2000).unref();
        },
    };
}
export function sshTransport(host, agentPath) {
    return spawnTransport(process.env.FLEET_SSH_PATH ?? 'ssh', sshArgs(host, agentPath));
}
//# sourceMappingURL=transport.js.map