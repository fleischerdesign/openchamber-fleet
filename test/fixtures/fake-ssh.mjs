#!/usr/bin/env node
// Test transport: behaves like `ssh` but runs the remote command on this machine.
// FAKE_SSH_FAIL simulates the failures that must be classified, not guessed.

import { spawn } from 'node:child_process';
import fs from 'node:fs';

if (process.env.FAKE_SSH_FAIL === 'hostkey') {
  process.stderr.write('@@@@@@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@@@@@@\nHost key verification failed.\n');
  process.exit(255);
}
if (process.env.FAKE_SSH_FAIL === 'refused') {
  process.stderr.write('ssh: connect to host node port 22: Connection refused\n');
  process.exit(255);
}
if (process.env.FAKE_SSH_FAIL === 'auth') {
  process.stderr.write('user@node: Permission denied (publickey).\n');
  process.exit(255);
}

const argv = process.argv.slice(2);
let index = 0;
let host = '';
for (; index < argv.length; index += 1) {
  const token = argv[index];
  if (token === '-o' || token === '-p' || token === '-i' || token === '-l') {
    index += 1;
    continue;
  }
  if (token.startsWith('-')) continue;
  host = token;
  break;
}
const remote = argv.slice(index + 1).join(' ');
if (!host) {
  process.stderr.write('fake-ssh: no host\n');
  process.exit(2);
}
if (process.env.FAKE_SSH_LOG) {
  fs.appendFileSync(process.env.FAKE_SSH_LOG, JSON.stringify({ host, remote }) + '\n');
}
const child = spawn('bash', ['-c', remote], { stdio: 'inherit' });
child.on('exit', (code, signal) => {
  process.exit(signal ? 128 : code ?? 1);
});
