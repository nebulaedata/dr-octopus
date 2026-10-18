/**
 * @author Codex
 * @description Verifies image selections render as a compact, independently removable rail without server-side Blob URL allocation.
 */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ImageThumbnailList } from '../src/components/ImageThumbnailList.tsx';

// Shared UI sources use the classic JSX transform in the Node test runner.
const previousReact = globalThis.React;
globalThis.React = React;
after(() => {
  globalThis.React = previousReact;
});

test('image selections have their own preview and remove controls instead of file attachment cards', () => {
  const html = renderToStaticMarkup(
    createElement(ImageThumbnailList, {
      images: [
        { id: 'image-one', name: 'screen.png', src: '/fixture/screen.png', state: 'ready' },
        { id: 'image-two', name: 'photo.jpg', src: '/fixture/photo.jpg', state: 'ready' },
      ],
      onRemove() {},
    })
  );
  assert.match(html, /aria-label="Selected images"/);
  assert.match(html, /aria-label="Preview screen.png"/);
  assert.match(html, /aria-label="Remove screen.png"/);
  assert.match(html, /aria-label="Preview photo.jpg"/);
  assert.equal((html.match(/role="listitem"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /data-slot="attachment-title"/);
});

test('local Blob bytes are not encoded into server-rendered HTML or draft markup', () => {
  const html = renderToStaticMarkup(
    createElement(ImageThumbnailList, {
      images: [
        {
          id: 'local-image',
          name: 'local.png',
          blob: new Blob(['private pixels']),
          state: 'failed',
          error: 'Select the same image again to resume.',
        },
      ],
      onRemove() {},
    })
  );
  assert.doesNotMatch(html, /private pixels|base64,|blob:/);
  assert.match(html, /aria-label="Remove local.png"/);
  assert.match(html, /role="alert"/);
  assert.match(html, /Select the same image again to resume/);
});
