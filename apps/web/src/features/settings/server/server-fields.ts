/**
 * @author Codex
 * @description Defines Server form labels, limits and storage-preserving draft conversion.
 */
import { serverSettingKeys } from '@octopus/shared/protocol';
import type { Translate } from '@/i18n/use-i18n';
import type { ServerSettingKey, ServerSettingsDto } from '@octopus/shared/protocol';

/**
 * Resolves the localized labels for Server setting fields.
 *
 * @param t Project translation function supplied by the calling component.
 * @returns Localized label per Server setting key.
 */
export function getServerFieldLabels(t: Translate): Record<ServerSettingKey, string> {
  return {
    SERVER_HOST: t('settings.server.labels.host', 'Allow access from other devices'),
    SERVER_PORT: t('settings.server.labels.port', 'Service port'),
    SERVER_CORS_ORIGIN: t('settings.server.labels.corsOrigin', 'Allowed extra origins'),
    SERVER_MAX_ACTIVE_RUNTIMES_PER_WORKSPACE: t(
      'settings.server.labels.maxActiveRuntimesPerWorkspace',
      'Max active instances per workspace'
    ),
    SERVER_MAX_ACTIVE_RUNTIMES: t('settings.server.labels.maxActiveRuntimes', 'Global max active instances'),
    SERVER_FILE_LOG_ENABLED: t('settings.server.labels.fileLogEnabled', 'Enable file logging'),
    SERVER_FILE_LOG_LEVEL: t('settings.server.labels.fileLogLevel', 'Log level'),
    SERVER_FILE_LOG_MAX_SIZE_MB: t('settings.server.labels.fileLogMaxSizeMb', 'Max size per file (MB)'),
    SERVER_FILE_LOG_RETENTION_DAYS: t('settings.server.labels.fileLogRetentionDays', 'Retention days'),
    SERVER_FILE_LOG_MAX_FILES: t('settings.server.labels.fileLogMaxFiles', 'Max file count'),
    SERVER_FILE_LOG_MAX_TOTAL_SIZE_MB: t('settings.server.labels.fileLogMaxTotalSizeMb', 'Total log capacity (MB)'),
    SERVER_FILE_LOG_REQUIRED: t('settings.server.labels.fileLogRequired', 'Block startup when logging fails'),
  };
}
export const numericLimits: Partial<Record<ServerSettingKey, [number, number]>> = {
  SERVER_PORT: [1, 65535],
  SERVER_MAX_ACTIVE_RUNTIMES_PER_WORKSPACE: [1, Number.MAX_SAFE_INTEGER],
  SERVER_MAX_ACTIVE_RUNTIMES: [1, Number.MAX_SAFE_INTEGER],
  SERVER_FILE_LOG_MAX_SIZE_MB: [1, 1024],
  SERVER_FILE_LOG_RETENTION_DAYS: [1, 365],
  SERVER_FILE_LOG_MAX_FILES: [2, 1000],
  SERVER_FILE_LOG_MAX_TOTAL_SIZE_MB: [1, 102400],
};
export type ServerDraft = Record<ServerSettingKey, string | null>;
/**
 * Preserves absent keys and raw stored strings until the user edits a field.
 */
export function serverDraft(snapshot: ServerSettingsDto): ServerDraft {
  return Object.fromEntries(
    serverSettingKeys.map((key) => [key, snapshot.fields[key].stored.value])
  ) as ServerDraft;
}
/**
 * Sends only edited keys, retaining the difference between empty strings and inheritance.
 */
export function serverChanges(before: ServerDraft, after: ServerDraft): Partial<ServerDraft> {
  return Object.fromEntries(
    serverSettingKeys
      .filter((key) => before[key] !== after[key])
      .map((key) => [
        key,
        after[key] !== null && numericLimits[key] ? String(Number(after[key])) : after[key],
      ])
  );
}
/**
 * Provides field-level constraints before a configuration transaction is submitted.
 *
 * @param t Project translation function supplied by the calling component.
 * @param key Server setting key being validated.
 * @param value Draft value; null restores inheritance and skips validation.
 * @returns Localized error message, or undefined when valid.
 */
export function validateServerField(
  t: Translate,
  key: ServerSettingKey,
  value: string | null
): string | undefined {
  if (value === null) {
    return;
  }
  if (value.length > 8192 || value.includes('\0')) {
    return t('settings.server.validation.tooLong', 'Value is too long or contains illegal characters.');
  }
  const limits = numericLimits[key];
  if (
    limits &&
    (!/^\d+$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) < limits[0] ||
      Number(value) > limits[1])
  ) {
    return t('settings.server.validation.integerRange', 'Enter an integer between {{min}} and {{max}}.', {
      min: limits[0],
      max: limits[1],
    });
  }
  if (key === 'SERVER_CORS_ORIGIN' && value) {
    try {
      normalizeOrigins(value.split(','));
    } catch {
      return t(
        'settings.server.validation.invalidOrigin',
        'Enter one HTTP(S) origin per line, without paths, credentials, query parameters, or wildcards.'
      );
    }
  }
}
/**
 * Canonicalizes explicit browser origins without converting arbitrary URLs into access grants.
 */
export function normalizeOrigins(rows: string[]): string {
  return [
    ...new Set(
      rows
        .filter((row) => row.trim())
        .map((row) => {
          if (/[?#]/.test(row)) {
            throw new Error('Invalid origin');
          }
          const url = new URL(row.trim());
          if (
            !['http:', 'https:'].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.pathname !== '/' ||
            url.search ||
            url.hash ||
            url.hostname.includes('*')
          ) {
            throw new Error('Invalid origin');
          }
          return url.origin;
        })
    ),
  ].join(',');
}
