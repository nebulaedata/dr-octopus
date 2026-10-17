/**
 * @author Codex
 * @description Verifies upstream content, physical coordinate mapping, ownership, errors and no replay without real desktop input.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { computerFixture } from './fixtures/computer-backend.mjs';
import { upstreamArguments, computerSchemas } from '../src/runtime/computer/computer-inputs.ts';
test('finite public contracts reject legacy windows, arbitrary App execution and unbounded input', () => {
  const base = { taskId: randomUUID(), idempotencyKey: 'operation' };
  assert.equal(
    computerSchemas['computer.app.switch'].safeParse({ ...base, name: 'owned', executable: 'cmd.exe' })
      .success,
    false
  );
  assert.equal(
    computerSchemas['computer.click'].safeParse({ ...base, point: [1, 2], clicks: 3 }).success,
    false
  );
  assert.deepEqual(
    upstreamArguments('computer.scroll', { ...base, point: [-12, 5], direction: 'left', count: 2 }),
    { loc: [-12, 5], direction: 'left', type: 'horizontal', wheel_times: 2 }
  );
  assert.deepEqual(upstreamArguments('computer.type', { ...base, point: [10, 20], text: '中文' }), {
    loc: [10, 20],
    text: '中文',
    clear: false,
    press_enter: false,
    caret_position: 'idle',
  });
});
test('screenshots remain image content and no legacy observation is needed', async () =>
  computerFixture(async ({ tools, state }) => {
    const taskId = randomUUID();
    tools.startTask(taskId);
    const result = await tools.call(taskId, 'computer.screenshot', {
      taskId,
      idempotencyKey: 'screenshot',
    });
    assert.equal(result.computerContent[1].type, 'image');
    assert.equal(result.backend.upstreamVersion, '0.8.8');
    assert.equal(result.backend.serverVersion, '4.0.5');
    assert.deepEqual(
      state.calls.map((c) => c.name),
      ['ControlStatus', 'Screenshot']
    );
  }));
test('user ownership refuses before input dispatch', async () =>
  computerFixture(async ({ tools, state }) => {
    const taskId = randomUUID();
    tools.startTask(taskId);
    state.control.state = 'user';
    await assert.rejects(
      tools.call(taskId, 'computer.click', { taskId, idempotencyKey: 'click', point: [5, 6] }),
      { code: 'COMPUTER_USER_CONTROL' }
    );
    assert.equal(state.calls.length, 1);
  }));
test('upstream mutation failure is unknown and retires execution, never replayed', async () =>
  computerFixture(async ({ tools, state }) => {
    const taskId = randomUUID();
    tools.startTask(taskId);
    state.result = { isError: true, content: [{ type: 'text', text: 'failure' }] };
    await assert.rejects(
      tools.call(taskId, 'computer.type', {
        taskId,
        idempotencyKey: 'type',
        point: [10, 20],
        text: 'private',
      }),
      { code: 'COMPUTER_RESULT_UNKNOWN' }
    );
    assert.equal(tools.executionStopped(), true);
    assert.equal(tools.available(), false);
    await assert.rejects(
      tools.call(taskId, 'computer.type', {
        taskId,
        idempotencyKey: 'type',
        point: [10, 20],
        text: 'private',
      }),
      { code: 'COMPUTER_UNAVAILABLE' }
    );
    assert.equal(state.calls.filter((c) => c.name === 'Type').length, 1);
  }));
test('malformed images retire the provider and concurrent calls cannot overlap', async () =>
  computerFixture(async ({ tools, state }) => {
    const taskId = randomUUID();
    tools.startTask(taskId);
    let release;
    state.hold = new Promise((r) => {
      release = r;
    });
    const pending = tools.call(taskId, 'computer.screenshot', { taskId, idempotencyKey: 'one' });
    await assert.rejects(tools.call(taskId, 'computer.screenshot', { taskId, idempotencyKey: 'two' }), {
      code: 'ACTION_IN_PROGRESS',
    });
    state.result = { content: [{ type: 'image', mimeType: 'image/png', data: 'YWJj' }] };
    release();
    await assert.rejects(pending, { code: 'COMPUTER_OBSERVATION_INTERRUPTED' });
  }));
test('control notification retires the current task without reacquiring ownership', async () =>
  computerFixture(async ({ tools, server }) => {
    const taskId = randomUUID();
    tools.startTask(taskId);
    await server.sendLoggingMessage({
      level: 'notice',
      logger: 'windows-mcp.control',
      data: { event: 'changed', status: { state: 'user', generation: 2, wait_seconds: 10 } },
    });
    await tools.close();
    assert.equal(tools.available(), false);
    assert.equal(tools.executionStopped(), true);
  }));
