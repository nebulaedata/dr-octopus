/**
 * @author Codex
 * @description Verifies background stop coordination, failure visibility and runtime generation isolation.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { stopSession } from '../dist/lib/runtime/stop-session.js';
import { RuntimeCommands } from '../dist/lib/runtime/commands.js';

/**
 * Creates a controllable transport and authoritative fleet projection.
 */
function fixture({ rejectStop = false, omitted = false } = {}) {
  const run = { id: 'run-a', kind: 'workflow', state: 'running', children: [] };
  const fleet = { runs: [run], omitted: { runs: omitted ? 1 : 0, children: 0, byteLimitExceeded: false } };
  const calls = [];
  const target = {
    binding: { runtimeId: 'r' },
    epoch: 1,
    async execute(command) {
      calls.push(command);
      if (command.type === 'get_state')
        return {
          success: true,
          data: { isStreaming: false, isCompacting: false, pendingMessageCount: 0 },
        };
      if (command.type === 'get_commands')
        return { success: true, data: { commands: [{ name: 'subagents-stop', source: 'extension' }] } };
      if (command.type === 'prompt') {
        if (rejectStop) return { success: false };
        run.state = 'stopped';
      }
      return { success: true };
    },
  };
  return { target, fleet, calls, options: { readFleet: () => fleet, pollIntervalMs: 1, timeoutMs: 200 } };
}

test('stops detached roots once and confirms terminal state, while always aborting the main loop', async () => {
  const f = fixture();
  await stopSession(f.target, f.options);
  assert.equal(f.calls[0].type, 'abort');
  assert.deepEqual(
    f.calls.filter((c) => c.type === 'prompt'),
    [{ type: 'prompt', message: '/subagents-stop run-a' }]
  );
  assert.equal(f.fleet.runs[0].state, 'stopped');
});

test('rejection and incomplete snapshots fail visibly even though main abort succeeds', async () => {
  for (const options of [{ rejectStop: true }, { omitted: true }]) {
    const f = fixture(options);
    await assert.rejects(stopSession(f.target, f.options), /Stop could not be confirmed/);
    assert.equal(f.calls[0].type, 'abort');
  }
});

test('an acknowledgement without terminal state times out instead of reporting success', async () => {
  const f = fixture();
  const execute = f.target.execute;
  f.target.execute = async (command) => (command.type === 'prompt' ? { success: true } : execute(command));
  await assert.rejects(stopSession(f.target, { ...f.options, timeoutMs: 20 }), /Stop could not be confirmed/);
});

test('repeated stops share work and stale-generation requests never dispatch', async () => {
  const f = fixture();
  const commands = new RuntimeCommands({
    withRuntime: async (_id, work) => work(f.target),
    readSubagentFleet: () => f.fleet,
  });
  await assert.rejects(commands.execute('s', { type: 'abort' }, { epoch: 2 }), /stale/i);
  assert.equal(f.calls.length, 0);
  await Promise.all([commands.execute('s', { type: 'abort' }), commands.execute('s', { type: 'abort' })]);
  assert.equal(f.calls.filter((c) => c.type === 'abort').length, 1);
});

test('tasks from a later run are not swept into an already captured stop request', async () => {
  const f = fixture();
  const execute = f.target.execute;
  f.target.execute = async (command) => {
    const response = await execute(command);
    if (command.type === 'prompt') f.fleet.runs.push({ id: 'later-run', state: 'running' });
    return response;
  };
  await stopSession(f.target, f.options);
  assert.equal(f.fleet.runs[1].state, 'running');
  assert.equal(f.calls.filter((command) => command.type === 'prompt').length, 1);
});

test('an unadvertised stop command is never submitted as a model prompt', async () => {
  const f = fixture();
  const execute = f.target.execute;
  f.target.execute = async (command) =>
    command.type === 'get_commands' ? { success: true, data: { commands: [] } } : execute(command);
  await assert.rejects(stopSession(f.target, f.options), /unavailable/);
  assert.equal(
    f.calls.some((command) => command.type === 'prompt'),
    false
  );
});

test('stop clears stranded messages even while abort is still waiting', async () => {
  const f = fixture();
  f.fleet.runs = [];
  const execute = f.target.execute;
  let pendingMessageCount = 1;
  let finishAbort;
  f.target.execute = async (command) => {
    if (command.type === 'abort') {
      return new Promise((resolve) => {
        finishAbort = resolve;
      });
    }
    if (command.type === 'clear_queue') {
      pendingMessageCount = 0;
      finishAbort({ success: true });
    }
    if (command.type === 'get_state') {
      return { success: true, data: { isStreaming: false, isCompacting: false, pendingMessageCount } };
    }
    return execute(command);
  };
  await stopSession(f.target, f.options);
  assert.equal(pendingMessageCount, 0);
  assert.equal(f.calls.filter((command) => command.type === 'clear_queue').length, 1);
});

test('stop does not acknowledge success when queue clearing fails or leaves pending work', async () => {
  for (const rejectClear of [true, false]) {
    const f = fixture();
    f.fleet.runs = [];
    const execute = f.target.execute;
    f.target.execute = async (command) => {
      if (command.type === 'clear_queue') return { success: !rejectClear };
      if (command.type === 'get_state') {
        return { success: true, data: { isStreaming: false, isCompacting: false, pendingMessageCount: 1 } };
      }
      return execute(command);
    };
    await assert.rejects(
      stopSession(f.target, { ...f.options, timeoutMs: 20 }),
      /Stop could not be confirmed/
    );
  }
});
