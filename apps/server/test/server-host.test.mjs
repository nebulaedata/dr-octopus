/**
 * @author Codex
 * @description Exercises frozen restart targets, idempotency, cleanup failure and synchronous stop priority.
 */
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createServerHost } from '../dist/host.js';

/**
 * Builds isolated fake resources while using the production Host state machine.
 */
function fixture({
  failStart = [],
  failClose = [],
  pendingStart = [],
  startGates = [],
  startTimeoutMs = 40,
} = {}) {
  let target = snapshot(3000, 'a');
  const entries = [];
  const applied = [];
  const host = createServerHost({
    prepare: () => target,
    apply: (value) => applied.push(value),
    closeTimeoutMs: 40,
    ...(startTimeoutMs === null ? {} : { startTimeoutMs }),
    createRuntime({ config, control }) {
      const index = entries.length;
      const entry = { config, control, closed: false, starts: 0, closes: 0 };
      entries.push(entry);
      return {
        async start() {
          entry.starts++;
          if (startGates[index]) await startGates[index];
          if (pendingStart.includes(index)) await new Promise(() => {});
          if (failStart.includes(index)) throw new Error('private failure');
        },
        async close() {
          entry.closes++;
          if (failClose.includes(index)) throw new Error('private cleanup failure');
          entry.closed = true;
        },
        getStatus() {
          return {
            state: 'running',
            phase: pendingStart.includes(index) ? 'extensions' : 'ready',
            dataDir: '',
            address: `http://127.0.0.1:${config.port}`,
            fileLogging: { enabled: false, state: 'disabled', directory: '' },
            warnings: [],
          };
        },
      };
    },
  });
  return {
    host,
    entries,
    applied,
    target: (value) => {
      target = value;
    },
    async accept(key = 'attempt') {
      const control = entries.at(-1).control;
      return control.restart(
        { revision: target.revision, expectedServiceInstanceId: control.instanceId },
        key
      );
    },
  };
}
/**
 * Produces a deterministic, environment-independent frozen target.
 */
function snapshot(port, revision) {
  return {
    revision: revision.repeat(64),
    persisted: { SERVER_PORT: String(port) },
    values: {
      SERVER_PORT: String(port),
      SERVER_DATA_DIR: join(tmpdir(), 'octopus-host-test'),
      AGENT_DATA_DIR: join(tmpdir(), 'octopus-host-agent-test'),
    },
  };
}
/**
 * Waits for a public terminal state with a bounded test deadline.
 */
async function completed(control, id) {
  for (let i = 0; i < 100; i++) {
    const operation = control.operation(id);
    if (operation.completedAt) return operation;
    await delay(5);
  }
  throw new Error('Operation did not complete');
}
test('restart applies the accepted target, fences new work and replays before instance validation', async () => {
  const f = fixture();
  await f.host.start();
  const original = f.entries[0].control;
  f.target(snapshot(3100, 'b'));
  const request = { revision: 'b'.repeat(64), expectedServiceInstanceId: original.instanceId };
  const accepted = await original.restart(request, 'same');
  assert.throws(() => original.assertOpen(), { code: 'SERVER_RESTART_IN_PROGRESS' });
  f.target(snapshot(3200, 'c'));
  accepted.handoff();
  accepted.handoff();
  const operation = await completed(original, accepted.operation.operationId);
  assert.equal(operation.state, 'succeeded');
  assert.equal(f.entries.length, 2);
  assert.equal(f.entries[1].config.port, 3100);
  assert.ok(f.entries[0].closed);
  const replay = await f.entries[1].control.restart(request, 'same');
  assert.equal(replay.operation.operationId, operation.operationId);
  await assert.rejects(original.restart({ ...request, revision: 'c'.repeat(64) }, 'same'), {
    code: 'SERVER_RESTART_KEY_CONFLICT',
  });
  await f.host.stop();
});
test('failed target is cleaned before restoring the old snapshot once', async () => {
  const f = fixture({ failStart: [1] });
  await f.host.start();
  f.target(snapshot(3100, 'b'));
  const accepted = await f.accept();
  accepted.handoff();
  const result = await completed(f.entries[0].control, accepted.operation.operationId);
  assert.equal(result.state, 'restored');
  assert.equal(f.entries.length, 3);
  assert.ok(f.entries[1].closed);
  assert.equal(f.entries[2].config.port, 3000);
  assert.notEqual(result.targetInstanceId, result.sourceInstanceId);
  assert.equal(result.targetRevision, 'b'.repeat(64));
  assert.equal(f.applied.at(-1).revision, 'a'.repeat(64));
  await f.host.stop();
});
test('old cleanup failure forbids replacement', async () => {
  const f = fixture({ failClose: [0] });
  await f.host.start();
  const accepted = await f.accept();
  accepted.handoff();
  assert.equal((await completed(f.entries[0].control, accepted.operation.operationId)).state, 'failed');
  assert.equal(f.entries.length, 1);
});
test('stop wins before response handoff and no replacement is created', async () => {
  const f = fixture();
  await f.host.start();
  const accepted = await f.accept();
  const stopping = f.host.stop();
  accepted.handoff();
  await stopping;
  assert.equal(f.entries.length, 1);
  assert.equal(f.entries[0].control.operation(accepted.operation.operationId).state, 'cancelled');
  assert.equal(f.host.getStatus().state, 'stopped');
});

