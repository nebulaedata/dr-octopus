/**
 * @author Codex
 * @description Verifies bounded OCR recovery, pixel coverage, cancellation, and rejection of partial pages.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { recognizePdfPage } from '../dist/pdf-ocr.js';
import { parseDocument } from '../dist/index.js';
import { scannedPdf } from './fixtures/scan-pdf.mjs';

/**
 * Reproduce the provider's truncation contract without a live model dependency.
 */
function incomplete() {
  return Object.assign(new Error('Truncated OCR'), { code: 'OCR_INCOMPLETE' });
}

test('complete OCR uses one request and preserves the original canvas', async () => {
  const canvas = createCanvas(400, 600);
  let calls = 0;
  assert.equal(
    await recognizePdfPage(canvas, async () => {
      calls++;
      return 'Complete page';
    }),
    'Complete page'
  );
  assert.equal(calls, 1);
  assert.equal(canvas.width, 400);
  assert.equal(canvas.height, 600);
});

test('regional recovery covers both page edges with overlap and preserves reading order', async () => {
  for (const [width, height] of [
    [400, 600],
    [600, 400],
  ]) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    context.fillStyle = 'red';
    context.fillRect(0, 0, width, height);
    context.fillStyle = 'blue';
    context.fillRect(width > height ? 300 : 0, width > height ? 0 : 300, width, height);
    let calls = 0;
    const text = await recognizePdfPage(canvas, async (png) => {
      calls++;
      if (calls === 1) {
        throw incomplete();
      }
      const image = await loadImage(png);
      assert.equal(width > height ? image.width : image.height, 324);
      const region = createCanvas(image.width, image.height);
      const pixels = region.getContext('2d');
      pixels.drawImage(image, 0, 0);
      assert.deepEqual([...pixels.getImageData(0, 0, 1, 1).data], [255, 0, 0, 255]);
      assert.deepEqual(
        [...pixels.getImageData(image.width - 1, image.height - 1, 1, 1).data],
        [0, 0, 255, 255]
      );
      return calls === 2 ? 'First region' : 'Second region';
    });
    assert.equal(text, 'First region\nSecond region');
    assert.equal(calls, 3);
  }
});

test('two split levels bound recovery and no successful region masks an incomplete sibling', async () => {
  let calls = 0;
  const text = await recognizePdfPage(createCanvas(600, 800), async (png) => {
    calls++;
    const image = await loadImage(png);
    if (image.width > 400 || image.height > 500) {
      throw incomplete();
    }
    return 'Recognized region';
  });
  assert.equal(calls, 7);
  assert.equal(text.split('\n').length, 4);
  calls = 0;
  await assert.rejects(
    recognizePdfPage(createCanvas(600, 800), async () => {
      calls++;
      if (calls === 2) {
        return 'Only the first half';
      }
      throw incomplete();
    }),
    { code: 'OCR_INCOMPLETE' }
  );
  assert.equal(calls, 4);
});

test('unrelated errors and cancellation do not trigger regional model requests', async () => {
  let calls = 0;
  await assert.rejects(
    recognizePdfPage(createCanvas(400, 600), async () => {
      calls++;
      throw Object.assign(new Error('Unavailable'), { code: 'MODEL_UNAVAILABLE' });
    }),
    { code: 'MODEL_UNAVAILABLE' }
  );
  assert.equal(calls, 1);
  const controller = new AbortController();
  const reason = new Error('Cancelled');
  await assert.rejects(
    recognizePdfPage(
      createCanvas(400, 600),
      async () => {
        controller.abort(reason);
        throw incomplete();
      },
      controller.signal
    ),
    (error) => error === reason
  );
});

test('PDF parsing publishes recovered OCR as one section with the original page locator', async () => {
  let calls = 0;
  const sections = await parseDocument(scannedPdf(), 'pdf', {
    ocrMode: 'auto',
    async recognizePage() {
      calls++;
      if (calls === 1) {
        throw incomplete();
      }
      return calls === 2 ? 'Upper content' : 'Lower content';
    },
  });
  assert.equal(sections.length, 1);
  assert.equal(sections[0].text, 'Upper content\nLower content');
  assert.equal(sections[0].locator.page, 1);
  assert.equal(sections[0].extractionMethod, 'ocr');
});
