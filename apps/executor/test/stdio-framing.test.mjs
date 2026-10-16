/**
 * @author Codex
 * @description Exercises real stream fragmentation, UTF-8 validation and protocol output backpressure for stdio.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable, Writable } from 'node:stream';
import { readStdioMessages, StdioWriter, stdioFrameLimit } from '../src/bridge/stdio-framing.ts';

/**
 * Collects messages from caller-controlled byte chunks using the production decoder.
 */
async function decode(chunks) {
  const result = [];
  for await (const message of readStdioMessages(Readable.from(chunks))) {
    result.push(message);
  }
  return result;
}

test('stdio preserves split Unicode and coalesced JSON-RPC messages with CRLF', async () => {
  const first = { jsonrpc: '2.0', id: '中文', method: 'ping' };
  const second = { jsonrpc: '2.0', method: 'notifications/initialized' };
  const bytes = Buffer.from(JSON.stringify(first) + '\r\n' + JSON.stringify(second) + '\n');
  const split = bytes.indexOf(Buffer.from('中文')) + 1;
  assert.deepEqual(await decode([bytes.subarray(0, split), bytes.subarray(split)]), [first, second]);
});

test('stdio rejects malformed, incomplete, non-UTF8, batch and over-budget input', async () => {
  for (const frame of ['{\n', '{}\n', '[]\n', '{"jsonrpc":"2.0","method":"ping"}']) {
    await assert.rejects(decode([Buffer.from(frame)]));
  }
  await assert.rejects(decode([Buffer.from([0xff, 10])]));
  await assert.rejects(decode([Buffer.alloc(stdioFrameLimit + 1, 32)]), /STDIO_FRAME_TOO_LARGE/);
  const nested = {
    jsonrpc: '2.0',
    method: 'ping',
    params: JSON.parse('['.repeat(34) + '0' + ']'.repeat(34)),
  };
  await assert.rejects(decode([Buffer.from(JSON.stringify(nested) + '\n')]), /STDIO_TREE_TOO_LARGE/);
});

test('stdio serializes concurrent responses despite a blocked output consumer', async () => {
  const chunks = [];
  const callbacks = [];
  const output = new Writable({
    highWaterMark: 1,
    write(chunk, encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callbacks.push(callback);
    },
  });
  const writer = new StdioWriter(output);
  const first = writer.send({ jsonrpc: '2.0', id: 2, result: { value: '中文' } });
  const second = writer.send({ jsonrpc: '2.0', id: 1, result: {} });
  await new Promise((accept) => setImmediate(accept));
  assert.equal(chunks.length, 1);
  callbacks.shift()();
  await first;
  await new Promise((accept) => setImmediate(accept));
  assert.equal(chunks.length, 2);
  callbacks.shift()();
  await second;
  await writer.drain();
  assert.deepEqual(
    (await decode(chunks)).map((message) => message.id),
    [2, 1]
  );
});

test('stdio fails closed for oversized output and subsequent sends', async () => {
  const writer = new StdioWriter(
    new Writable({
      write(chunk, encoding, callback) {
        callback();
      },
    })
  );
  await assert.rejects(
    writer.send({ jsonrpc: '2.0', id: 1, result: { text: 'x'.repeat(stdioFrameLimit) } }),
    /STDIO_OUTPUT_TOO_LARGE/
  );
  await assert.rejects(writer.send({ jsonrpc: '2.0', id: 2, result: {} }), /STDIO_OUTPUT_FAILED/);
});
