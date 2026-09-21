/**
 * @author Codex
 * @description Verifies the session error-message catalog: bilingual coverage, site-variant fidelity, and source-drift detection.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ApplicationError } from '../dist/lib/errors/application-error.js';
import { toPublicError } from '../dist/lib/errors/public-error.js';
import { sessionErrorMessages, registerSessionErrorMessages } from '../dist/modules/sessions/sessions.i18n.js';
import { collectThrownMessages } from './error-message-sources.mjs';

registerSessionErrorMessages();

test('every session code ships a bilingual generic variant', () => {
  for (const [code, entry] of Object.entries(sessionErrorMessages)) {
    const variants = Array.isArray(entry) ? entry : [entry];
    const generic = variants.filter((variant) => variant.match === undefined);
    assert.equal(generic.length, 1, `${code} must declare exactly one generic variant`);
    assert.ok(generic[0].en.length > 0, `${code} generic needs English text`);
    assert.ok(generic[0]['zh-CN'].length > 0, `${code} generic needs zh-CN text`);
  }
});

test('site variants keep the source message verbatim in zh-CN and exist in source', () => {
  const sourceMessages = collectThrownMessages();
  for (const [code, entry] of Object.entries(sessionErrorMessages)) {
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

test('session codes render localized messages through the public error projection', () => {
  // Single-site codes render their generic on both locales.
  const busy = new ApplicationError('SESSION_BUSY', '当前任务或交互尚未结束，重启将中断任务。', { statusCode: 409 });
  assert.equal(toPublicError(busy, 'zh-CN').message, '当前任务或交互尚未结束，重启将中断任务。');
  assert.equal(toPublicError(busy, 'en').message, 'A task or interaction is still running; restarting will interrupt it.');
  // Mixed-language codes keep Chinese nuance on site variants while English sites use the generic.
  const gone = new ApplicationError('SESSION_NOT_FOUND', '会话已删除。', { statusCode: 404 });
  assert.equal(toPublicError(gone, 'zh-CN').message, '会话已删除。');
  assert.equal(toPublicError(gone, 'en').message, 'The session was deleted.');
  const missing = new ApplicationError('SESSION_NOT_FOUND', 'Session not found.', { statusCode: 404 });
  assert.equal(toPublicError(missing, 'zh-CN').message, '会话不存在或已删除。');
  assert.equal(toPublicError(missing, 'en').message, 'The session no longer exists.');
});
