/**
 * @author Codex
 * @description Verifies the settings error-message catalog: bilingual coverage, site-variant fidelity, and source-drift detection.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ApplicationError } from '../dist/infrastructure/errors/application-error.js';
import { toPublicError } from '../dist/infrastructure/errors/public-error.js';
import {
  settingsErrorMessages,
  registerSettingsErrorMessages,
} from '../dist/modules/model-settings/model-settings.controller.js';
import { collectThrownMessages } from './error-message-sources.mjs';

registerSettingsErrorMessages();

test('every settings code ships a bilingual generic variant', () => {
  for (const [code, entry] of Object.entries(settingsErrorMessages)) {
    const variants = Array.isArray(entry) ? entry : [entry];
    const generic = variants.filter((variant) => variant.match === undefined);
    assert.equal(generic.length, 1, `${code} must declare exactly one generic variant`);
    assert.ok(generic[0].en.length > 0, `${code} generic needs English text`);
    assert.ok(generic[0]['zh-CN'].length > 0, `${code} generic needs zh-CN text`);
  }
});

test('site variants keep the source message verbatim in zh-CN and exist in source', () => {
  const sourceMessages = collectThrownMessages();
  for (const [code, entry] of Object.entries(settingsErrorMessages)) {
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

test('settings codes render localized messages through the public error projection', () => {
  // Permission configuration nuance survives on site variants.
  const symlink = new ApplicationError('PERMISSION_CONFIG_INVALID', '权限配置目录不能是符号链接', {
    statusCode: 400,
  });
  assert.equal(toPublicError(symlink, 'zh-CN').message, '权限配置目录不能是符号链接');
  assert.equal(
    toPublicError(symlink, 'en').message,
    'The permission configuration directory cannot be a symbolic link.'
  );
  // Unmatched messages of a catalogued code use the generic variant.
  const other = new ApplicationError('PERMISSION_CONFIG_INVALID', '某个尚未收录的配置错误', {
    statusCode: 400,
  });
  assert.equal(toPublicError(other, 'zh-CN').message, '权限配置无效。');
  assert.equal(toPublicError(other, 'en').message, 'The permission configuration is invalid.');
  // Single-site codes render their generic on both locales.
  const model = new ApplicationError('LOCAL_MODEL_NOT_FOUND', '所选模型已不可用，请重新检测模型。', {
    statusCode: 404,
  });
  assert.equal(toPublicError(model, 'zh-CN').message, '所选模型已不可用，请重新检测模型。');
  assert.equal(
    toPublicError(model, 'en').message,
    'The selected model is no longer available; detect models again.'
  );
});
