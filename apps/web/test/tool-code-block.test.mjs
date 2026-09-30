/**
 * @author Codex
 * @description Verifies safe tool text rendering and bounded syntax work for streaming and large outputs.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Highlight } from '../src/components/Highlight/index.tsx';
import { ToolCodeBlock } from '../src/features/session/ToolRenderers/ToolRendererParts.tsx';

test('tool code surface preserves escaped text in a single bounded scroll viewport', (context) => {
  const previousReact = globalThis.React;
  globalThis.React = React;
  context.after(() => {
    globalThis.React = previousReact;
  });
  const html = renderToStaticMarkup(
    createElement(ToolCodeBlock, {
      language: 'json',
      streaming: true,
      maxHeight: 192,
      children: '{"value": "<script>alert(1)</script>"}\nlast line',
    })
  );
  assert.equal((html.match(/data-slot="scroll-area-viewport"/g) ?? []).length, 1);
  assert.match(html, /--code-block-max-height:192px/);
  assert.match(html, /data-language="json"/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /last line/);
  assert.doesNotMatch(html, /<script|<template/);
});

test('large highlighted input falls back without truncating its source', () => {
  const source = 'x'.repeat(100_001) + '\nEND';
  const html = renderToStaticMarkup(createElement(Highlight, { language: 'json', children: source }));
  assert.ok(html.includes(source));
  assert.doesNotMatch(html, /<template|hljs-/);
});

test('plain logs skip lazy highlighting and preserve whitespace', () => {
  const source = 'first\n  indented\n\tlast';
  const html = renderToStaticMarkup(createElement(Highlight, { children: source }));
  assert.ok(html.includes(source));
  assert.doesNotMatch(html, /<template|hljs-/);
});
