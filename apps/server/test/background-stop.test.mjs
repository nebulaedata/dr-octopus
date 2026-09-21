/**
 * @author Codex
 * @description Verifies background stop evidence, failed-stop fencing and safe runtime reclamation.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { stopSession } from '../dist/lib/runtime/stop-session.js';
import { RuntimeCommands } from '../dist/lib/runtime/commands.js';
import { ManagedRuntimeState } from '../dist/lib/runtime/managed-state.js';

test('background initialization failure still stops the subagent fleet before reporting failure', async () => {
  for (const failure of ['invalid-snapshot', 'unavailable-control', 'rejected-begin']) {
    const run = { id: 'child', state: 'running' };
    const snapshot = {
      schemaVersion: 1,
      generation: randomUUID(),
      revision: 1,
      accepting: true,
      activeCount: 0,
      tasks: [],
    };
    const calls = [];
    const target = {
      async execute(command) {
        calls.push(command);
        if (command.type === 'get_commands')
          return {
            success: true,
            data: {
              commands: [
                { name: 'subagents-stop', source: 'extension' },
                ...(failure === 'unavailable-control'
                  ? []
                  : [{ name: 'octopus-background', source: 'extension' }]),
              ],
            },
          };
        if (command.type === 'get_state')
          return { success: true, data: { isStreaming: false, isCompacting: false, pendingMessageCount: 0 } };
        if (command.message === '/subagents-stop child') run.state = 'stopped';
        if (command.message?.startsWith('/octopus-background begin')) return { success: false };
        return { success: true };
      },
    };
    await assert.rejects(
      stopSession(target, {
        readFleet: () => ({ runs: [run], omitted: { runs: 0, children: 0, byteLimitExceeded: false } }),
        readBackground: () => (failure === 'invalid-snapshot' ? null : snapshot),
        timeoutMs: 1000,
        pollIntervalMs: 1,
      }),
      /Stop could not be confirmed/
    );
    assert.equal(run.state, 'stopped', failure);
    assert.equal(calls[0].type, 'abort');
    assert.ok(!calls.some((command) => command.message?.includes(' finish ')));
  }
});

test('a pending background handshake cannot prevent dispatching subagent cancellation', async () => {
  const run = { id: 'child', state: 'running' };
  const snapshot = {
    schemaVersion: 1,
    generation: randomUUID(),
    revision: 1,
    accepting: true,
    activeCount: 0,
    tasks: [],
  };
  let completeHandshake;
  const handshake = new Promise((resolve) => {
    completeHandshake = resolve;
  });
  const target = {
    async execute(command) {
      if (command.type === 'get_commands')
        return {
          success: true,
          data: {
            commands: [
              { name: 'subagents-stop', source: 'extension' },
              { name: 'octopus-background', source: 'extension' },
            ],
          },
        };
      if (command.type === 'get_state')
        return { success: true, data: { isStreaming: false, isCompacting: false, pendingMessageCount: 0 } };
      if (command.message === '/octopus-background status') return handshake;
      if (command.message === '/subagents-stop child') {
        run.state = 'stopped';
        completeHandshake({ success: true });
      }
      if (command.message?.startsWith('/octopus-background begin')) {
        snapshot.accepting = false;
        snapshot.stopId = command.message.split(' ').at(-1);
        snapshot.revision++;
      }
      if (command.message?.startsWith('/octopus-background finish')) {
        snapshot.accepting = true;
        snapshot.revision++;
      }
      return { success: true };
    },
  };
  await stopSession(target, {
    readFleet: () => ({ runs: [run], omitted: { runs: 0, children: 0, byteLimitExceeded: false } }),
    readBackground: () => ({ ...snapshot }),
    timeoutMs: 1000,
    pollIntervalMs: 1,
  });
  assert.equal(run.state, 'stopped');
  assert.equal(snapshot.accepting, true);
});

/**
 * Simulates independent ACKs and snapshots so stale evidence cannot masquerade as a stop.
 */
function fixture({ stale = false, busy = false } = {}) {
  let snapshot = {
    schemaVersion: 1,
    generation: randomUUID(),
    revision: 1,
    accepting: true,
    activeCount: 0,
    tasks: [],
  };
  const calls = [];
  const target = {
    binding: { runtimeId: 'runtime' },
    epoch: 1,
    async execute(command) {
      calls.push(command);
      if (command.type === 'get_commands')
        return { success: true, data: { commands: [{ name: 'octopus-background', source: 'extension' }] } };
      if (command.type === 'get_state')
        return { success: true, data: { isStreaming: busy, isCompacting: false, pendingMessageCount: 0 } };
      if (command.type === 'prompt' && !stale) {
        const [, action, id] = command.message.split(' ');
        snapshot = { ...snapshot, revision: snapshot.revision + 1 };
        if (action === 'begin') snapshot = { ...snapshot, stopId: id, accepting: false };
        if (action === 'finish') snapshot = { ...snapshot, accepting: true };
      }
      return { success: true };
    },
  };
  return { target, calls, read: () => snapshot };
}

test('stop releases the matching barrier only after main loop settles', async () => {
  const f = fixture();
  await stopSession(f.target, { readFleet: () => undefined, readBackground: f.read, timeoutMs: 100 });
  assert.equal(f.calls[0].type, 'abort');
  assert.equal(f.read().accepting, true);
  assert.match(f.calls.at(-1).message, /finish/);
});

test('ACK without matching revision/stop identity does not prove cleanup', async () => {
  const f = fixture({ stale: true });
  await assert.rejects(
    stopSession(f.target, { readFleet: () => undefined, readBackground: f.read, timeoutMs: 100 }),
    /stale/
  );
  assert.ok(!f.calls.some((command) => command.message?.includes(' finish ')));
});

test('failed stop fences future prompts until successful retry', async () => {
  const f = fixture({ stale: true });
  const commands = new RuntimeCommands({
    withRuntime: async (_id, work) => work(f.target),
    readBackgroundTasks: f.read,
  });
  await assert.rejects(commands.execute('s', { type: 'abort' }));
  await assert.rejects(commands.execute('s', { type: 'prompt', message: 'more' }), /Retry Stop/);
  const recovered = fixture();
  // A new runtime generation can accept work; the previous generation's fence never leaks across it.
  f.target.epoch = 2;
  f.target.execute = recovered.target.execute;
  await commands.execute('s', { type: 'prompt', message: 'new generation' });
});

test('active ownership and invalid snapshots block idle eviction', () => {
  const state = new ManagedRuntimeState({ isStreaming: false, isCompacting: false, pendingMessageCount: 0 });
  const f = fixture();
  const event = (snapshot) => ({
    type: 'extension_ui_request',
    method: 'setStatus',
    statusKey: 'octopus-background',
    statusText: JSON.stringify(snapshot),
  });
  assert.equal(state.isSafelyReclaimable(true, false, false), true);
  state.applyEvent(event({ ...f.read(), accepting: false }));
  assert.equal(state.isSafelyReclaimable(true, false, false), false);
  state.applyEvent(event(f.read()));
  assert.equal(state.isSafelyReclaimable(true, false, false), true);
  state.applyEvent(event({ invalid: true }));
  assert.equal(state.isSafelyReclaimable(true, false, false), false);
});
