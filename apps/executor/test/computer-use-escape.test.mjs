/**
 * @author Codex
 * @description Verifies local Escape subscription ownership and refusal of callbacks from retired activities or Runtime generations.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { ComputerUseEscape } from '../src/main/computer-use-escape.ts';
import { ComputerUseActivity } from '../src/runtime/computer/computer-use-activity.ts';

test('Escape follows one activity across call revisions and ignores idle, old task and old Runtime callbacks', () => {
  const callbacks = [];
  const stops = [];
  const watcher = {
    /**
     * Keeps callbacks available to reproduce delayed native notifications.
     */
    start(callback) {
      callbacks.push(callback);
      return Promise.resolve();
    },
    /**
     * Leaves callback references intact so the owner must reject retired activity messages.
     */
    stop() {},
  };
  const owner = new ComputerUseEscape(watcher, (activityId, pid) => stops.push({ activityId, pid }));
  const activity = new ComputerUseActivity(() => {});
  activity.startTask('first');
  const firstId = activity.snapshot().activityId;
  owner.update({ pid: 11, computerUse: activity.snapshot() });
  const call = activity.begin();
  assert.equal(activity.snapshot().activityId, firstId);
  owner.update({ pid: 11, computerUse: activity.snapshot() });
  assert.equal(callbacks.length, 1);
  callbacks[0]();
  assert.deepEqual(stops, [{ activityId: firstId, pid: 11 }]);
  call.complete();
  activity.endTask('first');
  owner.update({ pid: 11, computerUse: activity.snapshot() });
  callbacks[0]();
  assert.equal(stops.length, 1);
  activity.startTask('second');
  const secondId = activity.snapshot().activityId;
  assert.notEqual(secondId, firstId);
  owner.update({ pid: 11, computerUse: activity.snapshot() });
  callbacks[0]();
  assert.equal(stops.length, 1);
  owner.update({ pid: 12, computerUse: activity.snapshot() });
  callbacks[1]();
  assert.equal(stops.length, 1);
  callbacks[2]();
  assert.deepEqual(stops[1], { activityId: secondId, pid: 12 });
  owner.dispose();
  owner.dispose();
  callbacks[2]();
  assert.equal(stops.length, 2);
});

test('uncertain calls keep the same stop identity until actual cleanup; idle identity cannot be reused', () => {
  const activity = new ComputerUseActivity(() => {});
  activity.startTask(randomUUID());
  const firstId = activity.snapshot().activityId;
  const call = activity.begin();
  call.uncertain();
  activity.endTasks();
  assert.equal(activity.snapshot().state, 'unknown');
  assert.equal(activity.snapshot().activityId, firstId);
  call.complete();
  assert.equal(activity.snapshot().activityId, null);
  activity.startTask(randomUUID());
  assert.notEqual(activity.snapshot().activityId, firstId);
});

test('native registration failure releases its resource and never leaks a callback into a later activity', async (context) => {
  context.mock.method(console, 'error', () => {});
  let reject;
  let callback;
  let stopped = 0;
  const owner = new ComputerUseEscape(
    {
      /**
       * Separates native readiness from resource creation to reproduce registration failure.
       */
      start(value) {
        callback = value;
        return new Promise((_resolve, failed) => {
          reject = failed;
        });
      },
      /**
       * Counts cleanup attempts without suppressing the deliberately retained callback.
       */
      stop() {
        stopped++;
      },
    },
    () => {
      throw new Error('Retired Escape callback must not run');
    }
  );
  owner.update({ pid: 11, computerUse: { activityId: randomUUID(), state: 'running' } });
  reject(new Error('Native hook registration refused'));
  await new Promise((resolve) => setImmediate(resolve));
  callback();
  assert.equal(stopped, 2);
  owner.dispose();
});
