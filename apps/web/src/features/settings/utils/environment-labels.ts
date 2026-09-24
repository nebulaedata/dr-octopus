/**
 * @author Codex
 * @description Supplies environment labels and safe, actionable Settings error messages.
 */
import { ApiRequestError } from '@/utils/request';
import type { Translate } from '@/i18n/use-i18n';
import type { EnvironmentEntryDto } from '@octopus/shared/protocol';

type EnvironmentSource = EnvironmentEntryDto['source'];

/**
 * Resolves the localized labels for environment value sources.
 *
 * @param t Project translation function supplied by the calling component.
 * @returns Localized label per source enum value.
 */
export function getEnvironmentSourceLabels(t: Translate): Record<EnvironmentSource, string> {
  return {
    override: t('settings.environment.source.override', 'Launch arguments'),
    process: t('settings.environment.source.process', 'Process env / .env'),
    dotenv: t('settings.environment.source.dotenv', '.env'),
    file: t('settings.environment.source.file', 'File configuration'),
    default: t('settings.environment.source.default', 'Default'),
  };
}

/**
 * Explains conflicts without discarding the editor draft or exposing request contents.
 *
 * @param t Project translation function supplied by the calling component.
 * @param error Failure captured from the environment query or mutation.
 * @returns Safe, actionable user-facing message.
 */
export function environmentErrorMessage(t: Translate, error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === 'ENV_CONFLICT') {
      return t(
        'settings.environment.error.conflict',
        'The configuration was modified in another window. Close the editor, refresh the list, and try again.'
      );
    }
    if (error.code === 'ENV_BUSY') {
      return t(
        'settings.environment.error.busy',
        'Another process is modifying the configuration; try again later.'
      );
    }
    if (error.code === 'ENV_INVALID' || error.code === 'INVALID_ENVIRONMENT_REQUEST') {
      return t(
        'settings.environment.error.invalid',
        'Invalid configuration; check variable names, ports, log levels, and numeric ranges. The launch directory and internal process variables cannot be changed here.'
      );
    }
  }
  return t(
    'settings.environment.error.fallback',
    'Unable to read or save the configuration; check the service connection and configuration file permissions, then try again.'
  );
}
