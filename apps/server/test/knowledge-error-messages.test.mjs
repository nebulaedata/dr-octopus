/**
 * @author Codex
 * @description Verifies the knowledge error-message catalog: bilingual coverage, site-variant fidelity, and source-drift detection.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderErrorMessage } from '../dist/infrastructure/i18n/error-catalog.js';
import { ApplicationError } from '../dist/infrastructure/errors/application-error.js';
import { toPublicError } from '../dist/infrastructure/errors/public-error.js';
import {
  knowledgeErrorMessages,
  registerKnowledgeErrorMessages,
} from '../dist/modules/knowledge/knowledge.controller.js';
import { collectThrownMessages } from './error-message-sources.mjs';

registerKnowledgeErrorMessages();

test('every knowledge code ships a bilingual generic variant', () => {
  for (const [code, entry] of Object.entries(knowledgeErrorMessages)) {
    const variants = Array.isArray(entry) ? entry : [entry];
    const generic = variants.filter((variant) => variant.match === undefined);
    assert.equal(generic.length, 1, `${code} must declare exactly one generic variant`);
    assert.ok(generic[0].en.length > 0, `${code} generic needs English text`);
    assert.ok(generic[0]['zh-CN'].length > 0, `${code} generic needs zh-CN text`);
  }
});

test('site variants keep the source message verbatim in zh-CN and exist in source', () => {
  const sourceMessages = collectThrownMessages();
  for (const [code, entry] of Object.entries(knowledgeErrorMessages)) {
    const variants = Array.isArray(entry) ? entry : [entry];
    for (const variant of variants) {
      if (variant.match === undefined) continue;
      assert.equal(
        variant['zh-CN'],
        variant.match,
        `${code} site variant must preserve its source message in zh-CN`
      );
      assert.ok(
        sourceMessages.has(variant.match),
        `${code} site variant match does not exist in source (drift): ${variant.match}`
      );
    }
  }
});

test('knowledge codes render localized messages through the public error projection', () => {
  // Site nuance wins: zh-CN users keep the exact source text, English users get the translation.
  const conflict = new ApplicationError('REVISION_CONFLICT', '集合已修改，请刷新后重试', { statusCode: 409 });
  assert.equal(toPublicError(conflict, 'zh-CN').message, '集合已修改，请刷新后重试');
  assert.equal(toPublicError(conflict, 'en').message, 'The collection changed; refresh and try again.');
  // Unmatched messages of a catalogued code fall back to the generic variant on both locales.
  const stale = new ApplicationError('INVALID_INPUT', '某个尚未收录的输入错误', { statusCode: 400 });
  assert.equal(toPublicError(stale, 'zh-CN').message, '请求参数无效，请检查后重试。');
  assert.equal(toPublicError(stale, 'en').message, 'The request is invalid; check the input and try again.');
  // Direct rendering mirrors the same selection rules.
  assert.equal(renderErrorMessage('NOT_FOUND', undefined, 'zh-CN', '集合已删除'), '集合已删除');
  assert.equal(renderErrorMessage('NOT_FOUND', undefined, 'en', '集合已删除'), 'The collection was deleted.');
});
