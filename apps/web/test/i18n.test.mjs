/**
 * @author Claude
 * @description Verifies the shared i18n options: zh-CN overlay wins, missing keys fall back to source defaultValue, plural default forms pick the right English variant, and interpolation flows through.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstance } from 'i18next';
import { createI18nOptions, languageOptions, normalizeLanguage, supportedLanguages } from '../src/i18n/config.ts';

/**
 * Creates an isolated i18next instance with the production-shared options.
 */
async function createI18n(language) {
  const instance = createInstance();
  await instance.init(createI18nOptions());
  await instance.changeLanguage(language);
  return instance;
}

test('every supported language exposes a native endonym for the language switcher', () => {
  assert.deepEqual([...supportedLanguages].sort(), languageOptions.map((option) => option.value).sort());
  assert.ok(languageOptions.every((option) => option.label.length > 0));
});

test('detected browser tags normalize onto a supported language', () => {
  assert.equal(normalizeLanguage('zh'), 'zh-CN');
  assert.equal(normalizeLanguage('zh-Hans'), 'zh-CN');
  assert.equal(normalizeLanguage('zh-TW'), 'zh-CN');
  assert.equal(normalizeLanguage('en-US'), 'en');
  assert.equal(normalizeLanguage('ja-JP'), 'en');
});

test('zh-CN overlay wins when a translation exists', async () => {
  const i18n = await createI18n('zh-CN');
  assert.equal(i18n.t('settings.language.title', { defaultValue: 'Language' }), '语言');
});

test('missing keys fall back to the source defaultValue in any language', async () => {
  const i18n = await createI18n('zh-CN');
  assert.equal(i18n.t('session.new', { defaultValue: 'New session' }), 'New session');
  await i18n.changeLanguage('en');
  assert.equal(i18n.t('session.new', { defaultValue: 'New session' }), 'New session');
});

test('plural defaultValues select the matching English form', async () => {
  const i18n = await createI18n('en');
  const plural = { defaultValue_other: '{{count}} messages' };
  assert.equal(i18n.t('session.messageCount', { defaultValue: '{{count}} message', ...plural, count: 1 }), '1 message');
  assert.equal(i18n.t('session.messageCount', { defaultValue: '{{count}} message', ...plural, count: 5 }), '5 messages');
});

test('zh-CN plural overlay interpolates the count', async () => {
  const i18n = await createI18n('zh-CN');
  i18n.addResourceBundle('zh-CN', 'translation', { session: { messageCount: '{{count}} 条消息' } });
  assert.equal(i18n.t('session.messageCount', { defaultValue: '{{count}} message', count: 3 }), '3 条消息');
});

test('interpolation values flow through the default value', async () => {
  const i18n = await createI18n('zh-CN');
  assert.equal(i18n.t('session.createdAt', { defaultValue: 'Created {{time}}', time: 'yesterday' }), 'Created yesterday');
});
