/**
 * @author Codex
 * @description Verifies original image transport, content-based MIME detection and provider format rejection.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { recognizePage } from '../dist/extensions/knowledge/lib/models/ocr.js';
import { ocrImageMime } from '../dist/extensions/knowledge/lib/models/ocr-image.js';
import { readOcrInput } from '../dist/extensions/knowledge/lib/ocr-input.js';

const config = {
  endpoint: 'http://127.0.0.1:1234/v1',
  model: 'fixture',
  timeoutMs: 1000,
  kind: 'ocr',
  mode: 'auto',
  maxOutputTokens: 512,
};

/**
 * Build an ISO image file-type box; fixtures exercise transport signatures, not provider image decoding.
 */
function fileTypeBox(major, ...compatible) {
  const bytes = Buffer.alloc(16 + compatible.length * 4);
  bytes.writeUInt32BE(bytes.length);
  bytes.write('ftyp', 4);
  bytes.write(major, 8);
  compatible.forEach((brand, index) => bytes.write(brand, 16 + index * 4));
  return bytes;
}

const images = [
  ['png', 'image/png', Buffer.from('89504e470d0a1a0a', 'hex')],
  ['jpg', 'image/jpeg', Buffer.from('ffd8ffe000104a4649460001', 'hex')],
  ['jpeg', 'image/jpeg', Buffer.from('ffd8ffe10010457869660000', 'hex')],
  ['gif87', 'image/gif', Buffer.from('GIF87a\x01\x00\x01\x00')],
  ['gif89', 'image/gif', Buffer.from('GIF89a\x01\x00\x01\x00')],
  ['webp', 'image/webp', Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 ')],
  ['bmp', 'image/bmp', Buffer.from('424d360000000000000036000000', 'hex')],
  ['tif-le', 'image/tiff', Buffer.from('49492a0008000000', 'hex')],
  ['tif-be', 'image/tiff', Buffer.from('4d4d002a00000008', 'hex')],
  ['bigtiff', 'image/tiff', Buffer.from('49492b0008000000', 'hex')],
  ['ico', 'image/vnd.microsoft.icon', Buffer.from('000001000100', 'hex')],
  ['avif', 'image/avif', fileTypeBox('avif', 'mif1')],
  ['avif-compatible', 'image/avif', fileTypeBox('mif1', 'avif')],
  ['avif-sequence', 'image/avif', fileTypeBox('avis', 'avif')],
  ['heic', 'image/heic', fileTypeBox('mif1', 'heic')],
  ['heic-sequence', 'image/heic-sequence', fileTypeBox('hevc', 'msf1')],
  ['heif', 'image/heif', fileTypeBox('mif1')],
  ['heif-sequence', 'image/heif-sequence', fileTypeBox('msf1')],
];

test('common images reach the provider with detected MIME and unchanged bytes regardless of extension', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-ocr-types-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [name, mime, bytes] of images) {
    await t.test(name, async () => {
      await writeFile(join(directory, 'renamed.png'), bytes);
      const input = await readOcrInput(directory, 'renamed.png');
      assert.deepEqual(input, bytes);
      let calls = 0;
      const text = await recognizePage(config, input, undefined, async (_url, options) => {
        calls++;
        const body = JSON.parse(options.body);
        assert.equal(
          body.messages[0].content[0].image_url.url,
          `data:${mime};base64,${bytes.toString('base64')}`
        );
        return Response.json({ choices: [{ finish_reason: 'stop', message: { content: ' recognized ' } }] });
      });
      assert.equal(text, 'recognized');
      assert.equal(calls, 1);
    });
  }
});

test('PDF, unknown content, truncated containers and oversized images fail before provider calls', async () => {
  const invalid = [
    Buffer.from('%PDF-1.7\n'),
    Buffer.from('not an image'),
    Buffer.alloc(0),
    Buffer.from('RIFF0000WAVE'),
    fileTypeBox('mp42'),
  ];
  const malformed = fileTypeBox('avif');
  malformed.writeUInt32BE(200);
  invalid.push(malformed, Buffer.alloc(20 * 1024 * 1024 + 1));
  for (const bytes of invalid) {
    assert.throws(() => ocrImageMime(bytes), { code: 'INVALID_INPUT' });
    await assert.rejects(
      recognizePage(config, bytes, undefined, async () => {
        assert.fail('invalid content must not reach the provider');
      }),
      { code: 'INVALID_INPUT' }
    );
  }
});

test('SVG is recognized as source input but cannot be sent directly to the model', async () => {
  const image = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');
  assert.equal(ocrImageMime(image), 'image/svg+xml');
  await assert.rejects(
    recognizePage(config, image, undefined, async () => {
      assert.fail('raw SVG must never reach the provider');
    }),
    { code: 'INVALID_INPUT' }
  );
});

test('provider rejection of a recognized image format is surfaced without converting or retrying', async () => {
  const bytes = fileTypeBox('heic');
  let calls = 0;
  await assert.rejects(
    recognizePage(config, bytes, undefined, async (_url, options) => {
      calls++;
      assert.equal(
        JSON.parse(options.body).messages[0].content[0].image_url.url,
        `data:image/heic;base64,${bytes.toString('base64')}`
      );
      return new Response('unsupported image format: private provider diagnostics', { status: 415 });
    }),
    (error) => {
      assert.equal(error.code, 'MODEL_REQUEST_FAILED');
      assert.match(error.message, /415/);
      assert.ok(!error.message.includes('private'));
      return true;
    }
  );
  assert.equal(calls, 1);
});
