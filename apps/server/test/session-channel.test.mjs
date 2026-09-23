/**
 * @author Codex
 * @description Verifies transport-neutral Session channel subscriptions, event fan-out, bounds, and command orchestration.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { ChannelService } from '../dist/modules/channel/channel.service.js';

const serviceServer = Fastify();
test.after(() => serviceServer.close());

/**
 * Creates deterministic application-service doubles for Session channel tests.
 */
function createFixture(maxSubscriptions = 1) {
  const executions = [];
  let listener;
  let unsubscribed = false;
  let releasedSubscriptions = 0;
  let nextExecutionError;
  let executionGate;
  let nextSubscriptionGate;
  let extensionReply = () => {};
  let stateResponse = {
    success: true,
    command: 'get_state',
    data: { isStreaming: false, isCompacting: false, pendingMessageCount: 0 },
  };
  const sessionsService = {
    onEvent: (nextListener) => {
      listener = nextListener;
      return () => {
        unsubscribed = true;
      };
    },
    activate: async (sessionId) => ({
      runtimeId: `runtime-${sessionId}`,
      epoch: 3,
      workspaceId: 'workspace-a',
      sessionId,
      state: 'idle',
      lastActiveAt: 0,
    }),
    acquireSubscription: async (sessionId) => {
      const gate = nextSubscriptionGate;
      nextSubscriptionGate = undefined;
      await gate;
      return {
        runtime: {
          runtimeId: `runtime-${sessionId}`,
          epoch: 3,
          workspaceId: 'workspace-a',
          sessionId,
          state: 'idle',
          lastActiveAt: 0,
        },
        release: () => {
          releasedSubscriptions += 1;
        },
      };
    },
    execute: async (sessionId, command, expected) => {
      executions.push({ sessionId, command, expected });
      await executionGate;
      if (command.type === 'get_state') {
        if (stateResponse instanceof Error) throw stateResponse;
        return stateResponse;
      }
      if (nextExecutionError !== undefined) {
        const error = nextExecutionError;
        nextExecutionError = undefined;
        throw error;
      }
      return { success: true, command: command.type };
    },
    executeThinkingControl: async (sessionId, command, expected) => {
      executions.push({ sessionId, command, expected });
      return {
        level: command.type === 'set_thinking_level' && command.level === 'max' ? 'high' : 'medium',
        availableLevels: ['off', 'low', 'medium', 'high'],
      };
    },
    executePermissionControl: async (sessionId, mode, expected) => {
      executions.push({ sessionId, mode, expected });
      return { mode, scope: 'runtime-generation', persisted: false };
    },
    respondToExtensionUi: async () => extensionReply(),
  };
  const attachmentsService = {
    consume: (attachmentIds) => ({
      text: '',
      images: attachmentIds.map((id) => ({ type: 'image', data: id, mimeType: 'image/png' })),
    }),
  };
  const service = new ChannelService({ sessionsService, attachmentsService }, { maxSubscriptions });
  return {
    service,
    executions,
    onExtensionReply: (handler) => {
      extensionReply = handler;
    },
    setStateResponse: (value) => {
      stateResponse = value;
    },
    deferExecution: () => {
      let release;
      executionGate = new Promise((resolve) => {
        release = resolve;
      });
      return () => release();
    },
    emit: (event) => listener(event),
    rejectNextExecution: (error) => {
      nextExecutionError = error;
    },
    deferNextSubscription: () => {
      let release;
      nextSubscriptionGate = new Promise((resolve) => {
        release = resolve;
      });
      return () => release();
    },
    wasUnsubscribed: () => unsubscribed,
    releasedSubscriptions: () => releasedSubscriptions,
  };
}

/**
 * Creates one deterministic Pi user-message lifecycle envelope.
 */
function createUserMessageEvent(sessionId, sequence, type, id, text) {
  return {
    type: 'agent.event',
    runtimeId: `runtime-${sessionId}`,
    workspaceId: 'workspace-a',
    sessionId,
    sequence,
    timestamp: new Date(sequence).toISOString(),
    payload: {
      type,
      message: { id, role: 'user', content: [{ type: 'text', text }] },
    },
  };
}

