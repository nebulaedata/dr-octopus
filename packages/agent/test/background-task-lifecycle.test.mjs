/**
 * @author Codex
 * @description Regresses history eviction during waits and recovery from failed background controls.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { BackgroundTaskManager } from '../dist/extensions/background-task/services/task-manager.js';
import { registerBackgroundCommands } from '../dist/extensions/background-task/extension/commands.js';

/**
 * Creates one old active task followed by a full window of completed tasks without OS processes.
 */
async function fullHistory() {
  let finish;
  const done = new Promise((resolve) => {
    finish = () => resolve({ exitCode: 0 });
  });
  const manager = new BackgroundTaskManager({
    async launch(command, _cwd, output) {
      output(Buffer.from('process output'));
      return { done: command === 'long' ? done : Promise.resolve({ exitCode: 0 }), stop: finish };
    },
  });
  const long = await manager.start('long', '.', 'long-lived server', 'long');
  const short = [];
  for (let i = 0; i < 100; i++) short.push(await manager.start('short', '.', `short ${i}`, `short-${i}`));
  return { manager, long, short, finish };
}

test('retains the newest completion when an old long-lived task finishes after 100 short tasks', async () => {
  const { manager, long, short, finish } = await fullHistory();
  const waiting = manager.wait(long.taskId, 1000);
  finish();
  assert.equal((await waiting).state, 'exited');
  const snapshot = manager.snapshot();
  assert.equal(snapshot.tasks.length, 100);
  assert.ok(snapshot.tasks.some((task) => task.taskId === long.taskId));
  assert.ok(!snapshot.tasks.some((task) => task.taskId === short[0].taskId));
});

test('an existing waiter survives history eviction by later completions', async () => {
  const { manager, long, finish } = await fullHistory();
  const waiting = manager.wait(long.taskId, 1000);
  finish();
  await Promise.resolve();
  for (let i = 0; i < 101; i++) await manager.start('short', '.', `new ${i}`, `new-${i}`);
  assert.ok(!manager.snapshot().tasks.some((task) => task.taskId === long.taskId));
  assert.equal((await waiting).state, 'exited');
  assert.equal(manager.snapshot().tasks.length, 100);
});

test('shutdown completes at the history limit without reopening admission', async () => {
  const { manager } = await fullHistory();
  await manager.dispose();
  assert.equal(manager.snapshot().activeCount, 0);
  assert.equal(manager.snapshot().accepting, false);
});

test('successful controls clear previous command errors without releasing a stop barrier', async () => {
  const { manager, short, finish } = await fullHistory();
  const taskId = short.at(-1).taskId;
  let command;
  registerBackgroundCommands(
    {
      registerCommand(_name, definition) {
        command = definition;
      },
    },
    manager
  );
  const ctx = { hasUI: false, mode: 'rpc' };
  manager.beginStop('test-barrier');
  finish();
  await Promise.resolve();
  for (const action of [`logs ${taskId}`, `stop ${taskId}`, 'status']) {
    await assert.rejects(command.handler('logs missing-task', ctx), /TASK_NOT_FOUND/);
    assert.ok(manager.snapshot().error);
    await command.handler(action, ctx);
    assert.equal(manager.snapshot().error, undefined);
    assert.equal(manager.snapshot().accepting, false);
  }
  assert.equal(manager.snapshot().logs.text, 'process output');
  await assert.rejects(command.handler('logs missing-task', ctx), /TASK_NOT_FOUND/);
  assert.ok(manager.snapshot().error, 'a new failure must still be visible');
});
