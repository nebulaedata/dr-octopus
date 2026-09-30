/**
 * @author Codex
 * @description Verifies generic timeline list semantics and that compact nodes retain arbitrary interactive children.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Timeline, TimelineItem } from '../src/components/timeline/index.tsx';

test('timeline preserves ordered events, semantic children and density selection', (context) => {
  const previousReact = globalThis.React;
  globalThis.React = React;
  context.after(() => {
    globalThis.React = previousReact;
  });
  const html = renderToStaticMarkup(
    createElement(
      Timeline,
      { 'aria-label': 'Activity' },
      createElement(
        TimelineItem,
        { icon: 'A', density: 'compact' },
        createElement('button', { type: 'button' }, 'First event')
      ),
      createElement(TimelineItem, { icon: 'B' }, 'Second event')
    )
  );
  assert.match(html, /^<ol/);
  assert.equal((html.match(/<li /g) ?? []).length, 2);
  assert.ok(html.indexOf('First event') < html.indexOf('Second event'));
  assert.match(html, /<button type="button">First event<\/button>/);
  assert.match(html, /group-last\/timeline:hidden/);
  assert.match(html, /grid-cols-\[1.25rem_minmax/);
  assert.match(html, /grid-cols-\[1.75rem_minmax/);
});
