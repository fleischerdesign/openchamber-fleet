/** `fleet.agent.v1` framing: `u32 length | u8 kind | payload`, big endian. */
export const CONTROL = 1;
export const DATA = 2;
export const MAX_CONTROL = 1024 * 1024;
export const MAX_DATA = 1024 * 1024;
export function encodeFrame(kind, payload) {
    const limit = kind === CONTROL ? MAX_CONTROL : MAX_DATA;
    if (payload.length > limit)
        throw new Error(`frame payload ${payload.length} exceeds ${limit}`);
    const header = Buffer.alloc(5);
    header.writeUInt32BE(payload.length + 1, 0);
    header.writeUInt8(kind, 4);
    return Buffer.concat([header, payload]);
}
export function encodeControl(value) {
    return encodeFrame(CONTROL, Buffer.from(JSON.stringify(value), 'utf8'));
}
export function encodeData(streamId, seq, bytes) {
    const header = Buffer.alloc(12);
    header.writeUInt32BE(streamId, 0);
    header.writeBigUInt64BE(seq, 4);
    return encodeFrame(DATA, Buffer.concat([header, bytes]));
}
export function decodeData(payload) {
    if (payload.length < 12)
        throw new Error('data frame too short');
    return {
        streamId: payload.readUInt32BE(0),
        seq: payload.readBigUInt64BE(4),
        bytes: payload.subarray(12),
    };
}
/** Incremental decoder for a byte stream. */
export class FrameDecoder {
    buffer = Buffer.alloc(0);
    feed(chunk) {
        this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
        const frames = [];
        for (;;) {
            if (this.buffer.length < 4)
                break;
            const length = this.buffer.readUInt32BE(0);
            if (length === 0 || length > MAX_CONTROL + 1)
                throw new Error(`invalid frame length ${length}`);
            if (this.buffer.length < 4 + length)
                break;
            const kind = this.buffer.readUInt8(4);
            if (kind !== CONTROL && kind !== DATA)
                throw new Error(`unknown frame kind ${kind}`);
            const payload = this.buffer.subarray(5, 4 + length);
            frames.push({ kind, payload });
            this.buffer = this.buffer.subarray(4 + length);
        }
        return frames;
    }
}
//# sourceMappingURL=frame.js.map