/**
 * @author Codex
 * @description Verifies guarded Computer startup, merged initialization, shutdown races and guarded tool/activity integration without accessing the user's desktop.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { ComputerRuntime } from '../src/runtime/computer/computer-runtime.ts';
import { computerFixture } from './fixtures/computer-backend.mjs';

test('a closed Computer owner never connects or restarts the backend', async () => {
  await computerFixture(async ({ connection, activity }) => {
    let starts = 0;
    const owner = new ComputerRuntime(activity, {
      connect: async () => {
        starts++;
        return connection;
      },
      close: async () => ({ executionStopConfirmed: true }),
    });
    await owner.close();
    await owner.start();
    assert.equal(owner.status().state, 'closed');
    assert.equal(owner.status().available, false);
    assert.equal(starts, 0);
    await owner.close();
    await owner.start();
    assert.equal(starts, 0);
  });
});

test('local stop keeps activity visible after task release until actual backend cleanup is confirmed', async () => {
  await computerFixture(async ({ connection, activity }) => {
    let confirm;
    const cleanup = new Promise((resolve) => {
      confirm = resolve;
    });
    const owner = new ComputerRuntime(activity, { connect: async () => connection, close: () => cleanup });
    await owner.start();
    activity.startTask(randomUUID());
    const activityId = activity.snapshot().activityId;
    const closing = owner.close();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(activity.snapshot().state, 'running');
    assert.equal(activity.snapshot().activityId, activityId);
    assert.equal(owner.status().state, 'stopping');
    confirm({ executionStopConfirmed: true });
    await closing;
    assert.equal(activity.snapshot().state, 'idle');
    assert.equal(owner.status().state, 'closed');
  });
});

test('unconfirmed backend stop retains unknown activity even after the desktop task has released', async () => {
  await computerFixture(async ({ connection, activity }) => {
    const owner = new ComputerRuntime(activity, {
      connect: async () => connection,
      close: async () => ({ executionStopConfirmed: false }),
    });
    await owner.start();
    activity.startTask(randomUUID());
    const activityId = activity.snapshot().activityId;
    await assert.rejects(owner.close(), /COMPUTER_BACKEND_STOP_UNCONFIRMED/);
    assert.equal(owner.status().state, 'failed');
    assert.equal(activity.snapshot().state, 'unknown');
    assert.equal(activity.snapshot().activityId, activityId);
  });
});

test('one owner merges startup and attaches the same guarded tools and indicator contract', async () => {
  await computerFixture(async ({ connection, activity, state }) => {
    let starts = 0;
    const owner = new ComputerRuntime(activity, {
      connect: async () => {
        starts++;
        return connection;
      },
      close: () => connection.close(),
    });
    const first = owner.start();
    assert.equal(owner.status().state, 'starting');
    assert.equal(owner.status().available, false);
    assert.equal(owner.start(), first);
    await first;
    assert.equal(starts, 1);
    assert.equal(owner.status().state, 'ready');
    assert.equal(owner.status().available, true);
    const taskId = randomUUID();
    owner.tools.startTask(taskId);
    const result = await owner.tools.call(taskId, 'computer.control.status', { taskId });
    assert.equal(result.control.state, 'ready');
    assert.equal(state.calls.length, 1);
    assert.equal(activity.snapshot().state, 'running');
    assert.throws(() => owner.tools.attach(connection), /CONNECTION_REJECTED/);
    const close = owner.close();
    assert.equal(owner.close(), close);
    await close;
    assert.equal(owner.status().state, 'closed');
    assert.equal(owner.status().available, false);
    assert.equal(state.stopped, 1);
  });
});

test('initialization failure is contained, does not retry and confirms cleanup at shutdown', async () => {
  await computerFixture(async ({ activity }) => {
    let starts = 0;
    const owner = new ComputerRuntime(activity, {
      connect: async () => {
        starts++;
        throw new Error('private startup detail');
      },
      close: async () => ({ executionStopConfirmed: true }),
    });
    await owner.start();
    await owner.start();
    assert.equal(starts, 1);
    assert.equal(owner.status().state, 'failed');
    assert.equal(owner.status().available, false);
    assert.ok(!owner.status().reason.includes('private startup detail'));
    await owner.close();
  });
});

test('shutdown winning pending initialization rejects late tool readiness', async () => {
  await computerFixture(async ({ connection, activity }) => {
    let resolve;
    const pending = new Promise((done) => {
      resolve = done;
    });
    const owner = new ComputerRuntime(activity, {
      connect: () => pending,
      close: async () => {
        resolve(connection);
        return connection.close();
      },
    });
    const start = owner.start();
    await owner.close();
    await start;
    assert.equal(owner.status().state, 'closed');
    assert.equal(owner.status().available, false);
    assert.equal(activity.snapshot().state, 'idle');
  });
});

test('incompatible backend never attaches; lost connection cannot remain tool-ready', async () => {
  await computerFixture(async ({ activity, connection }) => {
    const rejected = new ComputerRuntime(activity, {
      connect: async () => ({ isConnected: () => false }),
      close: async () => ({ executionStopConfirmed: true }),
    });
    await rejected.start();
    assert.equal(rejected.status().state, 'failed');
    assert.equal(rejected.status().available, false);
    await rejected.close();
    const owner = new ComputerRuntime(activity, {
      connect: async () => connection,
      close: () => connection.close(),
    });
    await owner.start();
    await connection.close();
    assert.equal(owner.status().available, false);
    assert.equal(owner.status().state, 'unavailable');
    await owner.close();
  });
});

test('unconfirmed backend cleanup remains a rejected close and disables admission', async () => {
  await computerFixture(async ({ activity }) => {
    const owner = new ComputerRuntime(activity, {
      connect: async () => {
        throw new Error('unavailable');
      },
      close: async () => ({ executionStopConfirmed: false }),
    });
    await owner.start();
    await assert.rejects(owner.close(), /STOP_UNCONFIRMED/);
    assert.equal(owner.status().state, 'failed');
    assert.equal(owner.status().available, false);
  });
});

test('Runtime stop racing explicit reconnect never publishes late readiness', async () => {
  await computerFixture(async ({ connection: first, activity }) =>
    computerFixture(async ({ connection: second }) => {
      let resolve;
      const pending = new Promise((done) => {
        resolve = done;
      });
      const next = {
        connect: () => pending,
        close: async () => {
          resolve(second);
          return second.close();
        },
      };
      const owner = new ComputerRuntime(activity, {
        connect: async () => first,
        close: () => first.close(),
        recreate: () => next,
      });
      await owner.start();
      await owner.tools.close();
      const restarted = owner.tools.restart();
      await new Promise((done) => setImmediate(done));
      assert.equal(owner.status().state, 'starting');
      const rejection = assert.rejects(restarted, /RESTART_STOPPED|COMPUTER_UNAVAILABLE/);
      await owner.close();
      await rejection;
      assert.equal(owner.status().state, 'closed');
      assert.equal(owner.status().available, false);
      assert.equal(second.isConnected(), false);
    })
  );
});
