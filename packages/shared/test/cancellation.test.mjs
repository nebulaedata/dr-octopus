/**
 * @author Codex
 * @description Verifies explicit cancellation and the exact Pi setup-error compatibility boundary.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { isCancellationMessage } from '../dist/utils/index.js';

test('recognizes explicit cancellation and the pinned setup diagnostic without modifying input', () => {
  for (const message of [
    { stopReason: 'aborted' },
    { stopReason: 'aborted', errorMessage: 'custom reason' },
    { stopReason: 'error', errorMessage: ' This operation was aborted\n' },
  ]) {
    assert.equal(isCancellationMessage(Object.freeze(message)), true);
  }
});

test('does not infer cancellation from generic substrings, missing status or malformed diagnostics', () => {
  for (const message of [
    {},
    { errorMessage: 'This operation was aborted' },
    { stopReason: 'error', errorMessage: 'Upstream request aborted unexpectedly' },
    { stopReason: 'error', errorMessage: 'This operation was aborted by server' },
    { stopReason: 'error', errorMessage: { name: 'AbortError' } },
    { stopReason: 'stop', errorMessage: 'This operation was aborted' },
  ])
    assert.equal(isCancellationMessage(message), false);
});
