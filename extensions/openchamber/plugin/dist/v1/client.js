/** Protocol client: requests, notifications, credit-controlled streams. */
import fs from 'node:fs';
import { FLEET_VERSION } from '../version.js';
import { DATA_HEADER_BYTES, FrameDecoder, MAX_DATA_BYTES, decodeData, encodeControl, encodeData } from './frame.js';
import { AgentError } from './errors.js';
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_CREDIT = 4 * 1024 * 1024;
export class AgentClient {
    transport;
    decoder = new FrameDecoder();
    pending = new Map();
    streams = new Map();
    nextId = 1;
    closed = false;
    info;
    constructor(transport, info) {
        this.transport = transport;
        this.info = info;
        this.transport.stdout.on('data', (chunk) => this.onData(chunk));
        this.transport.stdout.on('end', () => {
            if (this.closed)
                return;
            this.closed = true;
            this.failAll(new AgentError('INVALID_FRAME', 'agent closed the connection'));
        });
        this.transport.stdin.on('error', (error) => {
            if (this.closed)
                return;
            this.closed = true;
            this.failAll(new AgentError('INVALID_FRAME', `agent connection closed: ${error.message}`));
            try {
                this.transport.kill();
            }
            catch { /* already gone */ }
        });
        this.transport.stderr.on('data', (chunk) => { if (process.env.FLEET_DEBUG)
            process.stderr.write(chunk); });
    }
    static async connect(transport, options = {}) {
        const provisional = new AgentClient(transport, {
            protocol: { major: 0, minor: 0 },
            agent: { version: 'unknown', installationId: '', os: '', arch: '' },
            capabilities: {},
            limits: { maxControl: 0, maxData: 0, maxStreams: 0 },
        });
        const result = (await provisional.request('session.initialize', {
            protocol: { major: 1, minor: 0 },
            client: { name: 'fleet', version: FLEET_VERSION, instance: `${process.pid}-${Date.now()}` },
            capabilities: options.capabilities ?? [],
        }, options.timeoutMs ?? 15_000));
        if (!result?.protocol || result.protocol.major !== 1) {
            throw new AgentError('UNSUPPORTED_PROTOCOL', 'agent did not accept protocol major 1');
        }
        const maxData = result.limits?.maxData;
        if (typeof maxData !== 'number' || !Number.isFinite(maxData) || maxData <= DATA_HEADER_BYTES) {
            throw new AgentError('UNSUPPORTED_CAPABILITY', `agent maxData ${String(maxData)} cannot carry a stream header`);
        }
        return new AgentClient(transport, result);
    }
    async request(method, params, timeoutMs = DEFAULT_TIMEOUT) {
        if (this.closed)
            throw new AgentError('INVALID_FRAME', 'agent connection is closed');
        const id = String(this.nextId++);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new AgentError('OPERATION_UNKNOWN', `${method} timed out after ${timeoutMs}ms`, true));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            this.transport.stdin.write(encodeControl({ jsonrpc: '2.0', id, method, params }));
        });
    }
    /** Register interest in an output stream and grant initial credit. */
    collect(streamId, options = {}) {
        if (this.streams.has(streamId))
            throw new Error(`stream ${streamId} is already collected`);
        return new Promise((resolve, reject) => {
            const signal = options.signal;
            const onAbort = () => {
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
                this.streams.delete(streamId);
                reject(new AgentError('CANCELLED', 'operation cancelled'));
            };
            const timer = setTimeout(() => {
                this.streams.delete(streamId);
                signal?.removeEventListener('abort', onAbort);
                reject(new AgentError('OPERATION_UNKNOWN', `stream ${streamId} did not end`, true));
            }, options.timeoutMs ?? 120_000);
            if (signal?.aborted) {
                clearTimeout(timer);
                reject(new AgentError('CANCELLED', 'operation cancelled'));
                return;
            }
            signal?.addEventListener('abort', onAbort, { once: true });
            this.streams.set(streamId, {
                chunks: [],
                bytes: 0,
                nextSeq: 0n,
                onData: options.onData,
                ...(options.sink === undefined ? {} : { sink: options.sink }),
                resolve: (value) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve(value); },
                reject: (error) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(error); },
            });
            void this.credit(streamId, options.initialCredit ?? DEFAULT_CREDIT).catch(() => { });
        });
    }
    async credit(streamId, bytes) {
        await this.request('stream.credit', { streamId, bytes });
    }
    /** Upload bytes as DATA frames, then end the stream. */
    async upload(streamId, data) {
        const chunkSize = Math.min(MAX_DATA_BYTES, this.info.limits.maxData - DATA_HEADER_BYTES);
        if (chunkSize < 1)
            throw new AgentError('UNSUPPORTED_CAPABILITY', 'agent maxData cannot carry a stream payload');
        let seq = 0n;
        for (let offset = 0; offset < data.length; offset += chunkSize) {
            const chunk = data.subarray(offset, offset + chunkSize);
            await this.writeData(streamId, seq, chunk);
            seq += 1n;
        }
        return this.request('stream.end', { streamId });
    }
    /** Upload a file in bounded chunks, then end the stream. */
    async uploadFile(streamId, file) {
        const chunkSize = Math.min(MAX_DATA_BYTES, this.info.limits.maxData - DATA_HEADER_BYTES);
        if (chunkSize < 1)
            throw new AgentError('UNSUPPORTED_CAPABILITY', 'agent maxData cannot carry a stream payload');
        let seq = 0n;
        for await (const value of fs.createReadStream(file, { highWaterMark: chunkSize })) {
            const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
            await this.writeData(streamId, seq, chunk);
            seq += 1n;
        }
        return this.request('stream.end', { streamId });
    }
    /** Stream an already-open regular file, so the hashed bytes are the uploaded bytes. */
    async uploadFd(streamId, fd, signal) {
        const chunkSize = Math.min(MAX_DATA_BYTES, this.info.limits.maxData - DATA_HEADER_BYTES);
        if (chunkSize < 1)
            throw new AgentError('UNSUPPORTED_CAPABILITY', 'agent maxData cannot carry a stream payload');
        let seq = 0n;
        for await (const value of fs.createReadStream('', { fd, start: 0, autoClose: false, highWaterMark: chunkSize })) {
            if (signal?.aborted)
                throw new AgentError('CANCELLED', 'operation cancelled');
            const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
            await this.writeData(streamId, seq, chunk);
            seq += 1n;
        }
        return this.request('stream.end', { streamId });
    }
    /** Receive a stream into a file without retaining it in memory. */
    async collectToFile(streamId, file, options = {}) {
        const fd = fs.openSync(file, 'wx', 0o600);
        try {
            const result = await this.collect(streamId, {
                ...options,
                sink: (chunk) => {
                    let offset = 0;
                    while (offset < chunk.length) {
                        offset += fs.writeSync(fd, chunk, offset);
                    }
                },
            });
            fs.fsyncSync(fd);
            return result;
        }
        finally {
            fs.closeSync(fd);
        }
    }
    async writeData(streamId, seq, chunk) {
        const accepted = this.transport.stdin.write(encodeData(streamId, seq, chunk));
        if (accepted)
            return;
        await new Promise((resolve, reject) => {
            const onDrain = () => {
                this.transport.stdin.removeListener('error', onError);
                resolve();
            };
            const onError = (error) => {
                this.transport.stdin.removeListener('drain', onDrain);
                reject(error);
            };
            this.transport.stdin.once('drain', onDrain);
            this.transport.stdin.once('error', onError);
        });
    }
    close() {
        if (this.closed)
            return;
        this.closed = true;
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new AgentError('OPERATION_UNKNOWN', 'connection closed'));
        }
        this.pending.clear();
        for (const stream of this.streams.values()) {
            stream.reject(new AgentError('OPERATION_UNKNOWN', 'connection closed'));
        }
        this.streams.clear();
        this.transport.kill();
    }
    onData(chunk) {
        let frames;
        try {
            frames = this.decoder.feed(chunk);
        }
        catch (error) {
            this.failAll(error instanceof Error ? error : new Error(String(error)));
            this.transport.kill();
            return;
        }
        for (const frame of frames) {
            if (frame.kind === 2) {
                this.onStreamData(frame.payload);
                continue;
            }
            let message;
            try {
                message = JSON.parse(frame.payload.toString('utf8'));
            }
            catch {
                this.failAll(new AgentError('INVALID_FRAME', 'agent sent invalid JSON'));
                return;
            }
            this.onControl(message);
        }
    }
    onControl(message) {
        if (typeof message.id === 'string' || typeof message.id === 'number') {
            const pending = this.pending.get(String(message.id));
            if (!pending)
                return;
            this.pending.delete(String(message.id));
            clearTimeout(pending.timer);
            if (message.error) {
                const error = message.error;
                pending.reject(new AgentError(error.code ?? 'INTERNAL', error.message ?? 'agent error', error.retryable === true));
            }
            else {
                pending.resolve(message.result);
            }
            return;
        }
        if (message.method === 'stream.end') {
            const params = message.params;
            const stream = params?.streamId === undefined ? undefined : this.streams.get(params.streamId);
            if (!stream)
                return;
            this.streams.delete(params.streamId);
            stream.resolve(Buffer.concat(stream.chunks));
        }
    }
    onStreamData(payload) {
        let header;
        try {
            header = decodeData(payload);
        }
        catch (error) {
            this.failAll(error instanceof Error ? error : new Error(String(error)));
            return;
        }
        const stream = this.streams.get(header.streamId);
        if (!stream)
            return;
        if (header.seq !== stream.nextSeq) {
            this.streams.delete(header.streamId);
            stream.reject(new AgentError('INVALID_FRAME', 'stream sequence gap'));
            return;
        }
        stream.nextSeq += 1n;
        if (stream.sink) {
            try {
                stream.sink(header.bytes);
            }
            catch (error) {
                this.streams.delete(header.streamId);
                stream.reject(error instanceof Error ? error : new Error(String(error)));
                return;
            }
        }
        else {
            stream.chunks.push(header.bytes);
        }
        stream.bytes += header.bytes.length;
        try {
            stream.onData?.(header.bytes);
        }
        catch {
            // A progress observer cannot invalidate protocol bytes already accepted.
        }
        // Keep the pipe flowing: grant credit as data is consumed.
        void this.credit(header.streamId, header.bytes.length * 2 + 1024).catch(() => { });
    }
    failAll(error) {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pending.clear();
        for (const stream of this.streams.values())
            stream.reject(error);
        this.streams.clear();
    }
}
//# sourceMappingURL=client.js.map