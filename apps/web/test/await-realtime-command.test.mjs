/**
 * @author Codex
 * @description Verifies command confirmation correlation and observer cleanup for all terminal outcomes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { awaitRealtimeCommand } from '../src/utils/await-realtime-command.ts';

/**
 * Supplies a deterministic observable transport without browser globals.
 */
function fixture() {
  const messages = new Set();
  const states = new Set();
  let state = 'connected';
  return {
    client: {
      onMessage(fn) {
        messages.add(fn);
        return () => messages.delete(fn);
      },
      subscribeState(fn) {
        states.add(fn);
        return () => states.delete(fn);
      },
      getState: () => state,
    },
    emit(message) {
      for (const fn of messages) fn(message);
    },
    disconnect() {
      state = 'offline';
      for (const fn of states) fn();
    },
    assertClean() {
      assert.equal(messages.size, 0);
      assert.equal(states.size, 0);
    },
  };
}

test('only the matching acknowledgement completes the command, including immediate replies', async () => {
  const f = fixture();
  await awaitRealtimeCommand(f.client, 'stop', () => {
    f.emit({ type: 'command.ack', requestId: 'other' });
    f.emit({ type: 'command.ack', requestId: 'stop' });
  });
  f.assertClean();
});

for (const outcome of ['error', 'disconnect', 'timeout', 'throw']) {
  test(`releases command observers after ${outcome} and permits retry`, async () => {
    const f = fixture();
    const pending = awaitRealtimeCommand(
      f.client,
      'stop',
      () => {
        if (outcome === 'error') f.emit({ type: 'error', requestId: 'stop', message: 'Stop rejected' });
        if (outcome === 'disconnect') f.disconnect();
        if (outcome === 'throw') throw new Error('Send failed');
      },
      5
    );
    await assert.rejects(pending, /rejected|Connection lost|timed out|Send failed/);
    f.assertClean();
    await awaitRealtimeCommand(f.client, 'retry', () => f.emit({ type: 'command.ack', requestId: 'retry' }));
    f.assertClean();
  });
}