test('stop during target startup rejects late ready publication and closes the candidate', async () => {
  const gate = Promise.withResolvers();
  const f = fixture({ startGates: [undefined, gate.promise] });
  await f.host.start();
  const accepted = await f.accept();
  accepted.handoff();
  while (f.entries.length < 2) await delay(1);
  await f.host.stop();
  gate.resolve();
  await delay(5);
  assert.equal(f.host.getStatus().state, 'stopped');
  assert.equal(f.entries[1].closed, true);
  assert.equal(f.entries[0].control.operation(accepted.operation.operationId).state, 'cancelled');
});
test('startup timeout requires candidate cleanup before recovery', async () => {
  const f = fixture({ pendingStart: [1], failClose: [1] });
  await f.host.start();
  const accepted = await f.accept();
  accepted.handoff();
  assert.equal((await completed(f.entries[0].control, accepted.operation.operationId)).state, 'failed');
  assert.equal(f.entries.length, 2);
  assert.equal(f.entries[1].closes, 1);
});

test('restart completion notifies subscribers retained by the Host without status polling', async () => {
  const f = fixture();
  await f.host.start();
  const control = f.entries[0].control;
  const finished = Promise.withResolvers();
  let operationId;
  const unsubscribe = control.subscribe(() => {
    if (operationId) {
      const operation = control.operation(operationId);
      if (operation.completedAt) finished.resolve(operation);
    }
  });
  try {
    const accepted = await f.accept('push');
    operationId = accepted.operation.operationId;
    accepted.handoff();
    let deadline;
    try {
      const value = await Promise.race([
        finished.promise,
        new Promise((_, reject) => {
          deadline = setTimeout(() => reject(new Error('No Host notification')), 1000);
        }),
      ]);
      assert.equal(value.state, 'succeeded');
    } finally {
      clearTimeout(deadline);
    }
  } finally {
    unsubscribe();
    await f.host.stop();
  }
});

test('Initial startup timeout identifies its phase before cleaning up the candidate', async () => {
  const f = fixture({ pendingStart: [0] });
  await assert.rejects(f.host.start(), /Server startup \(phase: extensions\) deadline exceeded after 40ms/);
  assert.equal(f.entries[0].closed, true);
  assert.equal(f.host.getStatus().state, 'failed');
  await f.host.stop();
});

test('Default startup waits past the former deadline until installation completes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const gate = Promise.withResolvers();
  const f = fixture({ startGates: [gate.promise], startTimeoutMs: null });
  const starting = f.host.start();
  t.mock.timers.tick(120_000);
  await Promise.resolve();
  assert.equal(f.entries[0].closed, false);
  assert.equal(f.host.getStatus().state, 'starting');
  gate.resolve();
  await starting;
  assert.equal(f.host.getStatus().state, 'running');
  await f.host.stop();
});
