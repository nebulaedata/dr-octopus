/**
 * @author Codex
 * @description Verifies event-driven deferred restarts do not spin, replay cancelled work or erase newer intent.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DeferredRestarts } from '../dist/lib/runtime/deferred-restarts.js';

/** Flushes accepted microtasks without advancing a business timer. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

test('busy rejection waits for another real safety signal', async () => {
  let calls = 0;
  const queue = new DeferredRestarts(
    () => true,
    () => {}
  );
  queue.enqueue('s', async () => {
    calls++;
    throw Object.assign(new Error('busy'), { code: 'SESSION_BUSY' });
  });
  await settled();
  await settled();
  assert.equal(calls, 1);
  assert.equal(queue.has('s'), true);
  queue.wake('s');
  await settled();
  assert.equal(calls, 2);
  queue.close();
});

test('shutdown cancels a queued callback and an old completion cannot erase a new request', async () => {
  let calls = 0;
  const queue = new DeferredRestarts(
    () => true,
    () => {}
  );
  queue.enqueue('s', async () => {
    calls++;
  });
  queue.close();
  await settled();
  assert.equal(calls, 0);
  const old = Promise.withResolvers();
  queue.enqueue('s', () => old.promise);
  await settled();
  queue.cancel('s');
  const next = Promise.withResolvers();
  queue.enqueue('s', () => next.promise);
  await settled();
  old.resolve();
  await settled();
  assert.equal(queue.has('s'), true);
  next.resolve();
  await settled();
  assert.equal(queue.has('s'), false);
});
