/**
 * @author Codex
 * @description Verify memory renderer selection, original-output fallback and generation-fenced browser state.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolveToolRenderer } from './helpers/tool-renderer-selection.mjs';
import { customToolLabel } from '../src/features/session/utils/tool-label.ts';
import { MemoryToolRenderer } from '../src/features/session/ToolRenderers/CustomToolRenderers/MemoryToolRenderer.tsx';
import { reduceEvent } from '../src/stores/session/reducers/session-reducer.ts';
import {
  projectMemoryTool,
  summarizeMemoryTool,
} from '../src/features/session/utils/memory-tool-projection.ts';
import { projectPersistedTranscript } from '../src/stores/session/utils/normalizer.ts';
import { normalizeToolResult } from '../src/stores/session/utils/tool-result-projection.ts';

/**
 * Returns the source default with interpolation so assertions pin the English contract.
 * Plural-aware keys always render the English `_other` form under this stub.
 */
const t = (key, defaultValue, options) =>
  defaultValue.replace(/\{\{(\w+)\}\}/g, (_, name) => String(options?.[name] ?? ''));

const memoryEntry = {
  storeId: 'store',
  indexId: 1,
  topic: '沟通偏好',
  type: 'preference',
  indexText: '先给结论，再给理由。',
  revision: 2,
  status: 'active',
};

/**
 * Creates a compact versioned result at the existing ToolProjection boundary.
 */
function memoryTool(action, items, extra = {}) {
  return {
    id: 'tool',
    name: action === 'read' ? 'memory_read' : 'memory_recall',
    status: 'success',
    arguments:
      action === 'read'
        ? { refs: [{ storeId: 'store', indexId: 1 }] }
        : { mode: 'search', query: '回答偏好' },
    content: [{ type: 'text', text: 'original result' }],
    details: { version: 1, action, items, complete: true, ...extra },
  };
}

test('memory presentation uses readable titles without changing other tools', () => {
  assert.equal(customToolLabel(t, 'memory_recall'), 'Recall memory');
  assert.equal(customToolLabel(t, 'memory_read'), 'Read memory');
  assert.equal(customToolLabel(t, 'unknown-memory-tool'), undefined);
  assert.equal(resolveToolRenderer('memory_recall').label, undefined);
  assert.equal(resolveToolRenderer('bash').label, undefined);
});

test('memory entries preserve ordering and distinguish search from complete directory coverage', () => {
  const tool = memoryTool('recall', [memoryEntry, { ...memoryEntry, indexId: 2, type: '__proto__' }]);
  const result = projectMemoryTool(t, tool);
  assert.deepEqual(
    result.items.map((entry) => entry.id),
    ['store:1', 'store:2']
  );
  assert.equal(result.items[0].type, 'Preference');
  assert.equal(result.items[1].type, 'Memory');
  assert.equal(result.query, '回答偏好');
  assert.match(result.notice, /do not represent all memories/u);
  assert.match(summarizeMemoryTool(tool, t), /2 memory leads/u);
  tool.arguments = { mode: 'page' };
  tool.details.exhausted = true;
  assert.equal(projectMemoryTool(t, tool).notice, undefined);
  tool.details.exhausted = false;
  assert.match(projectMemoryTool(t, tool).notice, /more entries to review/u);
});

test('partial reads keep source excerpts and missing references without inventing successful facts', () => {
  const document = { ...memoryEntry, bodyMd: '正文片段', sources: [{ evidence: '用户原文' }] };
  const tool = memoryTool(
    'read',
    [
      { ref: memoryEntry, document },
      { ref: { storeId: 'store', indexId: 2 }, error: 'NOT_FOUND' },
    ],
    { complete: false }
  );
  const result = projectMemoryTool(t, tool);
  assert.equal(result.total, 2);
  assert.equal(result.available, 1);
  assert.equal(result.items[0].body, '正文片段');
  assert.deepEqual(result.items[0].sources, ['用户原文']);
  assert.equal(result.items[1].unavailable, true);
  assert.match(result.notice, /Only part of the body/u);
  // The stub renders the English `_other` plural form even for count=1.
  assert.match(summarizeMemoryTool(tool, t), /^1 memories readable/u);
});

