/**
 * @author Codex
 * @description Verifies binary Native Messaging framing at hostile stream boundaries and bounded output backpressure.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { readFrames, writeFrame } from '../src/bridge/native-framing.ts';
/**
 * Encodes test-only protocol bytes without depending on the production writer.
 */
function frame(text) {
  const bytes = Buffer.from(text);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(bytes.length);
  return Buffer.concat([size, bytes]);
}
test('native decoder handles fragmented headers, Unicode and coalesced frames', async () => {
  const bytes = Buffer.concat([frame('{"text":"中文😀"}'), frame('{"next":true}')]);
  const result = [];
  for await (const value of readFrames(Readable.from([...bytes].map((byte) => Buffer.from([byte]))))) {
    result.push(value);
  }
  assert.deepEqual(result, [{ text: '中文😀' }, { next: true }]);
});
test('native decoder rejects oversized/zero lengths, malformed UTF-8/JSON and partial EOF', async () => {
  const big = Buffer.alloc(4);
  big.writeUInt32LE(256 * 1024 + 1);
  for (const bytes of [
    big,
    Buffer.alloc(4),
    frame('not JSON'),
    Buffer.from([1, 0, 0, 0, 255]),
    Buffer.from([8, 0, 0, 0, 123]),
  ]) {
    await assert.rejects(async () => {
      for await (const value of readFrames(Readable.from([bytes]))) {
        void value;
      }
    });
  }
});
test('native writer emits exact byte lengths under backpressure and refuses large JSON', async () => {
  const chunks = [];
  const stream = new Writable({
    highWaterMark: 1,
    write(chunk, _encoding, done) {
      chunks.push(chunk);
      setImmediate(done);
    },
  });
  await writeFrame(stream, { text: '中文😀' });
  const bytes = Buffer.concat(chunks);
  assert.equal(bytes.readUInt32LE(), bytes.length - 4);
  assert.deepEqual(JSON.parse(bytes.subarray(4).toString()), { text: '中文😀' });
  await assert.rejects(writeFrame(stream, { text: 'a'.repeat(256 * 1024) }));
  stream.destroy();
});