test('Session channel fans events only to subscribed connections and clears disconnected state', async () => {
  const fixture = createFixture();
  const left = [];
  const right = [];
  fixture.service.connect('connection-a', (message) => left.push(message));
  fixture.service.connect('connection-b', (message) => right.push(message));

  await fixture.service.handleMessage('connection-a', {
    type: 'session.subscribe',
    requestId: 'request-a',
    sessionId: 'session-a',
  });
  await fixture.service.handleMessage('connection-b', {
    type: 'session.subscribe',
    requestId: 'request-b',
    sessionId: 'session-b',
  });
  fixture.emit({ type: 'agent.event', sessionId: 'session-a', payload: { text: 'hello' } });

  assert.equal(left.at(-1)?.type, 'agent.event');
  assert.equal(
    right.some((message) => message.type === 'agent.event'),
    false
  );

  fixture.service.disconnect('connection-a');
  assert.equal(fixture.releasedSubscriptions(), 1);
  fixture.emit({ type: 'agent.event', sessionId: 'session-a', payload: { text: 'ignored' } });
  assert.equal(left.filter((message) => message.type === 'agent.event').length, 1);
  fixture.service.close();
  assert.equal(fixture.releasedSubscriptions(), 2);
  assert.equal(fixture.wasUnsubscribed(), true);
});

test('Session channel enforces subscription bounds and maps prompt attachments to SessionsService', async () => {
  const fixture = createFixture();
  const messages = [];
  fixture.service.connect('connection-a', (message) => messages.push(message));
  await fixture.service.handleMessage('connection-a', {
    type: 'session.subscribe',
    requestId: 'subscribe-a',
    sessionId: 'session-a',
  });
  await assert.rejects(
    fixture.service.handleMessage('connection-a', {
      type: 'session.subscribe',
      requestId: 'subscribe-b',
      sessionId: 'session-b',
    }),
    /Subscription limit reached/
  );

  await fixture.service.handleMessage('connection-a', {
    type: 'agent.prompt',
    requestId: 'prompt-a',
    sessionId: 'session-a',
    runtimeId: 'runtime-session-a',
    epoch: 3,
    payload: { message: 'Inspect this', attachmentIds: ['image-a'] },
  });

  assert.deepEqual(fixture.executions, [
    {
      sessionId: 'session-a',
      command: {
        type: 'prompt',
        message: 'Inspect this',
        images: [{ type: 'image', data: 'image-a', mimeType: 'image/png' }],
      },
      expected: { runtimeId: 'runtime-session-a', epoch: 3 },
    },
  ]);
  assert.equal(messages.at(-1)?.type, 'command.ack');
  fixture.service.close();
});

test('Session channel resolves and forwards the authoritative Workspace cwd for attachment materialization', async () => {
  const executions = [];
  const resolutionInputs = [];
  const service = new ChannelService(
    {
      sessionsService: {
        onEvent: () => () => undefined,
        acquireSubscription: async () => ({
          runtime: {
            runtimeId: 'runtime-session-a',
            epoch: 3,
            workspaceId: 'workspace-a',
            sessionId: 'session-a',
            state: 'idle',
            lastActiveAt: 0,
          },
          release: () => undefined,
        }),
        getSession: () => ({ id: 'session-a', workspaceId: 'workspace-a' }),
        getActiveModelInputs: async () => new Set(['text']),
        execute: async (sessionId, command, expected) => {
          executions.push({ sessionId, command, expected });
        },
      },
      attachmentsService: {
        reservePrompt: () => [{ id: 'attachment-a' }],
        releasePrompt: () => undefined,
      },
      attachmentDeliveryService: {
        resolveForAgent: async (_items, input) => {
          resolutionInputs.push(input);
          return { promptSuffix: '<attachments />', images: [] };
        },
        releasePrompt: () => undefined,
      },
      resolveWorkspaceCwd: async (workspaceId) => {
        assert.equal(workspaceId, 'workspace-a');
        return 'D:\\workspaces\\workspace-a';
      },
    },
    { maxSubscriptions: 1 }
  );
  service.connect('connection-a', () => undefined);
  await service.handleMessage('connection-a', {
    type: 'session.subscribe',
    requestId: 'subscribe-a',
    sessionId: 'session-a',
  });

  await service.handleMessage('connection-a', {
    type: 'agent.prompt',
    requestId: 'prompt-a',
    sessionId: 'session-a',
    runtimeId: 'runtime-session-a',
    epoch: 3,
    payload: { message: 'Inspect this', attachmentIds: ['attachment-a'] },
  });

  assert.equal(resolutionInputs[0]?.workspaceCwd, 'D:\\workspaces\\workspace-a');
  assert.equal(
    executions[0]?.command.message,
    'Inspect this\n<host_attachment_request id="prompt-a" /><attachments />'
  );
  service.close();
});

