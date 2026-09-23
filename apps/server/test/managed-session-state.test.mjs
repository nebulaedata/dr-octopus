/**
 * @author Codex
 * @description Verifies state queries cannot consume runtime transitions without notifying subscribers.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ManagedSessionRuntime } from '../dist/infrastructure/runtime/managed-session.js';
import { stopSession } from '../dist/infrastructure/runtime/stop-session.js';

test('stop polling publishes idle before a delayed settled event and does not duplicate transitions', async () => {
  let onEvent;
  const events = [];
  const idle = { isStreaming: false, isCompacting: false, pendingMessageCount: 0 };
  const process = {
    getState: () => 'ready',
    onEvent(listener) {
      onEvent = listener;
      return () => {};
    },
    onLifecycle: () => () => {},
    async execute(command) {
      return {
        type: 'response',
        command: command.type,
        success: true,
        ...(command.type === 'get_state' ? { data: idle } : {}),
      };
    },
  };
  const runtime = new ManagedSessionRuntime({
    binding: { runtimeId: 'r', epoch: 1, workspaceId: 'w', sessionId: 's' },
    process,
    state: { ...idle, isStreaming: true },
    manager: {},
    now: Date.now,
    publish: (event) => events.push(event),
  });
  runtime.start();
  try {
    await stopSession(runtime, { readFleet: () => undefined });
    assert.equal(runtime.getBinding().state, 'idle');
    assert.deepEqual(
      events.map((event) => event.payload.state),
      ['running', 'idle']
    );
    onEvent({ type: 'agent_settled' });
    await runtime.execute({ type: 'get_state' });
    assert.deepEqual(
      events.filter((event) => event.type === 'runtime-state').map((event) => event.payload.state),
      ['running', 'idle']
    );
    assert.equal(events.at(-1).payload.type, 'agent_settled');
  } finally {
    runtime.dispose();
  }
});
