/**
 * @author Codex
 * @description Verifies proxy tool titles, image reading order and fallback preservation.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolveToolRenderer } from './helpers/tool-renderer-selection.mjs';
import { mcpToolLabel } from '../src/features/session/utils/mcp-tool-projection.ts';
import { McpToolRenderer } from '../src/features/session/ToolRenderers/CustomToolRenderers/McpToolRenderer.tsx';
import { FallbackToolRenderer } from '../src/features/session/ToolRenderers/ToolRendererParts.tsx';

test('MCP registration uses the exact remote tool title and tolerates streamed/discovery arguments', () => {
  const renderer = resolveToolRenderer('mcp');
  assert.equal(renderer.component, McpToolRenderer);
  assert.equal(
    renderer.getLabel({ name: 'mcp', arguments: { tool: 'windows-mcp_Snapshot' } }),
    'windows-mcp_Snapshot'
  );
  for (const argumentsValue of [undefined, null, '', [], { tool: '' }, { tool: 1 }, { search: 'windows' }]) {
    assert.equal(mcpToolLabel({ name: 'mcp', arguments: argumentsValue }), undefined);
  }
  assert.equal(resolveToolRenderer('unregistered').component.name, 'FallbackToolRenderer');
});

test('MCP images follow arguments before text output and retain errors and details', (context) => {
  // tsx uses the UI package's classic JSX configuration; Vite supplies its automatic runtime in production.
  const previousReact = globalThis.React;
  globalThis.React = React;
  context.after(() => {
    globalThis.React = previousReact;
  });
  const html = renderToStaticMarkup(
    createElement(McpToolRenderer, {
      tool: {
        name: 'mcp',
        status: 'error',
        arguments: { tool: 'windows-mcp_Snapshot', args: { use_vision: true } },
        content: [
          { type: 'text', text: 'diagnostic-output' },
          { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' },
        ],
        details: { diagnostic: 'details-preserved' },
      },
    })
  );
  assert.ok(html.indexOf('use_vision') < html.indexOf('aria-label="Preview image"'));
  assert.ok(html.indexOf('aria-label="Preview image"') < html.indexOf('diagnostic-output'));
  assert.equal(html.split('diagnostic-output').length - 1, 1);
  assert.ok(html.includes('details-preserved'));
  assert.doesNotMatch(html, /<h4[^>]*>Images<\/h4>/);
  assert.match(html, /data-slot="attachment-title"[^>]*>MCP image /);
  assert.match(html, /<span>PNG<\/span>/);
  assert.match(html, /<span>5 B<\/span>/);
  assert.equal((html.match(/data-slot="collapsible-trigger"/g) ?? []).length, 1);
  assert.match(html, /aria-expanded="false"/);
  const panelStart = html.indexOf('data-slot="collapsible-content"');
  assert.ok(panelStart > html.indexOf('use_vision'));
  assert.ok(panelStart > html.indexOf('diagnostic-output'));
  assert.ok(panelStart < html.indexOf('details-preserved'));
  const panelTag = html.match(/<[^>]*data-slot="collapsible-content"[^>]*>/)?.[0];
  assert.match(panelTag, /hidden=""/);
  const unsupported = renderToStaticMarkup(
    createElement(McpToolRenderer, {
      tool: {
        name: 'mcp',
        content: [{ type: 'image', mimeType: 'image/svg+xml', data: 'unsafe' }],
      },
    })
  );
  assert.ok(!unsupported.includes('data:image/svg+xml'));
  assert.ok(unsupported.includes('Unsupported attachment'));
});

test('only details get a closed disclosure while empty output stays visible', (context) => {
  const previousReact = globalThis.React;
  globalThis.React = React;
  context.after(() => {
    globalThis.React = previousReact;
  });
  for (const Renderer of [McpToolRenderer, FallbackToolRenderer]) {
    for (const details of [undefined, { diagnostic: 'details-only' }]) {
      const html = renderToStaticMarkup(
        createElement(Renderer, {
          tool: { name: 'unknown', status: 'error', content: [], details },
        })
      );
      if (details) {
        assert.equal((html.match(/data-slot="collapsible-trigger"/g) ?? []).length, 1);
        assert.match(html, /aria-expanded="false"/);
        assert.ok(html.indexOf('details-only') > html.indexOf('data-slot="collapsible-content"'));
        assert.doesNotMatch(html, /data-slot="separator"/);
      } else {
        assert.doesNotMatch(html, /data-slot="collapsible-trigger"/);
        assert.match(html, /No output returned\./);
      }
    }
  }
});
