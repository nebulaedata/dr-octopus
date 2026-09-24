/**
 * @author Codex
 * @description Verifies the Memory Assistant bubble wording and tone for every runtime memory observation.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { describeMemoryAssistantState } from '../src/features/session/utils/memory-assistant-status.ts';

/**
 * Renders the source-language default so assertions pin the English copy contract.
 */
const t = (key, defaultValue) => defaultValue;

/**
 * Builds a minimal snapshot matching the shared protocol defaults.
 *
 * @param overrides Partial observation fields to exercise one code path.
 * @returns A complete runtime snapshot for the pure descriptor.
 */
function snapshot(overrides = {}) {
  return {
    version: 1,
    mode: 'auto',
    availability: 'ready',
    revision: 0,
    curator: 'idle',
    ...overrides,
  };
}

test('stands by with a friendly muted label before the runtime reports memory', () => {
  const status = describeMemoryAssistantState(t, undefined);
  assert.equal(status.label, 'Memory assistant');
  assert.equal(status.tone, 'muted');
  assert.equal(status.busy, false);
});

test('marks the curator as busy while organizing memories', () => {
  const status = describeMemoryAssistantState(t, snapshot({ curator: 'running' }));
  assert.equal(status.label, 'Organizing memories');
  assert.equal(status.tone, 'busy');
  assert.equal(status.busy, true);
});

test('warns on unavailable storage and failed curation', () => {
  const unavailable = describeMemoryAssistantState(t, snapshot({ availability: 'unavailable' }));
  assert.equal(unavailable.label, 'Memory unavailable');
  assert.equal(unavailable.tone, 'warning');
  const failed = describeMemoryAssistantState(t, snapshot({ curator: 'failed' }));
  assert.equal(failed.label, 'Memory organization incomplete');
  assert.equal(failed.tone, 'warning');
  assert.equal(failed.busy, false);
});

test('treats a skipped curator like idle so the bubble stays quiet', () => {
  const status = describeMemoryAssistantState(t, snapshot({ curator: 'skipped' }));
  assert.equal(status.label, 'Auto memory');
  assert.equal(status.busy, false);
});

test('mirrors the legacy fall-through for read-only and uninitialized availability', () => {
  const readOnly = describeMemoryAssistantState(t, snapshot({ availability: 'read-only' }));
  assert.equal(readOnly.label, 'Auto memory');
  assert.equal(readOnly.tone, 'active');
  const uninitialized = describeMemoryAssistantState(
    t,
    snapshot({ availability: 'uninitialized', mode: 'manual' })
  );
  assert.equal(uninitialized.label, 'Manual memory');
});

test('distinguishes off, manual, and auto memory modes', () => {
  assert.equal(describeMemoryAssistantState(t, snapshot({ mode: 'off' })).label, 'Memory off');
  assert.equal(describeMemoryAssistantState(t, snapshot({ mode: 'manual' })).label, 'Manual memory');
  assert.equal(describeMemoryAssistantState(t, snapshot({ mode: 'auto' })).label, 'Auto memory');
});

test('a ready idle curator with auto mode stays active, not busy', () => {
  const status = describeMemoryAssistantState(t, snapshot({ curator: 'committed' }));
  assert.equal(status.tone, 'active');
  assert.equal(status.busy, false);
});
