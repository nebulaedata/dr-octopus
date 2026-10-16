/**
 * @author Codex
 * @description Frames bounded UTF-8 MCP stdio messages and serializes output under explicit backpressure budgets.
 */
import type { Readable, Writable } from 'node:stream';
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

export const stdioFrameLimit = 24 * 1024 * 1024;

/**
 * Decodes newline-delimited messages, refusing invalid UTF-8, excessive trees and incomplete final frames.
 * @throws When a frame exceeds its byte/tree budget or does not contain one JSON-RPC message.
 */
export async function* readStdioMessages(input: Readable): AsyncGenerator<JSONRPCMessage> {
  let chunks: Buffer[] = [];
  let bytes = 0;
  for await (const value of input) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start);
      const end = newline < 0 ? chunk.length : newline;
      const part = chunk.subarray(start, end);
      bytes += part.length;
      if (bytes > stdioFrameLimit) {
        throw new Error('STDIO_FRAME_TOO_LARGE');
      }
      chunks.push(part);
      if (newline < 0) {
        break;
      }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes));
      chunks = [];
      bytes = 0;
      const message: unknown = JSON.parse(text);
      const tree = [{ value: message, depth: 0 }];
      let nodes = 0;
      while (tree.length) {
        const item = tree.pop()!;
        if (++nodes > 10000 || item.depth > 32) {
          throw new Error('STDIO_TREE_TOO_LARGE');
        }
        if (item.value && typeof item.value === 'object') {
          for (const child of Object.values(item.value)) {
            tree.push({ value: child, depth: item.depth + 1 });
          }
        }
      }
      yield JSONRPCMessageSchema.parse(message);
      start = newline + 1;
    }
  }
  if (bytes) {
    throw new Error('STDIO_INCOMPLETE_FRAME');
  }
}

export class StdioWriter {
  private tail: Promise<void> = Promise.resolve();
  private buffered = 0;
  private failed = false;

  /**
   * Binds one protocol-only output; the caller owns stream errors and process shutdown.
   */
  constructor(private readonly output: Writable) {}

  /**
   * Preserves enqueue order, never truncates JSON, and fails closed when queued output exceeds 48 MiB.
   */
  send(message: JSONRPCMessage): Promise<void> {
    if (this.failed) {
      return Promise.reject(new Error('STDIO_OUTPUT_FAILED'));
    }
    const frame = Buffer.from(JSON.stringify(JSONRPCMessageSchema.parse(message)) + '\n');
    if (frame.length - 1 > stdioFrameLimit || this.buffered + frame.length > 2 * stdioFrameLimit) {
      this.failed = true;
      return Promise.reject(new Error('STDIO_OUTPUT_TOO_LARGE'));
    }
    this.buffered += frame.length;
    const sent = this.tail.then(async () => {
      if (this.failed) {
        throw new Error('STDIO_OUTPUT_FAILED');
      }
      await new Promise<void>((accept, reject) => {
        this.output.write(frame, (error) => (error ? reject(error) : accept()));
      });
    });
    this.tail = sent.catch(() => {
      this.failed = true;
    });
    return sent.finally(() => {
      this.buffered -= frame.length;
    });
  }

  /**
   * Waits for already enqueued frames; shutdown owners apply their own bounded exit deadline.
   */
  async drain(): Promise<void> {
    await this.tail;
    if (this.failed) {
      throw new Error('STDIO_OUTPUT_FAILED');
    }
  }
}
