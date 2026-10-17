/**
 * @author Codex
 * @description Verifies exact desktop result contracts retain images and distinguish retained summaries without trusting casts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { computerCallResultSchema } from '../src/runtime/computer/computer-results.ts';
import { computerFixture } from './fixtures/computer-backend.mjs';
import { randomUUID } from 'node:crypto';

test('Computer result envelopes preserve image content and reject incomplete or mixed result shapes', async () =>
  computerFixture(async ({ tools }) => {
    const taskId = randomUUID();
    tools.startTask(taskId);
    const observation = await tools.call(taskId, 'computer.screenshot', { taskId, idempotencyKey: 'schema' });
    assert.deepEqual(computerCallResultSchema.parse(observation), observation);
    assert.equal(computerCallResultSchema.safeParse({ ...observation, backend: undefined }).success, false);
    assert.equal(computerCallResultSchema.safeParse({ ...observation, retained: true }).success, false);
    assert.deepEqual(
      computerCallResultSchema.parse({ retained: true, code: 'OK', businessEffect: 'applied' }),
      { retained: true, code: 'OK', businessEffect: 'applied' }
    );
    assert.equal(computerCallResultSchema.safeParse({ retained: true, computerContent: [] }).success, false);
    const status = await tools.call(taskId, 'computer.control.status', { taskId });
    assert.equal(computerCallResultSchema.parse(status).control.state, 'ready');
  }));
