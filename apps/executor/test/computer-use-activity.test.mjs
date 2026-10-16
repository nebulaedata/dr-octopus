/**
 * @author Codex
 * @description Verifies concurrent Computer feedback, uncertain outcomes and strict truthful activity contracts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ComputerUseActivity } from '../src/runtime/computer/computer-use-activity.ts';
import { computerUseMessageSchema } from '../src/contracts/computer-use.ts';

test('activity follows admitted calls, retains uncertainty and does not hide overlapping calls', () => {
  const updates = [];
  const activity = new ComputerUseActivity((value) => updates.push(value));
  assert.equal(activity.snapshot().state, 'idle');
  const first = activity.begin();
  const second = activity.begin();
  assert.equal(activity.snapshot().activeCalls, 2);
  first.complete();
  first.complete();
  assert.equal(activity.snapshot().state, 'running');
  second.uncertain();
  second.uncertain();
  assert.equal(activity.snapshot().state, 'unknown');
  assert.equal(activity.snapshot().activeCalls, 1);
  second.complete();
  assert.deepEqual(activity.snapshot(), {
    revision: 5,
    activityId: null,
    activeCalls: 0,
    activeTasks: 0,
    state: 'idle',
  });
  updates[0].activeCalls = 0;
  assert.equal(activity.snapshot().activeCalls, 0);
});

test('Computer task feedback spans observation and gaps; closing a task cannot hide unresolved input', () => {
  const updates = [];
  const activity = new ComputerUseActivity((value) => updates.push(value));
  activity.startTask('first');
  activity.startTask('first');
  assert.equal(activity.snapshot().activeTasks, 1);
  const first = activity.begin();
  first.complete();
  assert.equal(activity.snapshot().activeCalls, 0);
  assert.equal(activity.snapshot().state, 'running');
  const second = activity.begin();
  second.uncertain();
  activity.endTask('first');
  assert.equal(activity.snapshot().state, 'unknown');
  assert.equal(activity.snapshot().activeTasks, 0);
  second.complete();
  assert.equal(activity.snapshot().state, 'idle');
  assert.ok(updates.slice(0, -1).every((value) => value.state !== 'idle'));
  assert.equal(
    computerUseMessageSchema.safeParse({ type: 'computer-use', pid: 123, activity: updates[0] }).success,
    true
  );
});

test('session bounds and confirmed cleanup retain another independent Computer call', () => {
  const activity = new ComputerUseActivity(() => {});
  for (let index = 0; index < 32; index++) {
    activity.startTask(String(index));
  }
  assert.throws(() => activity.startTask('extra'), /BUSY/);
  const call = activity.begin();
  activity.endTasks();
  assert.equal(activity.snapshot().state, 'running');
  call.complete();
  assert.equal(activity.snapshot().state, 'idle');
});

test('activity is bounded and messages cannot label active calls as idle', () => {
  const activity = new ComputerUseActivity(() => {});
  const handles = Array.from({ length: 32 }, () => activity.begin());
  assert.throws(() => activity.begin(), /BUSY/);
  for (const handle of handles) {
    handle.complete();
  }
  const message = { type: 'computer-use', pid: 123, activity: activity.snapshot() };
  assert.equal(computerUseMessageSchema.safeParse(message).success, true);
  assert.equal(
    computerUseMessageSchema.safeParse({ ...message, activity: { ...message.activity, activeCalls: 1 } })
      .success,
    false
  );
  assert.equal(
    computerUseMessageSchema.safeParse({ ...message, activity: { ...message.activity, state: 'running' } })
      .success,
    false
  );
  assert.equal(computerUseMessageSchema.safeParse({ ...message, credential: 'forbidden' }).success, false);
});
