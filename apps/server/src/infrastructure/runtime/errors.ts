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
      statusCode: runtimeStatusCode(code),
      ...(cause === undefined ? {} : { cause }),
    });
    this.name = 'SessionRuntimeError';
  }
}

/**
 * Preserves the ordered runtimeStatusCode selection rules.
 */
function runtimeStatusCode(code: SessionRuntimeErrorCode): number {
  if (code === 'SESSION_NOT_FOUND') {
    return 404;
  } else {
    if (code === 'SESSION_RUNTIME_CANCELLED') {
      return 499;
    } else {
      if (code === 'SESSION_RUNTIME_TIMEOUT') {
        return 504;
      } else {
        if (code === 'SESSION_LOOKUP_UNAVAILABLE' || code === 'SESSION_RUNTIME_STALE') {
          return 503;
        } else {
          if (code === 'SESSION_RUNTIME_CAPACITY' || code === 'SESSION_RUNTIME_QUEUE_FULL') {
            return 429;
          } else {
            return 409;
          }
        }
      }
    }
  }
}
