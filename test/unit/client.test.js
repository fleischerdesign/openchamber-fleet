import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, test } from 'node:test';
import { AgentClient } from '../../dist/v1/client.js';
import { CONTROL, DATA, FrameDecoder, decodeData, encodeControl } from '../../dist/v1/frame.js';

function fakeTransport(maxData) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const frames = [];
  const decoder = new FrameDecoder();
  stdin.on('data', (chunk) => {
    for (const frame of decoder.feed(chunk)) {
      if (frame.kind === DATA) {
        frames.push(decodeData(frame.payload));
        continue;
      }
      if (frame.kind !== CONTROL) continue;
      const message = JSON.parse(frame.payload.toString('utf8'));
      if (message.method === 'session.initialize') {
        stdout.write(encodeControl({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocol: { major: 1, minor: 1 },
            agent: { version: 'test', installationId: 'test', os: 'linux', arch: 'x64' },
            capabilities: {},
            limits: { maxControl: 1024 * 1024, maxData, maxStreams: 4 },
          },
        }));
      } else if (message.method === 'stream.end') {
        stdout.write(encodeControl({ jsonrpc: '2.0', id: message.id, result: { ok: true } }));
      }
    }
  });
  return {
    stdin,
    stdout,
    stderr,
    frames,
    kill() {
      stdin.destroy();
      stdout.destroy();
      stderr.destroy();
    },
  };
}

describe('negotiated data limit', () => {
  test('upload chunks at the smaller advertised maxData', async () => {
    const transport = fakeTransport(4096);
    const client = await AgentClient.connect(transport);
    try {
      const payload = Buffer.alloc(20_000, 0x61);
      await client.upload(1, payload);
      assert.ok(transport.frames.length > 1);
      assert.ok(transport.frames.every((frame) => frame.bytes.length <= 4096 - 12));
      assert.deepEqual(Buffer.concat(transport.frames.map((frame) => frame.bytes)), payload);
    } finally {
      client.close();
    }
  });

  test('a maxData that cannot carry the stream header is refused', async () => {
    const transport = fakeTransport(12);
    try {
      await assert.rejects(
        AgentClient.connect(transport),
        /cannot carry a stream header/,
      );
    } finally {
      transport.kill();
    }
  });
});
