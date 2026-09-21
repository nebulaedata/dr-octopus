/**
 * @author Codex
 * @description Maps managed Session runtime invariants onto stable application failure metadata.
 */

import { ApplicationError } from '../errors/application-error.js';
import type { SessionRuntimeErrorCode } from './types.js';

export class SessionRuntimeError extends ApplicationError {
  /**
   * @param code Stable Session failure code
   * @param message Diagnostic message safe for non-server failure classes
   * @param cause Optional lower-level failure
   */
  public constructor(code: SessionRuntimeErrorCode, message: string, cause?: unknown) {
    super(code, message, {
      statusCode:
        code === 'SESSION_NOT_FOUND'
          ? 404
          : code === 'SESSION_RUNTIME_CANCELLED'
            ? 499
            : code === 'SESSION_RUNTIME_TIMEOUT'
              ? 504
              : code === 'SESSION_LOOKUP_UNAVAILABLE' || code === 'SESSION_RUNTIME_STALE'
                ? 503
                : code === 'SESSION_RUNTIME_CAPACITY' || code === 'SESSION_RUNTIME_QUEUE_FULL'
                  ? 429
                  : 409,
      ...(cause === undefined ? {} : { cause }),
    });
    this.name = 'SessionRuntimeError';
  }
}
