/**
 * @author Codex
 * @description Verifies the memory error-message catalog: bilingual coverage for owned codes, shared-code backstops, and source-drift detection.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderErrorMessage } from '../dist/lib/i18n/error-catalog.js';
import { ApplicationError } from '../dist/lib/errors/application-error.js';
import { toPublicError } from '../dist/lib/errors/public-error.js';
import { registerKnowledgeErrorMessages } from '../dist/modules/knowledge/knowledge.i18n.js';
import { memoryErrorMessages, registerMemoryErrorMessages } from '../dist/modules/memory/memory.i18n.js';
import { collectThrownMessages } from './error-message-sources.mjs';

// Shared codes (CANCELLED, INVALID_INPUT, NOT_FOUND, REVISION_CONFLICT) draw their generic
// variants from the knowledge catalog, so both domains register here as at Server boot.
registerKnowledgeErrorMessages();
registerMemoryErrorMessages();

test('memory-owned codes ship a bilingual generic variant', () => {
  for (const [code, entry] of Object.entries(memoryErrorMessages)) {
    const variants = Array.isArray(entry) ? entry : [entry];
    const generic = variants.filter((variant) => variant.match === undefined);
    if (generic.length === 0) continue; // shared code: generic owned by another domain
    assert.equal(generic.length, 1, `${code} must declare at most one generic variant`);
    assert.ok(generic[0].en.length > 0, `${code} generic needs English text`);
    assert.ok(generic[0]['zh-CN'].length > 0, `${code} generic needs zh-CN text`);
  }
});

test('shared codes used by memory fall back to another domain’s generic variant', () => {
  for (const code of ['CANCELLED', 'INVALID_INPUT', 'NOT_FOUND', 'REVISION_CONFLICT']) {
    const bogus = `___uncovered-${code}___`;
    assert.notEqual(renderErrorMessage(code, undefined, 'en', bogus), bogus, `${code} needs an English generic`);
    assert.notEqual(renderErrorMessage(code, undefined, 'zh-CN', bogus), bogus, `${code} needs a zh-CN generic`);
  }
});

test('site variants keep the source message verbatim in zh-CN and exist in source', () => {
  const sourceMessages = collectThrownMessages();
  for (const [code, entry] of Object.entries(memoryErrorMessages)) {
    const variants = Array.isArray(entry) ? entry : [entry];
    for (const variant of variants) {
      if (variant.match === undefined) continue;
      assert.equal(variant['zh-CN'], variant.match, `${code} site variant must preserve its source message in zh-CN`);
      assert.ok(
        sourceMessages.has(variant.match),
        `${code} site variant match does not exist in source (drift): ${variant.match}`
      );
    }
  }
});

test('memory codes render localized messages through the public error projection', () => {
  // Site nuance wins: zh-CN users keep the exact source text, English users get the translation.
  const conflict = new ApplicationError('REVISION_CONFLICT', '记忆已更新，请刷新后重试。', { statusCode: 409 });
  assert.equal(toPublicError(conflict, 'zh-CN').message, '记忆已更新，请刷新后重试。');
  assert.equal(toPublicError(conflict, 'en').message, 'The memory changed; refresh and try again.');
  // Memory-owned codes localize through their own generic variants (sub-500 status; 5xx stays masked).
  const store = new ApplicationError('STORE_UNAVAILABLE', '某个尚未收录的存储错误', { statusCode: 400 });
  assert.equal(toPublicError(store, 'zh-CN').message, '记忆存储暂不可用，请稍后重试。');
  assert.equal(toPublicError(store, 'en').message, 'Memory storage is temporarily unavailable; try again later.');
  // Direct rendering mirrors the same selection rules.
  assert.equal(renderErrorMessage('NOT_FOUND', undefined, 'zh-CN', '记忆已删除。'), '记忆已删除。');
  assert.equal(renderErrorMessage('NOT_FOUND', undefined, 'en', '记忆已删除。'), 'The memory was deleted.');
});
