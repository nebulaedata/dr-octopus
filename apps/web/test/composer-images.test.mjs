/**
 * @author Codex
 * @description Verifies clipboard image admission, text-paste preservation and transient preview-source projection.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clipboardImageFiles,
  isComposerImageFile,
  isComposerImage,
} from '../src/features/session/utils/composer-images.ts';
import { toComposerAttachment } from '../src/features/session/utils/attachment-projection.ts';

test('image admission recognizes supported browser files without treating text URLs as images', () => {
  const image = new File(['image source'], 'screenshot.png', { type: 'image/png' });
  const document = new File(['notes'], 'notes.txt', { type: 'text/plain' });
  assert.equal(isComposerImageFile(image), true);
  assert.equal(isComposerImageFile({ type: '', name: 'photo.JPEG' }), true);
  assert.equal(isComposerImageFile({ type: 'image/svg+xml', name: 'drawing.svg' }), false);
  assert.equal(isComposerImageFile(document), false);
  const data = {
    items: [
      {
        kind: 'string',
        getAsFile: () => {
          throw new Error('Text must retain native paste handling');
        },
      },
      { kind: 'file', getAsFile: () => image },
      { kind: 'file', getAsFile: () => document },
      { kind: 'file', getAsFile: () => null },
    ],
  };
  assert.deepEqual(clipboardImageFiles(data), [image]);
  assert.deepEqual(clipboardImageFiles({ items: [{ kind: 'string' }] }), []);
});

test('local images remain in the image rail during processing and release their source after readiness', () => {
  const file = new File(['image source'], 'screenshot.png', { type: 'image/png' });
  const resource = {
    id: 'image-id',
    name: file.name,
    byteSize: file.size,
    revision: 3,
    status: 'processing',
    capabilities: {},
  };
  const processing = toComposerAttachment(resource, 'local-image', 'fingerprint', file);
  assert.equal(processing.localImage, file);
  assert.equal(isComposerImage(processing), true);
  const ready = toComposerAttachment(
    { ...resource, status: 'ready', presentationKind: 'image' },
    'local-image',
    'fingerprint',
    file
  );
  assert.equal(ready.localImage, undefined);
  assert.equal(ready.localKey, 'local-image');
  assert.equal(isComposerImage(ready), true);
  assert.equal(isComposerImage({ ...ready, presentationKind: 'file' }), false);
});

test('a restored incomplete image upload explains its missing browser source instead of waiting forever', () => {
  const resource = {
    id: 'image-upload',
    name: 'screenshot.png',
    byteSize: 32,
    revision: 2,
    status: 'uploading',
    declaredMediaType: 'image/png',
  };
  const restored = toComposerAttachment(resource);
  assert.equal(restored.presentationKind, 'image');
  assert.equal(restored.status, 'failed');
  assert.equal(restored.error.code, 'UPLOAD_SOURCE_REQUIRED');
  const active = toComposerAttachment(resource, 'active-local-image');
  assert.equal(active.status, 'uploading');
});
