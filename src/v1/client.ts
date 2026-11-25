/** Protocol client: requests, notifications, credit-controlled streams. */

import fs from 'node:fs';
import { FLEET_VERSION } from '../version.js';
import { DATA_HEADER_BYTES, FrameDecoder, MAX_DATA_BYTES, decodeData, encodeControl, encodeData } from './frame.js';
import { AgentError } from './errors.js';
import type { AgentTransport } from './transport.js';

export interface AgentInfo {
  protocol: { major: number; minor: number };
  agent: { version: string; installationId: string; os: string; arch: string; pid?: number };
  capabilities: Record<string, number>;
  limits: { maxControl: number; maxData: number; maxStreams: number; maxManifestEntries?: number };
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface IncomingStream {
  chunks: Buffer[];
  bytes: number;
  nextSeq: bigint;
  onData?: (chunk: Buffer) => void;
  sink?: (chunk: Buffer) => void;
  resolve: (value: Buffer) => void;
  reject: (error: Error) => void;
}

export interface CollectOptions {
  readonly initialCredit?: number;
  readonly timeoutMs?: number;
  /** Called for each received DATA payload. Progress reporting must stay bounded. */
  readonly onData?: (chunk: Buffer) => void;
  /** Consume each payload instead of retaining it. The returned buffer is empty. */
  readonly sink?: (chunk: Buffer) => void;
}

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_CREDIT = 4 * 1024 * 1024;

export class AgentClient {
  private readonly transport: AgentTransport;
  private readonly decoder = new FrameDecoder();
  private readonly pending = new Map<string, Pending>();
  private readonly streams = new Map<number, IncomingStream>();
  private nextId = 1;
  private closed = false;
  readonly info: AgentInfo;

