/**
 * @author Codex
 * @description Verifies guarded Computer mapping, screenshot validation, task identities and uncertain actions through real MCP protocol fixtures.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { computerFixture } from './fixtures/computer-backend.mjs';
import { computerSchemas } from '../src/runtime/computer/computer-inputs.ts';
import { ComputerUseActivity } from '../src/runtime/computer/computer-use-activity.ts';
import { ComputerTools } from '../src/runtime/computer/computer-tools.ts';

/**
 * Creates a fresh foreground observation for one authenticated owner/task.
 */
async function observe(tools, taskId) {
  return tools.call('owner', taskId, 'computer_observe', { taskId });
}

test('missing resources and incomplete product contracts never qualify; no generic backend tool forwarding', async () => {
  assert.equal(new ComputerTools(new ComputerUseActivity(() => {})).available(), false);
  await computerFixture(
    async ({ tools, connection, state }) => {
      assert.equal(tools.available(), false);
      await assert.rejects(connection.callProduct('Click', { loc: [1, 2] }), /UNAVAILABLE/);
      assert.equal(state.calls.length, 0);
    },
    { missing: 'ExecutorInput' }
  );
});

test('pixel centers map into negative desktop origins, input invalidates observations and feedback follows backend results', async () => {
  await computerFixture(async ({ tools, activity, state }) => {
    const taskId = randomUUID();
    const observation = await observe(tools, taskId);
    const input = {
      taskId,
      observationId: observation.observationId,
      windowId: observation.windowId,
      idempotencyKey: 'click-1',
      point: { x: 1, y: 0, coordinateSpace: 'observation_image_px' },
    };
    let resolve;
    state.hold = new Promise((done) => {
      resolve = done;
    });
    const pending = tools.call('owner', taskId, 'computer_click', input);
    while (activity.snapshot().state === 'idle') {
      await new Promise((done) => setImmediate(done));
    }
    assert.equal(activity.snapshot().state, 'running');
    await assert.rejects(
      tools.call('owner', taskId, 'computer_displays', { taskId }),
      (error) => error.code === 'ACTION_IN_PROGRESS'
    );
    resolve();
    assert.deepEqual(await pending, { businessEffect: 'applied', code: 'OK' });
    assert.equal(activity.snapshot().state, 'idle');
    const action = state.calls.find((call) => call.name === 'ExecutorInput');
    assert.deepEqual(action.input.action, { kind: 'click', x: 50, y: 70, button: 'left', clicks: 1 });
    await assert.rejects(
      tools.call('owner', taskId, 'computer_click', input),
      (error) => error.code === 'OBSERVATION_STALE'
    );
    assert.equal(state.calls.filter((call) => call.name === 'ExecutorInput').length, 1);
  });
});

test('foreign identity, changed foreground/layout/window bounds and out-of-image points never dispatch input', async () => {
  for (const variant of ['owner', 'task', 'foreground', 'layout', 'bounds', 'point']) {
    await computerFixture(async ({ tools, state }) => {
      const taskId = randomUUID();
      const observation = await observe(tools, taskId);
      const input = {
        taskId,
        observationId: observation.observationId,
        windowId: observation.windowId,
        idempotencyKey: 'click',
        point: { x: variant === 'point' ? 4 : 0, y: 0, coordinateSpace: 'observation_image_px' },
      };
      if (variant === 'foreground') {
        state.meta.foreground = null;
      }
      if (variant === 'layout') {
        state.meta.layoutVersion = 'new';
      }
      if (variant === 'bounds') {
        state.meta.windows[0] = {
          ...state.meta.windows[0],
          bounds: { ...state.meta.windows[0].bounds, left: 99 },
        };
      }
      await assert.rejects(
        tools.call(
          variant === 'owner' ? 'other' : 'owner',
          variant === 'task' ? randomUUID() : taskId,
          'computer_click',
          input
        )
      );
      assert.equal(
        state.calls.some((call) => call.name === 'ExecutorInput'),
        false
      );
    });
  }
});

