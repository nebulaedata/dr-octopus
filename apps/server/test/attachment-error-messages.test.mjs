/**
 * @author Codex
 * @description Verifies the attachment error-message catalog: bilingual coverage, site-variant fidelity, and source-drift detection.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ApplicationError } from '../dist/infrastructure/errors/application-error.js';
import { toPublicError } from '../dist/infrastructure/errors/public-error.js';
import {
  attachmentErrorMessages,
  registerAttachmentErrorMessages,
} from '../dist/modules/attachments/attachments.controller.js';
import { collectThrownMessages } from './error-message-sources.mjs';

registerAttachmentErrorMessages();

test('every attachment code ships a bilingual generic variant', () => {
  for (const [code, entry] of Object.entries(attachmentErrorMessages)) {
    const variants = Array.isArray(entry) ? entry : [entry];
    const generic = variants.filter((variant) => variant.match === undefined);
    assert.equal(generic.length, 1, `${code} must declare exactly one generic variant`);
    assert.ok(generic[0].en.length > 0, `${code} generic needs English text`);
    assert.ok(generic[0]['zh-CN'].length > 0, `${code} generic needs zh-CN text`);
  }
});

test('site variants keep the source message verbatim in zh-CN and exist in source', () => {
  const sourceMessages = collectThrownMessages();
  for (const [code, entry] of Object.entries(attachmentErrorMessages)) {
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

test('attachment codes render localized messages through the public error projection', () => {
  // Chinese sites keep their nuance on site variants.
  const content = new ApplicationError('ATTACHMENT_NOT_FOUND', '附件原文不可用', { statusCode: 404 });
  assert.equal(toPublicError(content, 'zh-CN').message, '附件原文不可用');
  assert.equal(toPublicError(content, 'en').message, 'The attachment content is unavailable.');
  // English sites and unmatched messages fall back to the bilingual generic.
  const upload = new ApplicationError('ATTACHMENT_NOT_FOUND', 'Upload was not found.', { statusCode: 404 });
  assert.equal(toPublicError(upload, 'zh-CN').message, '附件不存在或已被删除。');
  assert.equal(toPublicError(upload, 'en').message, 'The attachment was not found.');
  const pending = new ApplicationError('ATTACHMENT_NOT_READY', '附件原文尚未准备好', { statusCode: 409 });
  assert.equal(toPublicError(pending, 'zh-CN').message, '附件原文尚未准备好');
  assert.equal(toPublicError(pending, 'en').message, 'The attachment content is not ready yet.');
});
