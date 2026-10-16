/**
 * @author Codex
 * @description Verifies exact Host feedback evidence, bounded shutdown and refusal to dispatch input without a painted indicator.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { ComputerIndicatorConfirmation } from '../src/runtime/computer/computer-indicator-confirmation.ts';
import { computerFixture } from './fixtures/computer-backend.mjs';

test('wrong revisions and extra fields never confirm another action; exact positive evidence settles once', async () => {
  const confirmations = new ComputerIndicatorConfirmation();
  let settled = false;
  const wait = confirmations.wait(2).then(() => {
    settled = true;
  });
  assert.equal(
    confirmations.receive({ type: 'computer-indicator-reply', revision: 2, visible: true, forged: true }),
    false
  );
  confirmations.receive({ type: 'computer-indicator-reply', revision: 1, visible: true });
  await Promise.resolve();
  assert.equal(settled, false);
  confirmations.receive({ type: 'computer-indicator-reply', revision: 2, visible: true });
  await wait;
  confirmations.close();
  await assert.rejects(confirmations.wait(3));
});

test('negative evidence, shutdown and timeout reject instead of approving input', async () => {
  const confirmations = new ComputerIndicatorConfirmation();
  const negative = confirmations.wait(1);
  confirmations.receive({ type: 'computer-indicator-reply', revision: 1, visible: false });
  await assert.rejects(negative, /UNAVAILABLE/);
  const shutdown = confirmations.wait(2);
  confirmations.close();
  await assert.rejects(shutdown, /UNAVAILABLE/);
  const timeout = new ComputerIndicatorConfirmation();
  await assert.rejects(timeout.wait(3), /TIMEOUT/);
  timeout.close();
});

test('an unpainted indicator dispatches no input and clears only the undispatched feedback reservation', async () => {
  await computerFixture(
    async ({ tools, state, activity }) => {
      const taskId = randomUUID();
      const observation = await tools.call('owner', taskId, 'computer_observe', { taskId });
      await assert.rejects(
        tools.call('owner', taskId, 'computer_type', {
          taskId,
          observationId: observation.observationId,
          windowId: observation.windowId,
          text: 'fixture',
          idempotencyKey: 'no-indicator',
        }),
        (error) => error.code === 'COMPUTER_INDICATOR_UNAVAILABLE'
      );
      assert.equal(
        state.calls.some((call) => call.name === 'ExecutorInput'),
        false
      );
      assert.equal(activity.snapshot().state, 'idle');
    },
    {
      confirmVisible: async () => {
        throw new Error('not painted');
      },
    }
  );
});
