/**
 * @author Codex
 * @description Classifies cancellation messages, including narrowly scoped Pi setup-error compatibility.
 */

export interface CancellationMessage {
  stopReason?: unknown;
  errorMessage?: unknown;
}

/**
 * Recognizes cancellation without mutating the original diagnostic or matching arbitrary error substrings.
 *
 * Pi 0.85.1 lazyStream reports a default AbortError from request setup as an ordinary error.
 * This compatibility rule identifies an interrupted operation, not who requested its cancellation.
 */
export function isCancellationMessage(message: CancellationMessage): boolean {
  return (
    message.stopReason === 'aborted' ||
    (message.stopReason === 'error' &&
      typeof message.errorMessage === 'string' &&
      message.errorMessage.trim() === 'This operation was aborted')
  );
}
