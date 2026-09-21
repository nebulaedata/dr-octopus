/**
 * @author Claude
 * @description Exposes the project-wide translation API so business code never depends on react-i18next calling conventions directly.
 */

import { useTranslation } from 'react-i18next';
import type { TOptions } from 'i18next';

/**
 * Project translation function shape: the required `defaultValue` keeps default English copy in source.
 * Pure helper modules accept this type instead of calling hooks.
 */
export type Translate = (key: string, defaultValue: string, options?: TOptions) => string;

/**
 * Returns the stable project translation API.
 *
 * The required `defaultValue` keeps the default English copy visible in source;
 * the TypeScript signature is the first guard against bare single-argument calls.
 * Reference stability is owned by the React Compiler, so no manual memoization here.
 *
 * @returns `t(key, defaultValue, options?)` plus the underlying i18next instance for language switching.
 */
export function useI18n() {
  const { t: translate, i18n } = useTranslation();

  /**
   * Translates `key`, overlaying the active locale, then English, then the source `defaultValue`.
   *
   * @param key Stable semantic i18n key, never the English copy itself.
   * @param defaultValue Default English copy kept in source as the source of truth.
   * @param options Interpolation values and plural forms such as `defaultValue_other`.
   * @returns The resolved display string.
   */
  function t(key: string, defaultValue: string, options?: TOptions): string {
    // Narrow the i18next union return at the adapter boundary: without `returnObjects`
    // the runtime value is always a string, so business code never sees the wider type.
    return translate(key, { defaultValue, ...options }) as string;
  }

  return { t, i18n };
}