test('empty and unavailable retrieval remain distinct and text-only output never becomes structured evidence', () => {
  const tool = memoryTool('recall', []);
  assert.equal(projectMemoryTool(t, tool).available, 0);
  tool.details.searchUnavailable = true;
  assert.match(projectMemoryTool(t, tool).notice, /Search is temporarily unavailable/u);
  assert.equal(projectMemoryTool(t, { ...tool, details: undefined }), undefined);
  assert.match(summarizeMemoryTool({ ...tool, status: 'running' }, t), /Searching memories/u);
  assert.match(summarizeMemoryTool({ ...tool, status: 'error' }, t), /Request incomplete/u);
});

test('malformed entries retain fallback and excessively large snapshots are explicitly bounded', () => {
  for (const entry of [null, {}, { ...memoryEntry, topic: {} }, { ...memoryEntry, revision: -1 }]) {
    const tool = memoryTool('recall', [entry]);
    assert.equal(projectMemoryTool(t, tool), undefined);
    const html = renderToStaticMarkup(createElement(MemoryToolRenderer, { tool }));
    assert.match(html, /original result/u);
  }
  const tool = memoryTool('read', [
    {
      ref: memoryEntry,
      document: {
        ...memoryEntry,
        bodyMd: 'a'.repeat(17000),
        sources: [{ evidence: 'b'.repeat(900) }],
      },
    },
  ]);
  const item = projectMemoryTool(t, tool).items[0];
  assert.equal(item.body.length, 16000);
  assert.equal(item.sources[0].length, 800);
  assert.equal(item.truncated, true);
  const large = memoryTool(
    'recall',
    Array.from({ length: 25 }, (_, i) => ({ ...memoryEntry, indexId: i + 1 }))
  );
  assert.equal(projectMemoryTool(t, large).items.length, 20);
  assert.equal(projectMemoryTool(t, large).total, 25);
  assert.match(summarizeMemoryTool(large, t), /Showing 20 memory leads/u);
});

test('memory structured display matches the live result and persisted transcript boundaries', () => {
  const tool = memoryTool('recall', [memoryEntry]);
  const result = {
    role: 'toolResult',
    toolCallId: tool.id,
    toolName: tool.name,
    content: tool.content,
    details: tool.details,
  };
  const persisted = projectPersistedTranscript([
    {
      role: 'assistant',
      content: [{ type: 'toolCall', id: tool.id, name: tool.name, arguments: tool.arguments }],
    },
    result,
  ]).tools[0];
  const live = { ...tool, ...normalizeToolResult(result) };
  assert.deepEqual(projectMemoryTool(t, persisted), projectMemoryTool(t, live));
});
test('memory cards preserve errors and unknown result versions', () => {
  assert.equal(resolveToolRenderer('memory_recall').component, MemoryToolRenderer);
  assert.equal(resolveToolRenderer('memory_read').component, MemoryToolRenderer);
  for (const tool of [
    { status: 'error', details: { version: 1, action: 'read', items: [] } },
    { status: 'complete', details: { version: 99, action: 'read', items: [] } },
    { status: 'complete', details: { version: 1, action: 'read', items: null } },
  ]) {
    const html = renderToStaticMarkup(createElement(MemoryToolRenderer, { tool: { ...tool, content: [] } }));
    // The raw fallback never renders the structured memory section.
    assert.doesNotMatch(html, /Raw result/u);
  }
});
test('memory state ignores duplicate, old-generation events and clears on recovery', () => {
  const memory = { version: 1, mode: 'auto', availability: 'ready', revision: 1, curator: 'idle' };
  const state = { runtimeId: 'r', epoch: 2, lastSequence: 4, memory };
  const event = {
    runtimeId: 'r',
    epoch: 2,
    sequence: 5,
    type: 'extension.ui',
    payload: { method: 'setStatus' },
    memory: { ...memory, revision: 2 },
  };
  const next = reduceEvent(state, event);
  assert.equal(next.memory.revision, 2);
  assert.equal(reduceEvent(next, event), next);
  assert.equal(reduceEvent(next, { ...event, epoch: 1, sequence: 6 }), next);
  assert.equal(
    reduceEvent(next, { ...event, sequence: 6, type: 'agent.state', payload: { state: 'recovering' } })
      .memory,
    undefined
  );
});
