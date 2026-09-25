/**
 * @author Codex
 * @description Validates durable image receipts and tool selection across live and restored results.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { projectImagegen } from '../src/features/session/utils/imagegen-projection.ts';
import { resolveToolRenderer } from './helpers/tool-renderer-selection.mjs';

const result = {
  version: 1,
  providerId: 'openai',
  modelId: 'image',
  images: [
    {
      path: '/workspace/generated-images/a.png',
      relativePath: 'generated-images/a.png',
      mimeType: 'image/png',
      width: 20,
      height: 30,
    },
  ],
};
test('live and persisted receipts produce the same image projection', () => {
  assert.deepEqual(projectImagegen(result), projectImagegen(JSON.parse(JSON.stringify(result))));
  assert.equal(resolveToolRenderer('image_generate').component.name, 'ImagegenToolRenderer');
});
test('unknown versions, malformed images and unsafe paths retain the generic fallback', () => {
  assert.equal(projectImagegen({ ...result, version: 2 }), undefined);
  assert.equal(projectImagegen({ ...result, images: [] }), undefined);
  for (const path of ['../private.png', '/private.png', 'C:\\private.png', 'a/../../private.png']) {
    assert.equal(
      projectImagegen({ ...result, images: [{ ...result.images[0], relativePath: path }] }),
      undefined
    );
  }
});