test('Session channel acknowledges Pi effective thinking state after a requested level is clamped', async () => {
  const fixture = createFixture();
  const messages = [];
  fixture.service.connect('connection-a', (message) => messages.push(message));
  await fixture.service.handleMessage('connection-a', {
    type: 'session.subscribe',
    requestId: 'subscribe-a',
    sessionId: 'session-a',
  });

  await fixture.service.handleMessage('connection-a', {
    type: 'agent.set-thinking',
    requestId: 'thinking-a',
    sessionId: 'session-a',
    runtimeId: 'runtime-session-a',
    epoch: 3,
    payload: { level: 'max' },
  });

  assert.deepEqual(messages.at(-1), {
    type: 'command.ack',
    requestId: 'thinking-a',
    sessionId: 'session-a',
    thinking: {
      level: 'high',
      availableLevels: ['off', 'low', 'medium', 'high'],
    },
  });
  fixture.service.close();
});

test('Session channel acknowledges authoritative permission state for the fenced runtime', async () => {
  const fixture = createFixture();
  const messages = [];
  fixture.service.connect('connection-a', (message) => messages.push(message));
  await fixture.service.handleMessage('connection-a', {
    type: 'session.subscribe',
    requestId: 'subscribe-a',
    sessionId: 'session-a',
  });

  await fixture.service.handleMessage('connection-a', {
    type: 'agent.set-permission-mode',
    requestId: 'permission-a',
    sessionId: 'session-a',
    runtimeId: 'runtime-session-a',
    epoch: 3,
    payload: { mode: 'auto' },
  });

  assert.deepEqual(messages.at(-1), {
    type: 'command.ack',
    requestId: 'permission-a',
    sessionId: 'session-a',
    permission: { mode: 'auto', scope: 'runtime-generation', persisted: false },
  });
  assert.deepEqual(fixture.executions.at(-1), {
    sessionId: 'session-a',
    mode: 'auto',
    expected: { runtimeId: 'runtime-session-a', epoch: 3 },
  });
  fixture.service.close();
});

test('Session channel serializes commands behind subscription confirmation for the same Session', async () => {
  const fixture = createFixture();
  const messages = [];
  fixture.service.connect('connection-a', (message) => messages.push(message));
  const releaseSubscription = fixture.deferNextSubscription();
  const subscribing = fixture.service.handleMessage('connection-a', {
    type: 'session.subscribe',
    requestId: 'subscribe-a',
    sessionId: 'session-a',
  });
  const prompting = fixture.service.handleMessage('connection-a', {
    type: 'agent.prompt',
    requestId: 'prompt-a',
    sessionId: 'session-a',
    runtimeId: 'runtime-session-a',
    epoch: 3,
    payload: { message: 'Queued behind subscribe' },
  });

  await Promise.resolve();
  assert.equal(fixture.executions.length, 0);
  releaseSubscription();
  await Promise.all([subscribing, prompting]);

  assert.equal(fixture.executions.length, 1);
  assert.deepEqual(
    messages
      .filter((message) => message.type === 'session.subscribed' || message.type === 'command.ack')
      .map((message) => message.type),
    ['session.subscribed', 'command.ack']
  );
  fixture.service.close();
});

test('Session channel rejects commands without a confirmed subscription', async () => {
  const fixture = createFixture();
  fixture.service.connect('connection-a', () => undefined);

  await assert.rejects(
    fixture.service.handleMessage('connection-a', {
      type: 'agent.prompt',
      requestId: 'prompt-a',
      sessionId: 'session-a',
      runtimeId: 'runtime-session-a',
      epoch: 1,
      payload: { message: 'Must not execute' },
    }),
    (error) => error?.code === 'SESSION_RUNTIME_BINDING_MISMATCH'
  );
  assert.equal(fixture.executions.length, 0);
  fixture.service.close();
});

