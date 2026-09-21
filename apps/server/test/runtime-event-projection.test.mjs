/**
 * @author Codex
 * @description Verifies runtime event projection retains recoverable Plan and auto-retry state.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { RuntimeEventProjection } from '../dist/lib/runtime/event-projection.js';

/**
 * Creates a minimal runtime event source for projection tests.
 *
 * @returns Runtime source and an event publisher.
 */
function createRuntimeSource() {
  let listener;
  return {
    runtime: {
      onEvent(nextListener) {
        listener = nextListener;
        return () => {
          listener = undefined;
        };
      },
    },
    publish(event) {
      listener?.(event);
    },
  };
}

/**
 * Builds one identity-complete Host event for projection tests.
 *
 * @param type Internal runtime event type.
 * @param payload Event payload.
 * @returns Host event carrying stable test identities.
 */
function createEvent(type, payload) {
  return {
    type,
    runtimeId: 'runtime-1',
    epoch: 1,
    workspaceId: 'workspace-1',
    sessionId: 'session-1',
    sequence: 1,
    timestamp: '2026-08-31T00:00:00.000Z',
    payload,
  };
}

test('retains catalog-confirmed Plan availability while a process generation recovers', () => {
  const source = createRuntimeSource();
  const projection = new RuntimeEventProjection(source.runtime);

  projection.setPlanModeAvailable('session-1', true);
  source.publish(createEvent('runtime-state', { state: 'recovering' }));

  assert.equal(projection.isPlanModeAvailable('session-1'), true);
  projection.close();
});

test('reconciles availability from status events and later command catalogs', () => {
  const source = createRuntimeSource();
  const projection = new RuntimeEventProjection(source.runtime);

  source.publish(
    createEvent('extension-ui', { method: 'setStatus', statusKey: 'plan-mode', statusText: 'Plan' })
  );
  assert.equal(projection.isPlanModeAvailable('session-1'), true);

  projection.setPlanModeAvailable('session-1', false);
  assert.equal(projection.isPlanModeAvailable('session-1'), false);
  projection.close();
});

test('retains only validated active auto-retry state until the episode ends', () => {
  const source = createRuntimeSource();
  const projection = new RuntimeEventProjection(source.runtime);

  source.publish(
    createEvent('agent-event', {
      type: 'auto_retry_start',
      attempt: 1,
      maxAttempts: 3,
      delayMs: 2_000,
      errorMessage: '  Provider unavailable.  ',
    })
  );
  assert.deepEqual(projection.getActiveRetry('session-1'), {
    phase: 'waiting',
    attempt: 1,
    maxAttempts: 3,
    delayMs: 2_000,
    errorMessage: 'Provider unavailable.',
    scheduledAt: '2026-08-31T00:00:00.000Z',
  });

  source.publish(
    createEvent('agent-event', {
      type: 'message_start',
      message: { role: 'assistant', content: [] },
    })
  );
  assert.equal(projection.getActiveRetry('session-1')?.phase, 'retrying');

  source.publish(
    createEvent('agent-event', {
      type: 'auto_retry_start',
      attempt: 0,
      maxAttempts: 3,
      delayMs: 2_000,
      errorMessage: 'Invalid attempt.',
    })
  );
  assert.equal(projection.getActiveRetry('session-1')?.attempt, 1);

  source.publish(createEvent('agent-event', { type: 'auto_retry_end', success: true, attempt: 1 }));
  assert.equal(projection.getActiveRetry('session-1'), undefined);
  projection.close();
});

test('runtime recovery clears process-owned auto-retry state', () => {
  const source = createRuntimeSource();
  const projection = new RuntimeEventProjection(source.runtime);

  source.publish(
    createEvent('agent-event', {
      type: 'auto_retry_start',
      attempt: 2,
      maxAttempts: 3,
      delayMs: 4_000,
      errorMessage: 'Provider unavailable.',
    })
  );
  source.publish(createEvent('runtime-state', { state: 'recovering' }));

  assert.equal(projection.getActiveRetry('session-1'), undefined);
  projection.close();
});
