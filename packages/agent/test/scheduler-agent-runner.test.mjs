/**
 * @author Codex
 * @description Deterministic isolated Runner tests without starting Pi or calling a model.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentSchedulerRunner } from '../dist/extensions/scheduler/infrastructure/agent-runner.js';

/**
 * Create one frozen work item for the fake process boundary.
 */
function work(overrides = {}) {
  return {
    runId: 'run-a',
    taskId: 'task-a',
    attemptId: 'attempt-a',
    workspaceId: 'workspace-a',
    cwd: 'D:\\workspace-a',
    originSessionRef: 'origin-a',
    prompt: 'Review the repository.',
    configRevision: 'config-a',
    timeoutMs: 1000,
    scheduledFor: '2026-09-05T00:00:00.000Z',
    overlapPolicy: 'queue-one',
    ...overrides,
  };
}

/**
 * Provide the AgentRpcProcess surface while allowing each test to choose prompt events.
 */
function fakeProcess(onPrompt = () => undefined) {
  const eventListeners = new Set();
  const lifecycleListeners = new Set();
  const commands = [];
  const uiResponses = [];
  let stopped = 0;
  let activeSessionId = 'session-a';
  return {
    process: {
      async start() {},
      async stop() {
        stopped += 1;
      },
      async execute(command) {
        commands.push(command);
        if (command.type === 'prompt') {
          for (const listener of eventListeners) listener({ type: 'agent_start' });
          onPrompt({ eventListeners, lifecycleListeners });
          return { type: 'response', command: 'prompt', success: true };
        }
        if (command.type === 'get_entries') {
          return {
            type: 'response',
            command: 'get_entries',
            success: true,
            data: {
              entries: [
                {
                  type: 'custom',
                  customType: 'octopus-permission-execution',
                  data: { sessionId: activeSessionId, attemptId: 'attempt-a', ready: true, tools: [] },
                },
                {
                  type: 'message',
                  id: 'prompt-entry-a',
                  message: { role: 'user', content: '[Octopus Scheduler Run]\nrunId: run-a' },
                },
                { type: 'message', id: 'assistant-entry-a', message: { role: 'assistant', content: '' } },
              ],
              leafId: 'assistant-entry-a',
            },
          };
        }
        if (command.type === 'get_last_assistant_text') {
          return {
            type: 'response',
            command: 'get_last_assistant_text',
            success: true,
            data: { text: 'Completed repository review.' },
          };
        }
        return { type: 'response', command: command.type, success: true };
      },
      onEvent(listener) {
        eventListeners.add(listener);
        return () => eventListeners.delete(listener);
      },
      onLifecycle(listener) {
        lifecycleListeners.add(listener);
        return () => lifecycleListeners.delete(listener);
      },
      getLastSessionState() {
        return { sessionId: activeSessionId, sessionFile: `D:\\runs\\${activeSessionId}.jsonl` };
      },
      async respondToExtensionUi(response) {
        uiResponses.push(response);
      },
    },
    commands,
    uiResponses,
    stopped: () => stopped,
    setSessionId: (value) => {
      activeSessionId = value;
    },
  };
}

test('Runner persists barriers before resolving a bounded successful summary', async () => {
  const fake = fakeProcess(({ eventListeners }) => {
    queueMicrotask(() => {
      for (const listener of eventListeners) {
        listener({
          type: 'message_end',
          message: { role: 'assistant', stopReason: 'stop' },
        });
        listener({ type: 'agent_settled' });
      }
    });
  });
  const barriers = [];
  const runner = new AgentSchedulerRunner('D:\\agent', 'D:\\agent\\scheduler', (_work, sessionId) => {
    fake.setSessionId(sessionId);
    return fake.process;
  });
  const outcome = await runner.run(work(), new AbortController().signal, {
    dispatch(evidence) {
      barriers.push(['dispatch', evidence]);
      return true;
    },
    running(entryId) {
      barriers.push(['running', entryId]);
      return true;
    },
  });

  assert.equal(outcome.status, 'succeeded');
  assert.equal(outcome.summary, 'Completed repository review.');
  assert.deepEqual(
    barriers.map((item) => item[0]),
    ['dispatch', 'running']
  );
  assert.match(fake.commands.find((item) => item.type === 'prompt').message, /runId: run-a/);
  assert.equal(fake.stopped(), 1);
});

test('interactive requests settle as needs_attention and cancel the pending Pi prompt', async () => {
  const fake = fakeProcess(({ eventListeners }) => {
    queueMicrotask(() => {
      for (const listener of eventListeners) {
        listener({ type: 'extension_ui_request', id: 'ui-a', method: 'confirm' });
      }
    });
  });
  const runner = new AgentSchedulerRunner('D:\\agent', 'D:\\agent\\scheduler', (_work, sessionId) => {
    fake.setSessionId(sessionId);
    return fake.process;
  });
  const outcome = await runner.run(work(), new AbortController().signal, {
    dispatch: () => true,
    running: () => true,
  });

  assert.equal(outcome.status, 'needs_attention');
  assert.equal(outcome.errorCode, 'SCHEDULE_INPUT_REQUIRED');
  assert.ok(fake.commands.some((item) => item.type === 'abort'));
  assert.deepEqual(fake.uiResponses, [{ type: 'extension_ui_response', id: 'ui-a', cancelled: true }]);
});

test('absolute execution timeout aborts and closes a non-settling Runner', async () => {
  const fake = fakeProcess();
  const runner = new AgentSchedulerRunner('D:\\agent', 'D:\\agent\\scheduler', (_work, sessionId) => {
    fake.setSessionId(sessionId);
    return fake.process;
  });
  const outcome = await runner.run(work({ timeoutMs: 10 }), new AbortController().signal, {
    dispatch: () => true,
    running: () => true,
  });

  assert.equal(outcome.status, 'timed_out');
  assert.equal(outcome.errorCode, 'SCHEDULE_EXECUTION_TIMEOUT');
  assert.ok(fake.commands.some((item) => item.type === 'abort'));
  assert.equal(fake.stopped(), 1);
});

test('missing permission readiness stops before dispatch and prompt', async () => {
  const fake = fakeProcess();
  const execute = fake.process.execute;
  fake.process.execute = async (command) =>
    command.type === 'get_entries'
      ? { type: 'response', command: 'get_entries', success: true, data: { entries: [] } }
      : execute(command);
  const runner = new AgentSchedulerRunner('D:\\agent', 'D:\\agent\\scheduler', (_work, sessionId) => {
    fake.setSessionId(sessionId);
    return fake.process;
  });
  const outcome = await runner.run(work(), new AbortController().signal, {
    dispatch: () => {
      assert.fail('must not dispatch without permission readiness');
    },
    running: () => true,
  });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.errorCode, 'SCHEDULE_AUTHORIZATION_UNAVAILABLE');
  assert.equal(
    fake.commands.some((command) => command.type === 'prompt'),
    false
  );
  assert.equal(fake.stopped(), 1);
});
