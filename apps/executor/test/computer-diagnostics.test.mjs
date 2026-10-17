/**
 * @author Codex
 * @description Verifies desktop diagnostics preserve failure stages and cleanup evidence without logging sensitive tool input or upstream exceptions.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { computerFixture } from './fixtures/computer-backend.mjs';
import { reportComputerFailure } from '../src/runtime/computer/computer-diagnostics.ts';

test('input and cleanup diagnostics contain safe metadata instead of original text and errors', async (t) => {
  const records = [];
  t.mock.method(console, 'warn', (...args) => {
    records.push(args);
  });
  await assert.rejects(
    computerFixture(async ({ tools, state, connection }) => {
      const secret = 'private-input-and-exception-' + randomUUID();
      const taskId = randomUUID();
      tools.startTask(taskId);
      state.cleanupFails = true;
      const original = connection.callTool.bind(connection);
      t.mock.method(connection, 'callTool', async (name, args, options) => {
        if (name === 'Type') {
          throw Error(secret);
        }
        return original(name, args, options);
      });
      await assert.rejects(
        tools.call(taskId, 'computer.type', {
          taskId,
          idempotencyKey: 'failure',
          point: [1, 2],
          text: secret,
        }),
        { code: 'COMPUTER_RESULT_UNKNOWN' }
      );
      assert.equal(tools.executionStopped(), false);
      const data = JSON.stringify(records);
      assert.equal(data.includes(secret), false);
      assert.ok(records.some(([, event]) => event.stage === 'cleanup' && event.cleanupConfirmed === false));
      assert.ok(
        records.some(
          ([, event]) =>
            event.tool === 'computer.type' &&
            event.code === 'COMPUTER_RESULT_UNKNOWN' &&
            event.durationMs >= 0
        )
      );
    }),
    /WINDOWS_MCP_CLEANUP_UNCONFIRMED/
  );
});

test('diagnostic sink failure does not change execution error handling', (t) => {
  t.mock.method(console, 'warn', () => {
    throw Error('sink unavailable');
  });
  assert.doesNotThrow(() =>
    reportComputerFailure({
      stage: 'cleanup',
      code: 'WINDOWS_MCP_CLEANUP_UNCONFIRMED',
      durationMs: 1,
      cleanupConfirmed: false,
    })
  );
});
