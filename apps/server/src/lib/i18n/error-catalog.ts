/**
 * @author Codex
 * @description Resolves localized public error messages from per-domain catalogs keyed by stable error code.
 */

import type { PublicLocale } from './negotiate-locale.js';

/**
 * Interpolation variables carried by one thrown error, consumed by catalog templates.
 */
export type ErrorMessageParams = Record<string, string | number>;

/**
 * One localized message variant for an error code. `match` pins the variant to an exact source
 * (thrown) message so site-specific nuance survives translation; the variant without `match`
 * acts as the code-level generic backstop.
 */
export interface ErrorMessageVariant {
  match?: string;
  en: string;
  'zh-CN'?: string;
}

/**
 * Message variants per error code; a single variant may be written without the array wrapper.
 */
export type ErrorMessageCatalog = Record<string, ErrorMessageVariant | ErrorMessageVariant[]>;

interface CatalogRecord {
  genericDomain?: string;
  variants: ErrorMessageVariant[];
}

const mergedCatalog = new Map<string, CatalogRecord>();
const matchOwners = new Map<string, string>();

/**
 * Merges one domain's message variants into the shared catalog. Codes may be shared across
 * domains: the domain that introduced a code declares its single generic variant, and other
 * domains contribute site variants for their own thrown messages. Re-registering variants the
 * same domain already registered is a no-op, so tests and multi-instance boots can compose the
 * Server more than once per process.
 *
 * @param domain Owning module name used in duplicate diagnostics.
 * @param catalog Variants keyed by error code; one batch declares at most one generic (matchless)
 * variant per code.
 * @throws When a batch declares a second generic for a code another domain already owns, pins a
 * site match another domain already registered, omits English text, or declares two generics.
 */
export function registerErrorMessages(domain: string, catalog: ErrorMessageCatalog): void {
  for (const [code, entry] of Object.entries(catalog)) {
    const variants = (Array.isArray(entry) ? entry : [entry]).map((variant) => ({ ...variant }));
    if (variants.some((variant) => typeof variant.en !== 'string' || variant.en.length === 0)) {
      throw new Error(`Error message variants for code ${code} (${domain}) must provide English text.`);
    }
    if (variants.filter((variant) => variant.match === undefined).length > 1) {
      throw new Error(`Error code ${code} (${domain}) declares more than one generic message variant.`);
    }
    let record = mergedCatalog.get(code);
    if (record === undefined) {
      record = { variants: [] };
      mergedCatalog.set(code, record);
    }
    for (const variant of variants) {
      if (variant.match === undefined) {
        if (record.genericDomain !== undefined) {
          if (record.genericDomain === domain) {
            continue;
          }
          throw new Error(
            `Error code ${code} already has a generic message registered by ${record.genericDomain}.`
          );
        }
        record.genericDomain = domain;
        record.variants.push(variant);
        continue;
      }
      const ownerKey = `${code}:${variant.match}`;
      const owner = matchOwners.get(ownerKey);
      if (owner !== undefined) {
        if (owner === domain) {
          continue;
        }
        throw new Error(
          `Error message match for code ${code} is already registered by ${owner}: ${variant.match}`
        );
      }
      matchOwners.set(ownerKey, domain);
      record.variants.push(variant);
    }
  }
}

/**
 * Renders the localized message for one error code. Site-specific variants win when their `match`
 * equals the thrown message; otherwise the code-level generic variant applies. Unknown codes and
 * unmatched codes without a generic variant keep the original thrown message, so catalogs fill in
 * incrementally without changing current behavior. `{{name}}` placeholders interpolate with the
 * supplied params and stay literal when a param is absent.
 *
 * @param code Stable machine-readable error code.
 * @param params Interpolation variables carried by the thrown error, if any.
 * @param locale Negotiated response locale; falls back to English text when a variant lacks it.
 * @param fallback Original thrown message used for variant matching and as the last resort.
 * @returns The localized user-facing message.
 */
export function renderErrorMessage(
  code: string,
  params: ErrorMessageParams | undefined,
  locale: PublicLocale,
  fallback: string
): string {
  const record = mergedCatalog.get(code);
  if (record === undefined) {
    return fallback;
  }
  const variant =
    record.variants.find((candidate) => candidate.match === fallback) ??
    record.variants.find((candidate) => candidate.match === undefined);
  if (variant === undefined) {
    return fallback;
  }
  const template = variant[locale] ?? variant.en;
  return template.replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) =>
    params !== undefined && name in params ? String(params[name]) : placeholder
  );
}
