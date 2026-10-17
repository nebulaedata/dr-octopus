/**
 * @author Codex
 * @description Verifies explicit desktop restart coalesces callers and cannot publish a connection after a concurrent stop.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ComputerTools } from '../src/runtime/computer/computer-tools.ts';
import { computerFixture } from './fixtures/computer-backend.mjs';

test('explicit restart merges concurrent requests and a stop retires late startup', async () => {
  await computerFixture(async ({ connection, activity }) => {
    await computerFixture(async ({ connection: next }) => {
      let opens = 0;
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const tools = new ComputerTools(activity, connection, async () => {
        opens++;
        await gate;
        return next;
      });
      await tools.close();
      const first = tools.restart();
      const second = tools.restart();
      assert.equal(first, second);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(opens, 1);
      await tools.close();
      release();
      await assert.rejects(first, { code: 'COMPUTER_UNAVAILABLE' });
      assert.equal(next.isConnected(), false);
      assert.equal(tools.available(), false);
    });
  });
});
