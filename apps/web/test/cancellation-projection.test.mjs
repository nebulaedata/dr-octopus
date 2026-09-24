/**
 * @author Codex
 * @description Verifies setup cancellation stays visible and never becomes a historical retry failure.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMessage, projectPersistedTranscript } from '../src/stores/session/utils/normalizer.ts';

test('compatibility preserves the raw reason while suppressing the failure presentation', () => {
  const raw = Object.freeze({
    role: 'assistant',
    stopReason: 'error',
    errorMessage: 'This operation was aborted',
    content: [],
  });
  const projected = normalizeMessage(raw, 'aborted-setup');
  assert.equal(projected.stopReason, 'error');
  assert.equal(projected.interrupted, true);
  assert.equal(projected.errorMessage, undefined);
  assert.equal(raw.errorMessage, 'This operation was aborted');
});

test('history does not collapse cancellation and a genuine failure into one retry episode', () => {
  const projection = projectPersistedTranscript([
    { id: 'u', role: 'user', content: 'hello' },
    { id: 'failure', role: 'assistant', content: [], stopReason: 'error', errorMessage: 'HTTP 503' },
    {
      id: 'cancelled',
      role: 'assistant',
      content: [],
      stopReason: 'error',
      errorMessage: 'This operation was aborted',
    },
  ]);
  const message = projection.messages.find((item) => item.id === 'cancelled');
  assert.equal(message.interrupted, true);
  assert.equal(message.retryId, undefined);
  assert.equal(projection.turns[0].retries?.length ?? 0, 0);
});