test('Session channel correlates identical prompts across connections by request identity', async () => {
  const fixture = createFixture();
  const left = [];
  const right = [];
  fixture.service.connect('connection-a', (message) => left.push(message));
  fixture.service.connect('connection-b', (message) => right.push(message));
  await fixture.service.handleMessage('connection-a', {
    type: 'session.subscribe',
    requestId: 'subscribe-a',
    sessionId: 'session-a',
  });
  await fixture.service.handleMessage('connection-b', {
    type: 'session.subscribe',
    requestId: 'subscribe-b',
    sessionId: 'session-a',
  });
  await fixture.service.handleMessage('connection-a', {
    type: 'agent.prompt',
    requestId: 'prompt-a',
    sessionId: 'session-a',
    payload: { message: 'same prompt' },
  });
  await fixture.service.handleMessage('connection-b', {
    type: 'agent.prompt',
    requestId: 'prompt-b',
    sessionId: 'session-a',
    payload: { message: 'same prompt' },
  });

  fixture.emit(createUserMessageEvent('session-a', 1, 'message_start', 'user-a', 'same prompt'));
  fixture.emit(createUserMessageEvent('session-a', 2, 'message_end', 'user-a', 'same prompt'));
  fixture.emit(createUserMessageEvent('session-a', 3, 'message_start', 'user-b', 'same prompt'));
  fixture.emit(createUserMessageEvent('session-a', 4, 'message_end', 'user-b', 'same prompt'));

  const leftEvents = left.filter((message) => message.type === 'agent.event');
  const rightEvents = right.filter((message) => message.type === 'agent.event');
  assert.deepEqual(
    leftEvents.map((event) => event.requestId),
    ['prompt-a', 'prompt-a', 'prompt-b', 'prompt-b']
  );
  assert.deepEqual(
    rightEvents.map((event) => event.requestId),
    ['prompt-a', 'prompt-a', 'prompt-b', 'prompt-b']
  );
  fixture.service.close();
});

test('Session channel correlates a prompt after staged file text is appended', async () => {
  const fixture = createFixture();
  const messages = [];
  fixture.service.connect('connection-a', (message) => messages.push(message));
  await fixture.service.handleMessage('connection-a', {
    type: 'session.subscribe',
    requestId: 'subscribe-a',
    sessionId: 'session-a',
  });
  await fixture.service.handleMessage('connection-a', {
    type: 'agent.prompt',
    requestId: 'prompt-with-file',
    sessionId: 'session-a',
    payload: { message: 'Inspect this file' },
  });

  fixture.emit(
    createUserMessageEvent(
      'session-a',
      1,
      'message_start',
      'user-with-file',
      'Inspect this file\n\n<file name="notes.md">\ncontent\n</file>\n'
    )
  );

  assert.equal(messages.at(-1)?.requestId, 'prompt-with-file');
  fixture.service.close();
});

test('Session channel hides Host attachment context and Pi attachment blocks from Web', async () => {
  const fixture = createFixture();
  const messages = [];
  fixture.service.connect('connection-a', (message) => messages.push(message));
  await fixture.service.handleMessage('connection-a', {
    type: 'session.subscribe',
    requestId: 'subscribe-a',
    sessionId: 'session-a',
  });
  await fixture.service.handleMessage('connection-a', {
    type: 'agent.prompt',
    requestId: 'prompt-with-attachment',
    sessionId: 'session-a',
    payload: { message: 'Inspect this file' },
  });

  fixture.emit({
    ...createUserMessageEvent(
      'session-a',
      1,
      'message_start',
      'user-with-attachment',
      'Inspect this file\n<host_attachment_request id="prompt-with-attachment" />\n<host_attachments>private</host_attachments>'
    ),
    payload: {
      type: 'message_start',
      message: {
        id: 'user-with-attachment',
        role: 'user',
        content: [
          { type: 'image', data: 'private-base64', mimeType: 'image/png' },
          {
            type: 'text',
            text: 'Inspect this file\n<host_attachment_request id="prompt-with-attachment" />\n<host_attachments>private</host_attachments>',
          },
        ],
      },
    },
  });

  const event = messages.at(-1);
  assert.equal(event.requestId, 'prompt-with-attachment');
  assert.deepEqual(event.payload.message.content, [{ type: 'text', text: 'Inspect this file' }]);
  fixture.service.close();
});

