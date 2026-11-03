/**
 * @author Codex
 * @description Verifies prop-driven alert content, semantic variants and accessible opt-in dismissal controls.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Alert } from '../src/components/alert/index.tsx';

test('alert renders prop content in reading order and preserves caller semantics', (context) => {
  const previousReact = globalThis.React;
  globalThis.React = React;
  context.after(() => {
    globalThis.React = previousReact;
  });
  const html = renderToStaticMarkup(
    createElement(Alert, {
      role: 'note',
      'aria-label': 'Notice',
      className: 'mt-3',
      title: 'Heading',
      description: 'Description',
      details: createElement('details', null, createElement('summary', null, 'Diagnostics')),
      action: createElement('a', { href: '#details' }, 'Learn more'),
    })
  );
  assert.match(html, /role="note"/);
  assert.match(html, /aria-label="Notice"/);
  assert.match(html, /data-variant="info"/);
  assert.ok(html.indexOf('Heading') < html.indexOf('Description'));
  assert.ok(html.indexOf('Description') < html.indexOf('Diagnostics'));
  assert.ok(html.indexOf('Diagnostics') < html.indexOf('Learn more'));
  assert.match(html, /href="#details"/);
  assert.match(html, /mt-3/);
  assert.doesNotMatch(html, /<button|allowClose|closeLabel/);
});

test('each variant supports an accessible non-submit close control', (context) => {
  const previousReact = globalThis.React;
  globalThis.React = React;
  context.after(() => {
    globalThis.React = previousReact;
  });
  for (const variant of ['success', 'warning', 'danger', 'info']) {
    const html = renderToStaticMarkup(
      createElement(Alert, {
        variant,
        description: 'Message',
        showIcon: true,
        allowClose: true,
        closeLabel: '关闭提示',
      })
    );
    assert.ok(html.includes(`data-variant="${variant}"`));
    assert.ok(html.includes(`role="${variant === 'danger' ? 'alert' : 'status'}"`));
    assert.match(html, /<button[^>]*type="button"/);
    assert.match(html, /aria-label="关闭提示"/);
    assert.match(html, /data-slot="alert-icon" aria-hidden="true"/);
    assert.doesNotMatch(html, /allowClose|closeLabel|onClose/);
  }
});
