/**
 * @author Claude
 * @description Declares the shared i18n languages, translation resources, and init options without touching browser APIs, so both the Vite client and Node tests can consume them.
 */

import zhCN from './locales/zh-CN.json';
import type { InitOptions } from 'i18next';

/**
 * Languages with a maintained translation overlay; English copy lives in source `defaultValue`s only.
 */
export const supportedLanguages = ['en', 'zh-CN'] as const;

export type SupportedLanguage = (typeof supportedLanguages)[number];

/**
 * Final fallback when neither the active locale nor English resources contain a key.
 */
export const fallbackLanguage: SupportedLanguage = 'en';

/**
 * Maps any detected or requested tag onto a supported language; every Chinese variant lands on `zh-CN`.
 * Applied in the detector's `convertDetectedLanguage`, because `nonExplicitSupportedLngs`
 * currently breaks key lookup when combined with `supportedLngs` (i18next v26).
 *
 * @param language Raw BCP-47 tag such as `zh`, `zh-Hans`, or `en-US`.
 * @returns The supported language to activate.
 */
export function normalizeLanguage(language: string): SupportedLanguage {
  return language.toLowerCase().startsWith('zh') ? 'zh-CN' : fallbackLanguage;
}

/**
 * Native endonyms shown in the language switcher; they stay identical across locales by convention.
 */
export const languageOptions: { value: SupportedLanguage; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '简体中文' },
];

/**
 * Builds the i18next options shared by the browser entrypoint and tests.
 * English intentionally registers no resources: missing keys resolve to the
 * source-defined `defaultValue` after the `zh-CN` overlay and English fallback miss.
 *
 * @returns Fresh InitOptions; callers may spread and extend before `init`.
 */
export function createI18nOptions(): InitOptions {
  return {
    lng: fallbackLanguage,
    fallbackLng: fallbackLanguage,
    supportedLngs: [...supportedLanguages],
    resources: {
      'zh-CN': {
        translation: zhCN,
      },
    },
    interpolation: {
      escapeValue: false,
    },
    returnNull: false,
    returnEmptyString: false,
  };
}
