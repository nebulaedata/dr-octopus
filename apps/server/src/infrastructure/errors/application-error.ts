/**
 * @author Codex
 * @description Defines transport-independent application failures that can be projected safely at external adapters.
 */

import type { ErrorMessageParams } from '../i18n/error-catalog.js';

export interface ApplicationErrorOptions {
  statusCode: number;
  retryable?: boolean;
  cause?: unknown;
  details?: { revision?: string; host?: string; fields?: { field: string; message: string }[] };
  params?: ErrorMessageParams;
}

/**
 * Carries stable public failure metadata without coupling transport projection to business Modules.
 */
export class ApplicationError extends Error {
  public readonly statusCode: number;
  public readonly retryable: boolean;
  public readonly details: ApplicationErrorOptions['details'];
  public readonly params: ApplicationErrorOptions['params'];

  /**
   * @param code Stable machine-readable failure code
   * @param message Safe diagnostic message for non-server failures
   * @param options Transport-independent projection metadata; `params` feeds localized catalog templates
   */
  public constructor(
    public readonly code: string,
    message: string,
    options: ApplicationErrorOptions
  ) {
    super(message, { cause: options.cause });
    this.name = 'ApplicationError';
    this.statusCode = options.statusCode;
    this.retryable = options.retryable ?? (options.statusCode === 429 || options.statusCode >= 500);
    this.details = options.details;
    this.params = options.params;
  }
}
