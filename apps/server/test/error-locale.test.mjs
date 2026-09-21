/**
 * @author Codex
 * @description Verifies Accept-Language negotiation, error-catalog rendering, and localized public error projection.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { negotiateLocale } from '../dist/lib/i18n/negotiate-locale.js';
import { registerErrorMessages, renderErrorMessage } from '../dist/lib/i18n/error-catalog.js';
import { ApplicationError } from '../dist/lib/errors/application-error.js';
import { toPublicError } from '../dist/lib/errors/public-error.js';

test('negotiateLocale picks the supported locale with the highest quality weight', () => {
  assert.equal(negotiateLocale(undefined), 'en');
  assert.equal(negotiateLocale(''), 'en');
  assert.equal(negotiateLocale('en-US,en;q=0.9'), 'en');
  assert.equal(negotiateLocale('fr-FR,fr;q=0.8'), 'en');
  assert.equal(negotiateLocale('zh-CN,zh;q=0.9,en;q=0.8'), 'zh-CN');
  assert.equal(negotiateLocale('zh-Hans'), 'zh-CN');
  assert.equal(negotiateLocale('zh-TW'), 'zh-CN');
  assert.equal(negotiateLocale('zh;q=0.4,en;q=0.9'), 'en');
  // Quality ties stay English so the default wins unless Chinese is strictly preferred.
  assert.equal(negotiateLocale('en;q=0.9,zh;q=0.9'), 'en');
  // Rejected and malformed ranges carry no preference.
  assert.equal(negotiateLocale('zh;q=0'), 'en');
  assert.equal(negotiateLocale('zh;q=abc'), 'en');
  // Repeated headers are combined per HTTP semantics.
  assert.equal(negotiateLocale(['zh-CN', 'en;q=0.8']), 'zh-CN');
});

test('renderErrorMessage prefers site variants, then the generic variant, then the fallback', () => {
  registerErrorMessages('test-locale', {
    TEST_GREETING: [
      { en: 'Hello {{name}}', 'zh-CN': '你好，{{name}}' },
      { match: '原始问候', en: 'Site-specific hello', 'zh-CN': '原始问候' },
    ],
    TEST_EN_ONLY: { en: 'English only' },
    TEST_NO_GENERIC: { match: '唯一站点', en: 'Only site', 'zh-CN': '唯一站点' },
  });
  // Site-specific variant wins when its match equals the thrown message.
  assert.equal(renderErrorMessage('TEST_GREETING', undefined, 'en', '原始问候'), 'Site-specific hello');
  assert.equal(renderErrorMessage('TEST_GREETING', undefined, 'zh-CN', '原始问候'), '原始问候');
  // Unmatched messages fall back to the code-level generic variant.
  assert.equal(renderErrorMessage('TEST_GREETING', { name: 'Octo' }, 'en', '别的文案'), 'Hello Octo');
  assert.equal(renderErrorMessage('TEST_GREETING', { name: 'Octo' }, 'zh-CN', '别的文案'), '你好，Octo');
  // A variant without zh-CN text falls back to its English text.
  assert.equal(renderErrorMessage('TEST_EN_ONLY', undefined, 'zh-CN', '别的文案'), 'English only');
  // Params absent from the error leave their placeholders literal for diagnosis.
  assert.equal(renderErrorMessage('TEST_GREETING', undefined, 'en', '别的文案'), 'Hello {{name}}');
  // Without a generic variant, unmatched messages keep the original thrown message.
  assert.equal(renderErrorMessage('TEST_NO_GENERIC', undefined, 'zh-CN', '别的文案'), '别的文案');
  // Unknown codes keep the original thrown message unchanged.
  assert.equal(renderErrorMessage('TEST_UNKNOWN', undefined, 'zh-CN', '原始文案'), '原始文案');
});

test('registerErrorMessages rejects malformed catalogs', () => {
  registerErrorMessages('test-owner-a', { TEST_DUP: { en: 'A' } });
  assert.throws(() => registerErrorMessages('test-owner-b', { TEST_DUP: { en: 'B' } }), /TEST_DUP/);
  // Re-registration by the same domain is idempotent so multi-instance boots stay safe.
  assert.doesNotThrow(() => registerErrorMessages('test-owner-a', { TEST_DUP: { en: 'A' } }));
  assert.throws(() => registerErrorMessages('test-owner-c', { TEST_EMPTY: { en: '' } }), /TEST_EMPTY/);
  assert.throws(
    () =>
      registerErrorMessages('test-owner-d', {
        TEST_TWO_GENERIC: [{ en: 'one' }, { en: 'two' }],
      }),
    /TEST_TWO_GENERIC/
  );
});

test('registerErrorMessages lets other domains contribute site variants to a shared code', () => {
  registerErrorMessages('test-owner-e', {
    TEST_SHARED: { en: 'Shared generic', 'zh-CN': '共享兜底' },
  });
  // A second domain appends site variants without claiming the generic.
  registerErrorMessages('test-owner-f', {
    TEST_SHARED: { match: '站点原文', en: 'Site translation', 'zh-CN': '站点原文' },
  });
  assert.equal(renderErrorMessage('TEST_SHARED', undefined, 'en', '站点原文'), 'Site translation');
  assert.equal(renderErrorMessage('TEST_SHARED', undefined, 'zh-CN', '站点原文'), '站点原文');
  assert.equal(renderErrorMessage('TEST_SHARED', undefined, 'zh-CN', '未收录文案'), '共享兜底');
  // Another domain may not claim a second generic nor re-pin the same site match.
  assert.throws(
    () => registerErrorMessages('test-owner-g', { TEST_SHARED: { en: 'Another generic' } }),
    /TEST_SHARED/
  );
  assert.throws(
    () =>
      registerErrorMessages('test-owner-h', {
        TEST_SHARED: { match: '站点原文', en: 'Conflicting translation' },
      }),
    /TEST_SHARED/
  );
});

test('toPublicError localizes catalogued codes and preserves existing disclosure policy', () => {
  registerErrorMessages('test-projection', {
    TEST_BUSY: [
      { en: 'The resource is busy', 'zh-CN': '资源正忙' },
      { match: '会话正忙', en: 'Session is busy with {{task}} tasks', 'zh-CN': '会话正忙' },
    ],
  });
  const busy = new ApplicationError('TEST_BUSY', '会话正忙', { statusCode: 409, params: { task: 3 } });
  assert.equal(toPublicError(busy, 'zh-CN').message, '会话正忙');
  assert.equal(toPublicError(busy, 'en').message, 'Session is busy with 3 tasks');
  // The default locale is English.
  assert.equal(toPublicError(busy).message, 'Session is busy with 3 tasks');
  // Unmatched messages of a catalogued code use the generic variant.
  const other = new ApplicationError('TEST_BUSY', '其他地方正忙', { statusCode: 409 });
  assert.equal(toPublicError(other, 'zh-CN').message, '资源正忙');
  // Uncatalogued codes keep the original thrown message on either locale.
  const plain = new ApplicationError('TEST_UNCATALOGUED', '原始中文文案', { statusCode: 400 });
  assert.equal(toPublicError(plain, 'en').message, '原始中文文案');
  assert.equal(toPublicError(plain, 'zh-CN').message, '原始中文文案');
  // 5xx details stay masked regardless of locale.
  const boom = new ApplicationError('TEST_BUSY', 'internal detail', { statusCode: 500 });
  assert.equal(toPublicError(boom, 'zh-CN').message, 'The server could not complete the request.');
});
