/**
 * @author Codex
 * @description Negotiates the response locale from an Accept-Language header for public error projection.
 */

/**
 * Locales the Server can project public messages in; English is the default and zh-CN the only overlay.
 */
export type PublicLocale = 'en' | 'zh-CN';

export const DEFAULT_LOCALE: PublicLocale = 'en';

/**
 * Picks the supported locale with the highest quality weight from an Accept-Language header.
 * Any `zh*` range maps to the Simplified Chinese catalog; English wins quality ties so the
 * default stays English unless Chinese is strictly preferred. Wildcards and malformed entries
 * are ignored.
 *
 * @param header Raw Accept-Language header value, possibly undefined or repeated.
 * @returns The negotiated public locale.
 */
export function negotiateLocale(header: string | string[] | undefined): PublicLocale {
  const raw = Array.isArray(header) ? header.join(',') : (header ?? '');
  let zhQuality = 0;
  let enQuality = 0;
  for (const entry of raw.split(',')) {
    const [tag, ...parameters] = entry.trim().split(';');
    const language = tag?.trim().toLowerCase();
    if (!language) {
      continue;
    }
    let quality = 1;
    for (const parameter of parameters) {
      const match = /^\s*q\s*=\s*(.*?)\s*$/.exec(parameter);
      if (match) {
        const parsed = Number.parseFloat(match[1] ?? '');
        quality = Number.isNaN(parsed) ? 0 : Math.min(1, parsed);
      }
    }
    if (!(quality > 0)) {
      continue;
    }
    if (language === 'zh' || language.startsWith('zh-')) {
      zhQuality = Math.max(zhQuality, quality);
    } else if (language === 'en' || language.startsWith('en-')) {
      enQuality = Math.max(enQuality, quality);
    }
  }
  return zhQuality > enQuality ? 'zh-CN' : DEFAULT_LOCALE;
}
