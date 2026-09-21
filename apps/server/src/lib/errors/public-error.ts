/**
 * @author Codex
 * @description Projects internal failures into transport-safe HTTP and WebSocket error contracts.
 */

import { ApplicationError } from './application-error.js';
import { renderErrorMessage } from '../i18n/error-catalog.js';
import { DEFAULT_LOCALE } from '../i18n/negotiate-locale.js';
import type { PublicLocale } from '../i18n/negotiate-locale.js';

export interface PublicError {
  code: string;
  message: string;
  statusCode: number;
  retryable: boolean;
  details?: ApplicationError['details'];
}

/**
 * Centralizes error disclosure policy for every external transport adapter.
 *
 * @param error Internal failure captured by a transport adapter.
 * @param locale Negotiated response locale; catalogued codes render localized messages while
 * unknown codes keep their original thrown message.
 * @returns The transport-safe public error contract.
 */
export function toPublicError(error: unknown, locale: PublicLocale = DEFAULT_LOCALE): PublicError {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'REQUEST_FAILED';
  const statusCode =
    error instanceof ApplicationError
      ? error.statusCode
      : typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number(error.statusCode)
        : 400;
  const safeClientMessage =
    error instanceof Error && statusCode < 500
      ? renderErrorMessage(
          code,
          error instanceof ApplicationError ? error.params : undefined,
          locale,
          error.message
        )
      : 'The server could not complete the request.';
  return {
    ...(error instanceof ApplicationError && error.details ? { details: error.details } : {}),
    code,
    message: safeClientMessage,
    statusCode,
    retryable: error instanceof ApplicationError ? error.retryable : statusCode === 429 || statusCode >= 500,
  };
}