test('command completion is confirmed after handler acknowledgement, independently of output', async () => {
  for (const output of ['notify', 'custom', 'silent']) {
    const fixture = createFixture();
    const messages = [];
    fixture.service.connect('connection-a', (message) => messages.push(message));
    await fixture.service.handleMessage('connection-a', {
      type: 'session.subscribe',
      requestId: 'subscribe-a',
      sessionId: 'session-a',
    });
    const release = fixture.deferExecution();
    const pending = fixture.service.handleMessage('connection-a', {
      type: 'agent.prompt',
      requestId: 'extension-request',
      sessionId: 'session-a',
      payload: { message: '/any-extension' },
    });
    await new Promise((resolve) => setImmediate(resolve));
    if (output !== 'silent') {
      fixture.emit({
        type: output === 'notify' ? 'extension.ui' : 'agent.event',
        runtimeId: 'runtime-session-a',
        epoch: 3,
        workspaceId: 'workspace-a',
        sessionId: 'session-a',
        sequence: 1,
        timestamp: '2026-01-01T00:00:01.000Z',
        payload:
          output === 'notify'
            ? { method: 'notify', message: 'Still processing' }
            : {
                type: 'message_end',
                message: {
                  role: 'custom',
                  customType: 'unrelated-business-output',
                  content: 'Progress',
                  display: true,
                },
              },
      });
      assert.equal(messages.at(-1).requestId, undefined);
    }
    assert.ok(!messages.some((message) => message.type === 'command.ack' && message.completion));
    release();
    await pending;
    const ack = messages.at(-1);
    assert.equal(ack.type, 'command.ack');
    assert.equal(ack.requestId, 'extension-request');
    assert.equal(ack.completion.runtimeId, 'runtime-session-a');
    assert.equal(ack.completion.epoch, 3);
    assert.ok(Number.isFinite(Date.parse(ack.completion.timestamp)));
    assert.deepEqual(fixture.executions.at(-1).expected, { runtimeId: 'runtime-session-a', epoch: 3 });
    fixture.service.close();
  }
});

test('accepted slash prompts with inference, compaction, queued or unknown state are not reported complete', async () => {
  for (const data of [
    { isStreaming: true, isCompacting: false, pendingMessageCount: 0 },
    { isStreaming: false, isCompacting: true, pendingMessageCount: 0 },
    { isStreaming: false, isCompacting: false, pendingMessageCount: 1 },
    {},
    undefined,
  ]) {
    const fixture = createFixture();
    fixture.setStateResponse({ success: true, command: 'get_state', data });
    const messages = [];
    fixture.service.connect('connection-a', (message) => messages.push(message));
    await fixture.service.handleMessage('connection-a', {
      type: 'session.subscribe',
      requestId: 's',
      sessionId: 'session-a',
    });
    await fixture.service.handleMessage('connection-a', {
      type: 'agent.prompt',
      requestId: 'p',
      sessionId: 'session-a',
      payload: { message: '/template' },
    });
    assert.equal(messages.at(-1).type, 'command.ack');
    assert.equal(messages.at(-1).completion, undefined);
    fixture.service.close();
  }
});

test('failed state observation does not reject or replay an already accepted command', async () => {
  const fixture = createFixture();
  fixture.setStateResponse(new Error('runtime replaced'));
  const messages = [];
  fixture.service.connect('connection-a', (message) => messages.push(message));
  await fixture.service.handleMessage('connection-a', {
    type: 'session.subscribe',
    requestId: 's',
    sessionId: 'session-a',
  });
  const command = {
    type: 'agent.prompt',
    requestId: 'p',
    sessionId: 'session-a',
    payload: { message: '/silent' },
  };
  await fixture.service.handleMessage('connection-a', command);
  await fixture.service.handleMessage('connection-a', command);
  assert.equal(messages.at(-1).type, 'command.ack');
  assert.equal(messages.at(-1).completion, undefined);
  assert.equal(fixture.executions.filter(({ command }) => command.type === 'prompt').length, 1);
  fixture.service.close();
});