test('capture identity, region, image dimensions, checksum and extra fields must validate before observation registration', async () => {
  for (const variant of ['identity', 'region', 'expectedBounds', 'dimensions', 'checksum', 'extra']) {
    await computerFixture(async ({ tools, state, activity }) => {
      if (variant === 'identity') {
        state.capture.identity = { ...state.capture.identity, pid: 456 };
      }
      if (variant === 'region') {
        state.capture.captureRectPx = { ...state.capture.captureRectPx, width: 1 };
      }
      if (variant === 'expectedBounds') {
        state.capture.expectedBoundsPx = { ...state.capture.expectedBoundsPx, left: 99 };
      }
      if (variant === 'dimensions') {
        state.capture.imageSizePx.width = 5;
      }
      if (variant === 'checksum') {
        state.capture.image.data = state.capture.image.data.slice(0, -8) + 'AAAAAAAA';
      }
      if (variant === 'extra') {
        state.capture.secret = 'must not enter output';
      }
      await assert.rejects(observe(tools, randomUUID()));
      assert.equal(activity.snapshot().state, 'idle');
      assert.equal(
        state.calls.some((call) => call.name === 'ExecutorInput'),
        false
      );
    });
  }
});

test('finite capture refusals retain their cause, invalidate old observations and never retry or dispatch input', async () => {
  for (const code of [
    'TARGET_CHANGED',
    'SESSION_UNAVAILABLE',
    'CAPTURE_UNVERIFIED',
    'CAPTURE_LIMIT',
    'CAPTURE_FAILED',
  ]) {
    await computerFixture(async ({ tools, state, activity }) => {
      const taskId = randomUUID();
      const previous = await observe(tools, taskId);
      state.responses.ExecutorCapture = {
        isError: true,
        content: [{ type: 'text', text: 'untrusted backend detail must not escape' }],
        structuredContent: { contractVersion: 1, error: { code } },
      };
      await assert.rejects(
        observe(tools, taskId),
        (error) => error.code === code && !error.message.includes('untrusted')
      );
      await assert.rejects(
        tools.call('owner', taskId, 'computer_click', {
          taskId,
          windowId: previous.windowId,
          observationId: previous.observationId,
          idempotencyKey: 'stale-after-refusal',
          point: { x: 0, y: 0, coordinateSpace: 'observation_image_px' },
        }),
        (error) => error.code === 'TARGET_CHANGED'
      );
      assert.equal(state.calls.filter(({ name }) => name === 'ExecutorCapture').length, 2);
      assert.equal(
        state.calls.some(({ name }) => name === 'ExecutorInput'),
        false
      );
      assert.equal(activity.snapshot().state, 'idle');
      assert.equal(tools.available(), true);
    });
  }
});

test('unrecognized capture failures and failure-shaped successes cannot claim a known refusal', async () => {
  for (const response of [
    { isError: true, content: [], structuredContent: { contractVersion: 1, error: { code: 'SECRET_PATH' } } },
    {
      isError: true,
      content: [],
      structuredContent: { contractVersion: 2, error: { code: 'TARGET_CHANGED' } },
    },
    {
      isError: true,
      content: [],
      structuredContent: { contractVersion: 1, error: { code: 'TARGET_CHANGED', detail: 'secret' } },
    },
    { content: [], structuredContent: { contractVersion: 1, error: { code: 'TARGET_CHANGED' } } },
  ]) {
    await computerFixture(async ({ tools, state }) => {
      state.responses.ExecutorCapture = response;
      await assert.rejects(observe(tools, randomUUID()), (error) =>
        ['COMPUTER_RESPONSE_INVALID', 'CAPTURE_RESPONSE_INVALID'].includes(error.code)
      );
      assert.equal(state.calls.filter(({ name }) => name === 'ExecutorCapture').length, 1);
      assert.equal(
        state.calls.some(({ name }) => name === 'ExecutorInput'),
        false
      );
    });
  }
});

test('capture envelope and PNG failures identify separate validation stages', async () => {
  for (const [kind, code] of [
    ['envelope', 'CAPTURE_RESPONSE_INVALID'],
    ['pixels', 'CAPTURE_IMAGE_INVALID'],
  ]) {
    await computerFixture(async ({ tools, state }) => {
      if (kind === 'envelope') {
        state.capture.extra = 'unexpected';
      } else {
        state.capture.image.data = state.capture.image.data.slice(0, -8) + 'AAAAAAAA';
      }
      await assert.rejects(observe(tools, randomUUID()), (error) => error.code === code);
      assert.equal(
        state.calls.some(({ name }) => name === 'ExecutorInput'),
        false
      );
    });
  }
});