  private constructor(transport: AgentTransport, info: AgentInfo) {
    this.transport = transport;
    this.info = info;
    this.transport.stdout.on('data', (chunk: Buffer) => this.onData(chunk));
    this.transport.stdout.on('end', () => {
      if (this.closed) return;
      this.closed = true;
      this.failAll(new AgentError('INVALID_FRAME', 'agent closed the connection'));
    });
    this.transport.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (this.closed) return;
      this.closed = true;
      this.failAll(new AgentError('INVALID_FRAME', `agent connection closed: ${error.message}`));
      try { this.transport.kill(); } catch { /* already gone */ }
    });
    this.transport.stderr.on('data', (chunk: Buffer) => { if (process.env.FLEET_DEBUG) process.stderr.write(chunk); });
  }

  static async connect(transport: AgentTransport, options: { capabilities?: string[]; timeoutMs?: number } = {}): Promise<AgentClient> {
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
    }, options.timeoutMs ?? 15_000)) as AgentInfo;
    if (!result?.protocol || result.protocol.major !== 1) {
      throw new AgentError('UNSUPPORTED_PROTOCOL', 'agent did not accept protocol major 1');
    }
    const maxData = result.limits?.maxData;
    if (typeof maxData !== 'number' || !Number.isFinite(maxData) || maxData <= DATA_HEADER_BYTES) {
      throw new AgentError('UNSUPPORTED_CAPABILITY', `agent maxData ${String(maxData)} cannot carry a stream header`);
    }
    return new AgentClient(transport, result);
  }

  async request(method: string, params: unknown, timeoutMs = DEFAULT_TIMEOUT): Promise<unknown> {
    if (this.closed) throw new AgentError('INVALID_FRAME', 'agent connection is closed');
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
  collect(streamId: number, options: CollectOptions = {}): Promise<Buffer> {
    if (this.streams.has(streamId)) throw new Error(`stream ${streamId} is already collected`);
    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.streams.delete(streamId);
        reject(new AgentError('OPERATION_UNKNOWN', `stream ${streamId} did not end`, true));
      }, options.timeoutMs ?? 120_000);
      this.streams.set(streamId, {
        chunks: [],
        bytes: 0,
        nextSeq: 0n,
        onData: options.onData,
        ...(options.sink === undefined ? {} : { sink: options.sink }),
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      void this.credit(streamId, options.initialCredit ?? DEFAULT_CREDIT).catch(() => {});
    });
  }

  async credit(streamId: number, bytes: number): Promise<void> {
    await this.request('stream.credit', { streamId, bytes });
  }

  /** Upload bytes as DATA frames, then end the stream. */
  async upload(streamId: number, data: Buffer): Promise<unknown> {
    const chunkSize = Math.min(MAX_DATA_BYTES, this.info.limits.maxData - DATA_HEADER_BYTES);
    if (chunkSize < 1) throw new AgentError('UNSUPPORTED_CAPABILITY', 'agent maxData cannot carry a stream payload');
    let seq = 0n;
    for (let offset = 0; offset < data.length; offset += chunkSize) {
      const chunk = data.subarray(offset, offset + chunkSize);
      await this.writeData(streamId, seq, chunk);
      seq += 1n;
    }
    return this.request('stream.end', { streamId });
  }

  /** Upload a file in bounded chunks, then end the stream. */
  async uploadFile(streamId: number, file: string): Promise<unknown> {
    const chunkSize = Math.min(MAX_DATA_BYTES, this.info.limits.maxData - DATA_HEADER_BYTES);
    if (chunkSize < 1) throw new AgentError('UNSUPPORTED_CAPABILITY', 'agent maxData cannot carry a stream payload');
    let seq = 0n;
    for await (const value of fs.createReadStream(file, { highWaterMark: chunkSize })) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      await this.writeData(streamId, seq, chunk);
      seq += 1n;
    }
    return this.request('stream.end', { streamId });
  }

  /** Receive a stream into a file without retaining it in memory. */
  async collectToFile(streamId: number, file: string, options: Omit<CollectOptions, 'sink'> = {}): Promise<Buffer> {
    const fd = fs.openSync(file, 'wx', 0o600);
    try {
      return await this.collect(streamId, {
        ...options,
        sink: (chunk) => {
          let offset = 0;
          while (offset < chunk.length) {
            offset += fs.writeSync(fd, chunk, offset);
          }
        },
      });
    } finally {
      fs.closeSync(fd);
    }
  }

  private async writeData(streamId: number, seq: bigint, chunk: Buffer): Promise<void> {
    const accepted = this.transport.stdin.write(encodeData(streamId, seq, chunk));
    if (accepted) return;
    await new Promise<void>((resolve, reject) => {
      const onDrain = () => {
        this.transport.stdin.removeListener('error', onError);
        resolve();
      };
      const onError = (error: NodeJS.ErrnoException) => {
        this.transport.stdin.removeListener('drain', onDrain);
        reject(error);
      };
      this.transport.stdin.once('drain', onDrain);
      this.transport.stdin.once('error', onError);
    });
  }

  close(): void {
    if (this.closed) return;
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

  private onData(chunk: Buffer): void {
    let frames;
    try {
      frames = this.decoder.feed(chunk);
    } catch (error) {
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
      } catch {
        this.failAll(new AgentError('INVALID_FRAME', 'agent sent invalid JSON'));
        return;
      }
      this.onControl(message);
    }
  }

  private onControl(message: Record<string, unknown>): void {
    if (typeof message.id === 'string' || typeof message.id === 'number') {
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      this.pending.delete(String(message.id));
      clearTimeout(pending.timer);
      if (message.error) {
        const error = message.error as { code?: string; message?: string; retryable?: boolean };
        pending.reject(new AgentError(error.code ?? 'INTERNAL', error.message ?? 'agent error', error.retryable === true));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.method === 'stream.end') {
      const params = message.params as { streamId?: number };
      const stream = params?.streamId === undefined ? undefined : this.streams.get(params.streamId);
      if (!stream) return;
      this.streams.delete(params.streamId as number);
      stream.resolve(Buffer.concat(stream.chunks));
    }
  }

  private onStreamData(payload: Buffer): void {
    let header;
    try {
      header = decodeData(payload);
    } catch (error) {
      this.failAll(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const stream = this.streams.get(header.streamId);
    if (!stream) return;
    if (header.seq !== stream.nextSeq) {
      this.streams.delete(header.streamId);
      stream.reject(new AgentError('INVALID_FRAME', 'stream sequence gap'));
      return;
    }
    stream.nextSeq += 1n;
    if (stream.sink) {
      try {
        stream.sink(header.bytes);
      } catch (error) {
        this.streams.delete(header.streamId);
        stream.reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
    } else {
      stream.chunks.push(header.bytes);
    }
    stream.bytes += header.bytes.length;
    try {
      stream.onData?.(header.bytes);
    } catch {
      // A progress observer cannot invalidate protocol bytes already accepted.
    }
    // Keep the pipe flowing: grant credit as data is consumed.
    void this.credit(header.streamId, header.bytes.length * 2 + 1024).catch(() => {});
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const stream of this.streams.values()) stream.reject(error);
    this.streams.clear();
  }
}
