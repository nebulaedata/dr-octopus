/**
 * @author Codex
 * @description Exercises deadline accounting, pre-dispatch refusal and observation versus mutation failures through the real MCP fixture.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { computerExecutionDeadline, computerDefinitions } from '../src/runtime/computer/computer-inputs.ts';
import { computerFixture } from './fixtures/computer-backend.mjs';

test('desktop deadlines respect policy, client/task time and a separate cleanup reserve', () => {
  const now = 100000;
  assert.equal(computerExecutionDeadline('computer.snapshot', now + 120000, now), now + 60000);
  assert.equal(computerExecutionDeadline('computer.snapshot', now + 50000, now), now + 40000);
  assert.equal(computerExecutionDeadline('computer.click', now + 120000, now), now + 10000);
  assert.equal(computerExecutionDeadline('computer.app.switch', now + 120000, now), now + 60000);
  for (const deadline of [now - 1, now + 30000, Infinity, NaN]) {
    assert.throws(() => computerExecutionDeadline('computer.snapshot', deadline, now), {
      code: 'COMPUTER_BUDGET_INSUFFICIENT',
    });
  }
});

test('insufficient Snapshot time is refused before control status or Snapshot is dispatched', async () =>
  computerFixture(async ({ tools, state }) => {
    const taskId = randomUUID();
    tools.startTask(taskId);
    await assert.rejects(
      tools.call(
        taskId,
        'computer.snapshot',
        { taskId, idempotencyKey: 'short' },
        { deadlineMs: Date.now() + 30000 }
      ),
      { code: 'COMPUTER_BUDGET_INSUFFICIENT' }
    );
    assert.deepEqual(state.calls, []);
    assert.equal(tools.available(), true);
  }));

test('preflight and Snapshot consume one deadline rather than independent full timeouts', async (t) =>
  computerFixture(async ({ tools, connection }) => {
    const taskId = randomUUID();
    tools.startTask(taskId);
    const calls = [];
    const original = connection.callTool.bind(connection);
    let now = 100000;
    t.mock.method(Date, 'now', () => now);
    t.mock.method(connection, 'callTool', async (name, args, options) => {
      calls.push({ name, timeoutMs: options.timeoutMs });
      const result = await original(name, args, options);
      if (name === 'ControlStatus') {
        now += 2000;
      }
      return result;
    });
    await tools.call(
      taskId,
      'computer.snapshot',
      { taskId, idempotencyKey: 'bounded' },
      { deadlineMs: 150000 }
    );
    assert.deepEqual(calls, [
      { name: 'ControlStatus', timeoutMs: 10000 },
      { name: 'Snapshot', timeoutMs: 38000 },
    ]);
  }));

test('delayed preflight cannot dispatch an observation after its useful budget is consumed', async (t) =>
  computerFixture(async ({ tools, connection, state }) => {
    const taskId = randomUUID();
    tools.startTask(taskId);
    const original = connection.callTool.bind(connection);
    let now = 100000;
    t.mock.method(Date, 'now', () => now);
    t.mock.method(connection, 'callTool', async (name, args, options) => {
      const result = await original(name, args, options);
      now += 15000;
      return result;
    });
    await assert.rejects(
      tools.call(
        taskId,
        'computer.snapshot',
        { taskId, idempotencyKey: 'preflight' },
        { deadlineMs: 150000 }
      ),
      { code: 'COMPUTER_BUDGET_INSUFFICIENT' }
    );
    assert.deepEqual(
      state.calls.map((call) => call.name),
      ['ControlStatus']
    );
  }));

test('an observation transport timeout retires control without claiming unknown input effects', async (t) =>
  computerFixture(async ({ tools, connection, state }) => {
    const taskId = randomUUID();
    tools.startTask(taskId);
    const original = connection.callTool.bind(connection);
    let attempts = 0;
    t.mock.method(connection, 'callTool', async (name, args, options) => {
      if (name === 'Snapshot') {
        attempts++;
        throw Error('transport deadline');
      }
      return original(name, args, options);
    });
    await assert.rejects(tools.call(taskId, 'computer.snapshot', { taskId, idempotencyKey: 'timeout' }), {
      code: 'COMPUTER_OBSERVATION_INTERRUPTED',
    });
    assert.equal(attempts, 1);
    assert.equal(tools.available(), false);
    assert.equal(tools.executionStopped(), true);
    assert.equal(state.stopped, 1);
  }));

test('explicit observation failures are distinct from transport loss and do not fabricate images', async () =>
  computerFixture(async ({ tools, state }) => {
    const taskId = randomUUID();
    tools.startTask(taskId);
    state.result = { isError: true, content: [{ type: 'text', text: 'Error capturing desktop state' }] };
    await assert.rejects(tools.call(taskId, 'computer.snapshot', { taskId, idempotencyKey: 'failed' }), {
      code: 'COMPUTER_EXECUTION_FAILED',
    });
    assert.equal(tools.available(), true);
    assert.equal(state.stopped, 0);
    assert.equal(computerDefinitions['computer.snapshot'].mutation, false);
  }));
