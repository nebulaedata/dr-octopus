/**
 * @author Codex
 * @description Module-level translation for non-React code (api/lib helpers); React components and hooks keep using useI18n().
 */

import i18n from './index';
import type { Translate } from './use-i18n';

/**
 * Translates outside the React tree with the same `t(key, defaultValue, options?)` contract as
 * the hook adapter, so api/lib modules can localize thrown errors and toasts at their origin
 * without threading `Translate` through every consumer. Before the i18next instance finishes
 * initializing, i18next returns the source `defaultValue` — a safe English fallback.
 *
 * @param key Stable semantic i18n key, never the English copy itself.
 * @param defaultValue Default English copy kept in source as the source of truth.
 * @param options Interpolation values forwarded to i18next.
 * @returns The resolved display string.
 */
export const t: Translate = (key, defaultValue, options) =>
  i18n.t(key, { defaultValue, ...options }) as string;
