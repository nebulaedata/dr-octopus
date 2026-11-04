/**
 * @author Codex
 * @description Verifies recovery budgets, concurrent ticks, user stop, disabled Browser and unresolved Computer state through observable lifecycle calls.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserRuntimeRecovery } from '../src/maintenance/browser-runtime-recovery.ts';

test('recovery preserves user stop, disabled bridge, startup failure and unresolved desktop control', async () => {
  let starts = 0;
  const state = {
    state: 'failed',
    startedAt: new Date().toISOString(),
    startupFailure: null,
    computerUse: { state: 'idle' },
  };
  const recovery = new BrowserRuntimeRecovery({
    readStatus: () => state,
    start: async () => {
      starts++;
    },
  });
  assert.equal(await recovery.recover(false), false);
  state.state = 'stopped';
  assert.equal(await recovery.recover(true), false);
  state.state = 'failed';
  state.computerUse.state = 'unknown';
  assert.equal(await recovery.recover(true), false);
  state.computerUse.state = 'idle';
  state.startupFailure = 'STORAGE_INVALID';
  assert.equal(await recovery.recover(true), false);
  state.startupFailure = null;
  state.startedAt = null;
  assert.equal(await recovery.recover(true), false);
  assert.equal(starts, 0);
});

test('concurrent ticks share the pending restart and repeated crashes exhaust a finite budget', async () => {
  let finish;
  let starts = 0;
  const recovery = new BrowserRuntimeRecovery({
    readStatus: () => ({
      state: 'failed',
      startedAt: new Date().toISOString(),
      startupFailure: null,
      computerUse: { state: 'idle' },
    }),
    start: async () => {
      starts++;
      await new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const first = recovery.recover(true);
  assert.equal(await recovery.recover(true), false);
  finish();
  assert.equal(await first, true);
  const second = recovery.recover(true);
  finish();
  assert.equal(await second, true);
  assert.equal(await recovery.recover(true), false);
  assert.equal(starts, 2);
});
