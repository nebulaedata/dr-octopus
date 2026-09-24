/**
 * @author Codex
 * @description Verifies language restoration across reloads and precedence over browser detection.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstance } from 'i18next';
import { createI18nOptions } from '../src/i18n/config.ts';
import { createLanguageStore } from '../src/stores/language/index.ts';

/**
 * Models persistent device storage shared by successive page loads.
 */
function storage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}

test('saved Chinese and English choices win over browser language on reload', async () => {
  const device = storage();
  for (const language of ['zh-CN', 'en']) {
    createLanguageStore(() => device, 'en-US')
      .getState()
      .setLanguage(language);
    const reloaded = createLanguageStore(() => device, 'zh-CN');
    assert.equal(reloaded.persist.hasHydrated(), true);
    const i18n = createInstance();
    await i18n.init({ ...createI18nOptions(), lng: reloaded.getState().language });
    assert.equal(i18n.language, language);
    assert.equal(
      i18n.t('settings.language.title', { defaultValue: 'Language' }),
      language === 'en' ? 'Language' : '语言'
    );
    assert.deepEqual(JSON.parse(device.getItem('octopus-language')).state, { language });
  }
});

test('first visit uses browser language and legacy choices migrate with lower priority', () => {
  const device = storage();
  assert.equal(createLanguageStore(() => device, 'zh-TW').getState().language, 'zh-CN');
  device.setItem('i18nextLng', 'zh-CN');
  const store = createLanguageStore(() => device, 'en-US');
  assert.equal(store.getState().language, 'zh-CN');
  store.getState().setLanguage('en');
  assert.equal(createLanguageStore(() => device, 'zh-CN').getState().language, 'en');
});

test('malformed or unsupported stored preferences cannot break startup or replace actions', () => {
  for (const value of ['invalid json', '{"state":{"language":"fr","setLanguage":null},"version":0}']) {
    const device = storage();
    device.setItem('octopus-language', value);
    const store = createLanguageStore(() => device, 'zh-CN');
    assert.equal(store.getState().language, 'zh-CN');
    store.getState().setLanguage('en');
    assert.equal(createLanguageStore(() => device).getState().language, 'en');
  }
});