test('capture refusal envelopes cannot convert dispatched input failure into a known non-effect', async () => {
  await computerFixture(async ({ tools, state, activity }) => {
    const taskId = randomUUID();
    const previous = await observe(tools, taskId);
    state.responses.ExecutorInput = {
      isError: true,
      content: [],
      structuredContent: { contractVersion: 1, error: { code: 'TARGET_CHANGED' } },
    };
    await assert.rejects(
      tools.call('owner', taskId, 'computer_key', {
        taskId,
        windowId: previous.windowId,
        observationId: previous.observationId,
        idempotencyKey: 'unknown-input',
        key: 'Enter',
      }),
      (error) => error.code === 'COMPUTER_RESULT_UNKNOWN'
    );
    assert.equal(activity.snapshot().state, 'unknown');
    assert.equal(state.calls.filter(({ name }) => name === 'ExecutorInput').length, 1);
    assert.equal(tools.available(), false);
  });
});

test('Literal Unicode is forwarded without SendKeys interpretation; controls, surrogate errors and oversized text are rejected', async () => {
  await computerFixture(async ({ tools, state }) => {
    const taskId = randomUUID();
    const observation = await observe(tools, taskId);
    const input = {
      taskId,
      observationId: observation.observationId,
      windowId: observation.windowId,
      idempotencyKey: 'type',
      text: '中文😀{Enter}+',
    };
    for (const text of ['x\ny', 'x\ty', '\0', '\ud800', 'a'.repeat(257)]) {
      assert.equal(computerSchemas.computer_type.safeParse({ ...input, text }).success, false);
    }
    await tools.call('owner', taskId, 'computer_type', input);
    assert.deepEqual(state.calls.find((call) => call.name === 'ExecutorInput').input.action, {
      kind: 'type',
      text: input.text,
      clear: false,
    });
  });
});

test('unknown or malformed action outcomes retain feedback and block subsequent dispatch until owned cleanup', async () => {
  for (const result of [{ contractVersion: 1, effect: 'unknown', code: 'PARTIAL_INPUT' }, { wrong: true }]) {
    await computerFixture(async ({ tools, activity, state }) => {
      const taskId = randomUUID();
      const observation = await observe(tools, taskId);
      state.result = result;
      const pending = tools.call('owner', taskId, 'computer_key', {
        taskId,
        observationId: observation.observationId,
        windowId: observation.windowId,
        idempotencyKey: 'key',
        key: 'Enter',
      });
      if ('wrong' in result) {
        await assert.rejects(pending, (error) => error.code === 'COMPUTER_RESULT_UNKNOWN');
      } else {
        await pending;
      }
      assert.equal(activity.snapshot().state, 'unknown');
      assert.equal(tools.available(), false);
      await assert.rejects(observe(tools, taskId), (error) => error.code === 'COMPUTER_UNAVAILABLE');
      await tools.close();
      assert.equal(activity.snapshot().state, 'idle');
      assert.equal(state.stopped, 1);
    });
  }
});

test('owned close waits for a late input rejection before clearing uncertain feedback', async () => {
  await computerFixture(async ({ tools, activity, connection }) => {
    const taskId = randomUUID();
    activity.startTask(taskId);
    const observation = await observe(tools, taskId);
    const originalCall = connection.callProduct.bind(connection);
    const originalClose = connection.close.bind(connection);
    let failInput;
    let dispatched = false;
    /**
     * Holds only the input reply; all handshake and observation protocol remains real.
     */
    connection.callProduct = (name, input) => {
      if (name !== 'ExecutorInput') {
        return originalCall(name, input);
      }
      dispatched = true;
      return new Promise((_resolve, reject) => {
        failInput = reject;
      });
    };
    /**
     * Reproduces a queued input failure delivered after actual owned connection cleanup.
     */
    connection.close = async () => {
      const result = await originalClose();
      setImmediate(() => failInput(new Error('Owned backend exited before reply')));
      return result;
    };
    const pending = tools.call('owner', taskId, 'computer_key', {
      taskId,
      windowId: observation.windowId,
      observationId: observation.observationId,
      idempotencyKey: 'late-close-reply',
      key: 'Enter',
    });
    const refused = assert.rejects(pending, (error) => error.code === 'COMPUTER_RESULT_UNKNOWN');
    while (!dispatched) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    await tools.close();
    await refused;
    assert.equal(tools.available(), false);
    assert.equal(activity.snapshot().state, 'idle');
    assert.equal(activity.snapshot().activeCalls, 0);
    assert.equal(activity.snapshot().activeTasks, 0);
    connection.close = originalClose;
  });
});