test('a first-message slash command publishes the same fenced completion to its subscribers', async () => {
  const fixture = createFixture();
  const messages = [];
  fixture.service.connect('connection-a', (message) => messages.push(message));
  await fixture.service.handleMessage('connection-a', {
    type: 'session.subscribe',
    requestId: 's',
    sessionId: 'session-a',
  });
  const message = {
    type: 'agent.prompt',
    requestId: 'first',
    sessionId: 'session-a',
    runtimeId: 'runtime-session-a',
    epoch: 3,
    payload: { message: '/silent-extension' },
  };
  await fixture.service.dispatchFirstMessage(message, { type: 'prompt', message: message.payload.message });
  assert.equal(messages.at(-1).type, 'command.ack');
  assert.equal(messages.at(-1).requestId, 'first');
  assert.equal(messages.at(-1).completion.runtimeId, 'runtime-session-a');
  fixture.service.close();
});

test(
  'extension UI replies unblock the command at the head of the same Session queue',
  { timeout: 3000 },
  async (t) => {
    const fixture = createFixture();
    const messages = [];
    fixture.service.connect('connection-a', (message) => messages.push(message));
    await fixture.service.handleMessage('connection-a', {
      type: 'session.subscribe',
      requestId: 's',
      sessionId: 'session-a',
    });
    const release = fixture.deferExecution();
    t.after(() => {
      release();
      fixture.service.close();
    });
    fixture.onExtensionReply(release);
    const command = fixture.service.handleMessage('connection-a', {
      type: 'agent.prompt',
      requestId: 'ask',
      sessionId: 'session-a',
      payload: { message: '/interactive' },
    });
    await new Promise((resolve) => setImmediate(resolve));
    await fixture.service.handleMessage('connection-a', {
      type: 'extension.ui.response',
      requestId: 'reply',
      sessionId: 'session-a',
      runtimeId: 'runtime-session-a',
      epoch: 3,
      payload: { extensionRequestId: 'dialog', confirmed: true },
    });
    await command;
    assert.ok(messages.some((message) => message.requestId === 'reply' && message.type === 'command.ack'));
    assert.ok(messages.some((message) => message.requestId === 'ask' && message.completion));
  }
);

test('Session channel correlates steering before an earlier identical follow-up', async () => {
  const fixture = createFixture();
  const messages = [];
  fixture.service.connect('connection-a', (message) => messages.push(message));
  await fixture.service.handleMessage('connection-a', {
    type: 'session.subscribe',
    requestId: 'subscribe-a',
    sessionId: 'session-a',
  });
  await fixture.service.handleMessage('connection-a', {
    type: 'agent.follow-up',
    requestId: 'follow-up-a',
    sessionId: 'session-a',
    payload: { message: 'queued prompt' },
  });
  await fixture.service.handleMessage('connection-a', {
    type: 'agent.steer',
    requestId: 'steer-a',
    sessionId: 'session-a',
    payload: { message: 'queued prompt' },
  });

  fixture.emit(createUserMessageEvent('session-a', 1, 'message_start', 'steer-user', 'queued prompt'));
  fixture.emit(createUserMessageEvent('session-a', 2, 'message_end', 'steer-user', 'queued prompt'));
  fixture.emit(createUserMessageEvent('session-a', 3, 'message_start', 'follow-up-user', 'queued prompt'));
  fixture.emit(createUserMessageEvent('session-a', 4, 'message_end', 'follow-up-user', 'queued prompt'));

  assert.deepEqual(
    messages.filter((message) => message.type === 'agent.event').map((event) => event.requestId),
    ['steer-a', 'steer-a', 'follow-up-a', 'follow-up-a']
  );
  fixture.service.close();
});

