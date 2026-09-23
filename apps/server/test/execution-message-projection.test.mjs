/**
 * @author Codex
 * @description Covers mixed execution prose, multiple tool calls, and text that resembles tool syntax.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { projectExecutionMessage } from '../dist/modules/scheduled-tasks/scheduled-tasks.utils.js';

test('mixed assistant content preserves reply and multiple tool-call boundaries', () => {
  const items = projectExecutionMessage('message', 'assistant', [
    { type: 'thinking', thinking: 'hidden' },
    { type: 'text', text: '再补充两个关键主题。' },
    { type: 'toolCall', name: 'web_search', arguments: { queries: ['今日新闻'] } },
    { type: 'toolCall', name: 'read', arguments: { path: 'report.md' } },
    { type: 'text', text: '检索完成。' },
    { type: 'text', text: '继续整理。' },
  ]);
  assert.deepEqual(
    items.map(({ role }) => role),
    ['assistant', 'toolCall', 'toolCall', 'assistant']
  );
  assert.equal(items[0].text, '再补充两个关键主题。');
  assert.equal(items[1].text, '[web_search]\n{\n  "queries": [\n    "今日新闻"\n  ]\n}');
  assert.equal(items[3].text, '检索完成。\n继续整理。');
  assert.equal(new Set(items.map(({ id }) => id)).size, 4);
});

test('tool-like prose and tool results retain their original roles', () => {
  for (const role of ['assistant', 'toolResult', 'system', 'user']) {
    const text = '[web_search]\n{"queries": []}';
    assert.deepEqual(projectExecutionMessage('m', role, text), [{ id: 'm:0', role, text }]);
  }
  assert.deepEqual(projectExecutionMessage('m', 'assistant', []), []);
});

test('tool-only messages and image placeholders remain visible', () => {
  assert.deepEqual(
    projectExecutionMessage('m', 'assistant', [{ type: 'toolCall', name: 'unknown_tool', arguments: {} }]),
    [{ id: 'm:0', role: 'toolCall', text: '[unknown_tool]\n{}' }]
  );
  assert.equal(
    projectExecutionMessage('r', 'toolResult', [{ type: 'image' }])[0].text,
    '[图片内容保存在执行记录中]'
  );
});
