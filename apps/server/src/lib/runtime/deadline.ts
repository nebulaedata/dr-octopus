/**
 * @author Codex
 * @description Applies request cancellation and absolute deadlines without cancelling shared Runtime work.
 */

import { SessionRuntimeError } from './errors.js';
import type { SessionRuntimeRequestOptions } from './types.js';

/**
 * Waits for work while bounding only the current caller's interest in the result.
 *
 * @param work Shared or caller-owned asynchronous work.
 * @param options Optional caller cancellation and absolute deadline.
 * @param defaultTimeoutMs Default relative timeout when no earlier deadline is supplied.
 * @param now Clock used to evaluate an absolute deadline.
 * @param label Diagnostic operation label.
 * @returns The work result when it settles before cancellation or timeout.
 */
export async function waitForRuntime<T>(
  work: Promise<T>,
  options: SessionRuntimeRequestOptions,
  defaultTimeoutMs: number,
  now: () => number,
  label: string
): Promise<T> {
  if (options.signal?.aborted) {
    throw cancelled(label);
  }
  const deadlineTimeout = options.deadlineAt === undefined ? defaultTimeoutMs : options.deadlineAt - now();
  const timeoutMs = Math.min(defaultTimeoutMs, deadlineTimeout);
  if (timeoutMs <= 0) {
    throw timedOut(label);
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = (): void => finish(() => reject(cancelled(label)));
    const timeout = setTimeout(() => finish(() => reject(timedOut(label))), timeoutMs);
    timeout.unref?.();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    void work.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) =>
        finish(() =>
          reject(error instanceof Error ? error : new Error('Session runtime work failed.', { cause: error }))
        )
    );
  });
}

/**
 * Creates the stable cancellation error exposed by the Runtime boundary.
 */
function cancelled(label: string): SessionRuntimeError {
  return new SessionRuntimeError('SESSION_RUNTIME_CANCELLED', `Session runtime ${label} was cancelled.`);
}

/**
 * Creates the stable deadline error exposed by the Runtime boundary.
 */
function timedOut(label: string): SessionRuntimeError {
  return new SessionRuntimeError(
    'SESSION_RUNTIME_TIMEOUT',
    `Session runtime ${label} exceeded its deadline.`
  );
}
