/**
 * @author Claude
 * @description Initializes the browser i18next instance with language detection and keeps the dayjs locale in sync with the resolved language.
 */

import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import { createI18nOptions, fallbackLanguage, normalizeLanguage } from './config';
import type { SupportedLanguage } from './config';

const dayjsLocales: Record<SupportedLanguage, string> = {
  en: 'en',
  'zh-CN': 'zh-cn',
};

/**
 * Maps the resolved i18n language onto the matching dayjs locale.
 *
 * @param language Active i18next language, e.g. `zh-CN` or a navigator variant like `zh`.
 */
function syncDayjsLocale(language: string): void {
  dayjs.locale(dayjsLocales[normalizeLanguage(language)]);
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    ...createI18nOptions(),
    detection: {
      // Explicit user choice wins; the browser language is only the first-visit guess.
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      convertDetectedLanguage: normalizeLanguage,
    },
    // Keep missing-key logs in development to surface untranslated copy; stay quiet in production.
    debug: import.meta.env.DEV,
  })
  .then(() => syncDayjsLocale(i18n.resolvedLanguage ?? fallbackLanguage));

i18n.on('languageChanged', syncDayjsLocale);

export default i18n;
