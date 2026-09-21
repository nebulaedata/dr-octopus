/**
 * @author Claude
 * @description i18next-cli extraction config: source `t(key, defaultValue)` calls are the source of truth;
 * en.json is a generated artifact (never edited by hand, not loaded at runtime),
 * zh-CN.json and future overlays are synced from it with existing translations preserved.
 */

import { defineConfig } from 'i18next-cli';

export default defineConfig({
  locales: ['en', 'zh-CN'],
  extract: {
    input: ['src/**/*.{ts,tsx}'],
    // Single `translation` namespace: one flat JSON file per language with nested keys.
    output: 'src/i18n/locales/{{language}}.json',
    mergeNamespaces: true,
    // No namespace wrapper key in the generated files.
    defaultNS: false,
    // Only real code is extracted; JSDoc snippets such as `t('key')` must not produce keys.
    extractFromComments: false,
    primaryLanguage: 'en',
    // Missing secondary-language entries stay empty so the runtime falls back
    // to the source defaultValue (returnEmptyString is disabled) and coverage stays measurable.
    defaultValue: '',
    // Keys deleted from source are removed from every locale file.
    removeUnusedKeys: true,
    sort: true,
    // Same key with different default English is a hard error, per the i18n architecture guide.
    warnOnConflicts: 'error',
  },
});
