/**
 * @author Codex
 * @description Verifies the generic toolbar mounts only registered, visible controls in both presentation modes.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComposerToolbar } from '../src/components/ComposerToolbar.tsx';

test('desktop and mobile share ordering and render the requested presentation mode', () => {
  const items = ['tools', 'model', 'permission', 'send'].map((id) => ({
    id,
    area: id === 'send' ? 'trailing' : 'leading',
    render: (mode) => createElement('button', { 'data-control': id }, `${id}:${mode}`),
  }));
  for (const mode of ['desktop', 'mobile']) {
    const html = renderToStaticMarkup(createElement(ComposerToolbar, { items, mode }));
    assert.match(html, new RegExp(`data-mode="${mode}"`));
    assert.deepEqual(
      [...html.matchAll(/data-control="([^"]+)"/g)].map((match) => match[1]),
      ['tools', 'model', 'permission', 'send']
    );
    for (const item of items) assert.ok(html.includes(`${item.id}:${mode}`));
  }
});

test('hidden controls are not mounted and mode-only controls use the same item configuration', () => {
  const items = [
    {
      id: 'disabled-feature',
      visible: false,
      render: () => {
        throw new Error('An unavailable control must never be mounted');
      },
    },
    { id: 'desktop', modes: ['desktop'], render: () => createElement('span', null, 'Desktop control') },
    { id: 'mobile', modes: ['mobile'], render: () => createElement('span', null, 'Mobile control') },
  ];
  const desktop = renderToStaticMarkup(createElement(ComposerToolbar, { items, mode: 'desktop' }));
  const mobile = renderToStaticMarkup(createElement(ComposerToolbar, { items, mode: 'mobile' }));
  assert.ok(desktop.includes('Desktop control'));
  assert.ok(!desktop.includes('Mobile control'));
  assert.ok(mobile.includes('Mobile control'));
  assert.ok(!mobile.includes('Desktop control'));
});