test('Session channel removes rejected commands before correlating later identical prompts', async () => {
  const fixture = createFixture();
  const messages = [];
  fixture.service.connect('connection-a', (message) => messages.push(message));
  await fixture.service.handleMessage('connection-a', {
    type: 'session.subscribe',
    requestId: 'subscribe-a',
    sessionId: 'session-a',
  });
  fixture.rejectNextExecution(new Error('Rejected prompt'));
  await assert.rejects(
    fixture.service.handleMessage('connection-a', {
      type: 'agent.prompt',
      requestId: 'rejected-prompt',
      sessionId: 'session-a',
      payload: { message: 'same prompt' },
    }),
    /Rejected prompt/
  );
  await fixture.service.handleMessage('connection-a', {
    type: 'agent.prompt',
    requestId: 'accepted-prompt',
    sessionId: 'session-a',
    payload: { message: 'same prompt' },
  });

  fixture.emit(createUserMessageEvent('session-a', 1, 'message_start', 'accepted-user', 'same prompt'));
  fixture.emit(createUserMessageEvent('session-a', 2, 'message_end', 'accepted-user', 'same prompt'));

  assert.deepEqual(
    messages.filter((message) => message.type === 'agent.event').map((event) => event.requestId),
    ['accepted-prompt', 'accepted-prompt']
  );
  fixture.service.close();
});

test('Session channel executes a duplicate mutation request identity exactly once', async () => {
  const fixture = createFixture();
  const messages = [];
  fixture.service.connect('connection-a', (message) => messages.push(message));
  await fixture.service.handleMessage('connection-a', {
    type: 'session.subscribe',
    requestId: 'subscribe-a',
    sessionId: 'session-a',
  });
  const prompt = {
    type: 'agent.prompt',
    requestId: 'idempotent-prompt',
    sessionId: 'session-a',
    payload: { message: 'execute once' },
  };

  await Promise.all([
    fixture.service.handleMessage('connection-a', prompt),
    fixture.service.handleMessage('connection-a', prompt),
  ]);

  assert.equal(fixture.executions.length, 1);
  assert.equal(messages.filter((message) => message.type === 'command.ack').length, 2);
  await assert.rejects(
    fixture.service.handleMessage('connection-a', {
      ...prompt,
      payload: { message: 'conflicting payload' },
    }),
    (error) => error?.code === 'MUTATION_IDEMPOTENCY_CONFLICT'
  );
  fixture.service.close();
});

test('focus is connection scoped, validated, immediate during commands and cleared on disconnect', async () => {
  const { decodeClientMessage } = await import('../dist/modules/channel/channel.dto.js');
  assert.equal(
    decodeClientMessage(JSON.stringify({ type: 'session.focus', requestId: 'f', sessionId: null })).sessionId,
    null
  );
  for (const sessionId of [undefined, '', 1, false]) {
    assert.throws(() =>
      decodeClientMessage(JSON.stringify({ type: 'session.focus', requestId: 'f', sessionId }))
    );
  }
  const fixture = createFixture(2);
  const service = fixture.service;
  try {
    service.connect('one', () => {});
    service.connect('two', () => {});
    await assert.rejects(
      service.handleMessage('one', { type: 'session.focus', requestId: 'bad', sessionId: 'a' })
    );
    for (const connection of ['one', 'two']) {
      await service.handleMessage(connection, { type: 'session.subscribe', requestId: 's', sessionId: 'a' });
      assert.equal(service.isSessionFocused('a'), connection === 'two');
      await service.handleMessage(connection, { type: 'session.focus', requestId: 'f', sessionId: 'a' });
    }
    service.disconnect('two');
    assert.equal(service.isSessionFocused('a'), true);
    const release = fixture.deferExecution();
    const command = service.handleMessage('one', {
      type: 'agent.compact',
      requestId: 'long',
      sessionId: 'a',
    });
    await service.handleMessage('one', { type: 'session.focus', requestId: 'blur', sessionId: null });
    assert.equal(service.isSessionFocused('a'), false);
    release();
    await command;
    await service.handleMessage('one', { type: 'session.subscribe', requestId: 'b', sessionId: 'b' });
    await service.handleMessage('one', { type: 'session.focus', requestId: 'fb', sessionId: 'b' });
    assert.equal(service.isSessionFocused('a'), false);
    assert.equal(service.isSessionFocused('b'), true);
    await service.handleMessage('one', { type: 'session.unsubscribe', requestId: 'ub', sessionId: 'b' });
    assert.equal(service.isSessionFocused('b'), false);
    await service.handleMessage('one', { type: 'session.focus', requestId: 'fa', sessionId: 'a' });
    service.disconnect('one');
    assert.equal(service.isSessionFocused('a'), false);
  } finally {
    service.close();
  }
});
