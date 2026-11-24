import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DATA,
  FrameDecoder,
  MAX_DATA,
  MAX_DATA_BYTES,
  decodeData,
  encodeData,
} from '../../dist/v1/frame.js';

describe('data frame limits', () => {
  test('the largest file chunk plus its stream header fits one DATA frame', () => {
    const bytes = Buffer.alloc(MAX_DATA_BYTES, 0x61);
    const encoded = encodeData(7, 3n, bytes);
    assert.equal(encoded.readUInt32BE(0), MAX_DATA + 1);
    assert.equal(encoded.readUInt8(4), DATA);
    const frames = new FrameDecoder().feed(encoded);
    assert.equal(frames.length, 1);
    const data = decodeData(frames[0].payload);
    assert.equal(data.streamId, 7);
    assert.equal(data.seq, 3n);
    assert.equal(data.bytes.length, MAX_DATA_BYTES);
  });

  test('rejects a chunk that would make the DATA frame oversized', () => {
    assert.throws(
      () => encodeData(1, 0n, Buffer.alloc(MAX_DATA_BYTES + 1)),
      /exceeds/,
    );
  });
});
