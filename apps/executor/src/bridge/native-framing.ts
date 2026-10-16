/**
 * @author Codex
 * @description Decodes bounded little-endian Native Messaging frames and writes serialized frames with stream backpressure.
 */
import type { Readable, Writable } from 'node:stream';
import { once } from 'node:events';
import { bridgeFrameLimit } from '@octopus/shared/protocol/browser-bridge';

/**
 * Accepts fragmented or coalesced binary input; rejects invalid lengths, UTF-8, JSON and partial EOF.
 */
export async function* readFrames(input: Readable): AsyncGenerator<unknown> {
  let buffered = Buffer.alloc(0);
  for await (const value of input) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 4) {
      const length = buffered.readUInt32LE(0);
      if (!length || length > bridgeFrameLimit) {
        throw new Error('Invalid native frame length');
      }
      if (buffered.length < length + 4) {
        break;
      }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(buffered.subarray(4, length + 4));
      buffered = buffered.subarray(length + 4);
      yield JSON.parse(text);
    }
    if (buffered.length > bridgeFrameLimit + 4) {
      throw new Error('Native buffer exceeded');
    }
  }
  if (buffered.length) {
    throw new Error('Incomplete native frame');
  }
}
/**
 * Emits one complete bounded JSON frame, waiting for drain instead of accumulating output.
 */
export async function writeFrame(output: Writable, value: unknown): Promise<void> {
  const json = Buffer.from(JSON.stringify(value), 'utf8');
  if (!json.length || json.length > bridgeFrameLimit) {
    throw new Error('Native frame too large');
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length);
  if (!output.write(Buffer.concat([header, json]))) {
    await once(output, 'drain', { signal: AbortSignal.timeout(5000) });
  }
}
