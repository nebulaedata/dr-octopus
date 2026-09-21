/**
 * @author Codex
 * @description Exercises native OCR compression, unchanged originals, frame preservation and worker cancellation.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, truncate } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { prepareOcrImage } from '../dist/extensions/knowledge/lib/ocr-image-preparation.js';
import { runOcrImageWorker } from '../dist/extensions/knowledge/lib/ocr-image-worker.js';
import { readOcrInput } from '../dist/extensions/knowledge/lib/ocr-input.js';
import { registerKnowledgeModelTools } from '../dist/extensions/knowledge/extension/model-tools.js';

test('SVG with XML declaration, comments and DOCTYPE is always rendered as PNG inside the tool', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-ocr-svg-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const workspace = join(directory, 'workspace');
  await mkdir(workspace);
  const svg = Buffer.from(
    '\uFEFF<?xml version="1.0"?>\n<!-- exported image -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="red"/></svg>'
  );
  await writeFile(join(directory, 'input.svg'), svg);
  let sent;
  const tools = new Map();
  registerKnowledgeModelTools(
    { registerTool: (tool) => tools.set(tool.name, tool) },
    {
      upload: async (bytes) => {
        sent = bytes;
        return { sha256: 'a'.repeat(64) };
      },
      call: async () => ({ text: 'result' }),
    }
  );
  const result = await tools
    .get('ocr_image')
    .execute('svg', { path: join(directory, 'input.svg') }, undefined, undefined, { cwd: workspace });
  assert.equal(result.details.image.method, 'svg-to-png');
  assert.equal(result.details.image.source.mimeType, 'image/svg+xml');
  assert.equal(result.details.image.sent.mimeType, 'image/png');
  assert.ok(svg.length < 20 * 1024 * 1024);
  const metadata = await sharp(sent).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 120);
  assert.equal(metadata.height, 80);
  const pixel = await sharp(sent).removeAlpha().raw().toBuffer();
  assert.deepEqual([...pixel.subarray(0, 3)], [255, 0, 0]);
  assert.deepEqual(await readFile(join(directory, 'input.svg')), svg);
  await assert.rejects(prepareOcrImage(svg, 1), { code: 'OCR_IMAGE_BUDGET_EXCEEDED' });
});

test('invalid and excessive SVGs fail instead of falling back to original SVG bytes', async () => {
  for (const text of [
    '<svg xmlns="http://www.w3.org/2000/svg"><broken>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100000"></svg>',
  ]) {
    await assert.rejects(prepareOcrImage(Buffer.from(text)), (error) => {
      assert.ok(['OCR_IMAGE_PREPARATION_FAILED', 'OCR_IMAGE_PIXEL_LIMIT'].includes(error.code));
      return true;
    });
  }
});

test('oversized TIFF is compressed inside the tool without changing source bytes or dimensions', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-ocr-compression-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = await sharp({ create: { width: 3400, height: 2200, channels: 3, background: 'white' } })
    .tiff({ compression: 'none' })
    .toBuffer();
  assert.ok(source.length > 20 * 1024 * 1024);
  await writeFile(join(directory, 'page.tiff'), source);
  assert.deepEqual(await readOcrInput(directory, 'page.tiff'), source);
  let sent;
  const definitions = new Map();
  registerKnowledgeModelTools(
    { registerTool: (tool) => definitions.set(tool.name, tool) },
    {
      upload: async (bytes) => {
        sent = bytes;
        return { sha256: 'a'.repeat(64) };
      },
      call: async (operation, input) => {
        assert.equal(operation, 'models.ocr');
        assert.equal(input.blobSha256, 'a'.repeat(64));
        return { text: 'recognized text' };
      },
    }
  );
  const result = await definitions
    .get('ocr_image')
    .execute('test', { path: 'page.tiff' }, undefined, undefined, { cwd: directory });
  assert.equal(result.details.text, 'recognized text');
  assert.equal(result.details.image.method, 'png-lossless');
  assert.equal(result.details.image.lossy, false);
  assert.equal(result.details.image.source.byteSize, source.length);
  assert.equal(result.details.image.sent.byteSize, sent.length);
  assert.ok(sent.length <= 20 * 1024 * 1024);
  const metadata = await sharp(sent).metadata();
  assert.equal(metadata.width, 3400);
  assert.equal(metadata.height, 2200);
  assert.equal(metadata.format, 'png');
  assert.deepEqual(await readFile(join(directory, 'page.tiff')), source);
  assert.deepEqual(JSON.parse(result.content[0].text), result.details);
});

test('small images retain exact bytes and oversized noisy images use disclosed JPEG without resizing', async () => {
  const raw = Buffer.alloc(512 * 512 * 3);
  let seed = 12345;
  for (let index = 0; index < raw.length; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    raw[index] = seed >>> 24;
  }
  const image = await sharp(raw, { raw: { width: 512, height: 512, channels: 3 } })
    .png()
    .toBuffer();
  const original = await prepareOcrImage(image);
  assert.deepEqual(original.bytes, image);
  assert.equal(original.preparation.method, 'original');
  const compressed = await prepareOcrImage(image, 500_000);
  assert.equal(compressed.preparation.method, 'jpeg');
  assert.equal(compressed.preparation.lossy, true);
  assert.equal(compressed.preparation.sent.width, 512);
  assert.equal(compressed.preparation.sent.height, 512);
  assert.ok(compressed.bytes.length <= 500_000);
  await assert.rejects(prepareOcrImage(image, 1), { code: 'OCR_IMAGE_BUDGET_EXCEEDED' });
});

test('multi-frame images are retained or rejected as a whole, never reduced to their first frame', async () => {
  const pixels = Buffer.alloc(10 * 20 * 3, 128);
  pixels.fill(255, 10 * 10 * 3);
  const image = await sharp(pixels, {
    raw: { width: 10, height: 20, channels: 3, pageHeight: 10 },
  })
    .gif()
    .toBuffer();
  assert.equal((await sharp(image).metadata()).pages, 2);
  assert.deepEqual((await prepareOcrImage(image)).bytes, image);
  await assert.rejects(prepareOcrImage(image, 1), { code: 'OCR_IMAGE_MULTIFRAME' });
});

test('unsupported codecs pass through below budget and fail clearly when compression is required', async () => {
  const icon = Buffer.from('000001000100', 'hex');
  assert.deepEqual((await prepareOcrImage(icon)).bytes, icon);
  await assert.rejects(prepareOcrImage(icon, 1), { code: 'OCR_IMAGE_PREPARATION_FAILED' });
});

test('APNG animation control prevents conversion even when metadata exposes only the default image', async () => {
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'white' } })
    .png()
    .toBuffer();
  const control = Buffer.alloc(20);
  control.writeUInt32BE(8);
  control.write('acTL', 4);
  control.writeUInt32BE(2, 8);
  control.writeUInt32BE(crc32(control.subarray(4, 16)), 16);
  const image = Buffer.concat([png.subarray(0, 33), control, png.subarray(33)]);
  await assert.rejects(prepareOcrImage(image, 1), { code: 'OCR_IMAGE_MULTIFRAME' });
});

test('transparent images are not flattened to satisfy the output budget', async () => {
  const image = await sharp({
    create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } },
  })
    .png()
    .toBuffer();
  await assert.rejects(prepareOcrImage(image, 1), { code: 'OCR_IMAGE_BUDGET_EXCEEDED' });
});

test('source files above 100 MiB are rejected before reading their contents', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-ocr-source-limit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'large.png');
  await writeFile(path, Buffer.from('89504e470d0a1a0a', 'hex'));
  await truncate(path, 100 * 1024 * 1024 + 1);
  await assert.rejects(readOcrInput(directory, 'large.png'), { code: 'INVALID_INPUT' });
});

test('cancellation terminates the owned preparation worker and preserves the abort reason', async () => {
  const controller = new AbortController();
  const pending = runOcrImageWorker(Buffer.from('89504e470d0a1a0a', 'hex'), controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(runOcrImageWorker(Buffer.alloc(0), controller.signal), { name: 'AbortError' });
});
