/**
 * @author Codex
 * @description Owns the device language preference and restores it synchronously before i18next starts.
 */
import { create } from 'zustand';
import { combine, createJSONStorage, persist } from 'zustand/middleware';
import { fallbackLanguage, normalizeLanguage } from '../i18n/config';
import type { SupportedLanguage } from '../i18n/config';
import type { StateStorage } from 'zustand/middleware';

/**
 * Restores the explicit choice ahead of the legacy detector cache and browser language.
 *
 * @param getStorage Supplies synchronous device storage, injectable for reload tests.
 * @param browserLanguage First-visit language when no saved choice exists.
 */
export function createLanguageStore(
  getStorage: () => StateStorage = () => localStorage,
  browserLanguage = typeof navigator === 'undefined' ? fallbackLanguage : navigator.language
) {
  let initialLanguage = normalizeLanguage(browserLanguage);
  try {
    const legacy = getStorage().getItem('i18nextLng');
    if (typeof legacy === 'string' && legacy) {
      initialLanguage = normalizeLanguage(legacy);
    }
  } catch {
    // Browser storage may be unavailable; the in-memory preference still works.
  }
  return create(
    persist(
      combine({ language: initialLanguage }, (set) => ({
        /**
         * Saves a supported language without persisting runtime translation state.
         */
        setLanguage(language: SupportedLanguage): void {
          set({ language });
        },
      })),
      {
        name: 'octopus-language',
        storage: createJSONStorage(getStorage),
        partialize: ({ language }) => ({ language }),
        merge: (persisted, current) => {
          const language =
            persisted && typeof persisted === 'object' && 'language' in persisted
              ? persisted.language
              : undefined;
          return {
            ...current,
            language: language === 'en' || language === 'zh-CN' ? language : current.language,
          };
        },
      }
    )
  );
}

export const useLanguageStore = createLanguageStore();
