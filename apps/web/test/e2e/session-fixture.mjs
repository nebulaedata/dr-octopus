/**
 * @author Codex
 * @description Supplies deterministic HTTP and WebSocket boundaries for browser Session regression tests.
 */
const workspace = { id: 'workspace-e2e', name: 'Interruption tests', slug: 'interruption-tests' };
const session = {
  id: 'session-e2e',
  workspaceId: workspace.id,
  title: 'Stop regression',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  preferences: {
    steeringMode: 'one-at-a-time',
    followUpMode: 'one-at-a-time',
    autoRetryEnabled: false,
    autoCompactionEnabled: false,
  },
};

/**
 * Drives the real application through its network protocol without touching user sessions or a paid model.
 */
export async function installSessionFixture(
  page,
  {
    partial = '',
    abortReason = 'aborted',
    holdStopReply = false,
    subagentFleet,
    backgroundTasks,
    initialMessages = [],
  } = {}
) {
  const runtime = {
    runtimeId: 'runtime-e2e',
    epoch: 1,
    workspaceId: workspace.id,
    sessionId: session.id,
    state: 'idle',
    lastActiveAt: 0,
  };
  let sequence = 0;
  let socket;
  let messages = initialMessages;
  let abortCount = 0;
  let stopRequestId;
  const assistant = { id: 'assistant-e2e', role: 'assistant', content: [], timestamp: 1767225601000 };
  /**
   * Returns the same authoritative transcript for history, bootstrap and reconnect snapshots.
   */
  function snapshot() {
    return {
      session,
      subagentFleet,
      backgroundTasks,
      runtime,
      sequence,
      messages,
      pendingExtensionUi: [],
      commands: [],
      models: [],
      readiness: { ready: true, runtimeId: runtime.runtimeId, epoch: runtime.epoch, resources: 'ready' },
      thinking: { level: 'off', availableLevels: ['off'] },
      permission: { mode: 'full', scope: 'runtime-generation', persisted: false },
      planMode: { available: false, workMode: 'agent', phase: 'off', awaitingAction: false },
    };
  }
  /**
   * Sends one ordered, fenced event through the application's actual WebSocket handler.
   */
  function emit(payload, type = 'agent.event', requestId) {
    socket.send(
      JSON.stringify({
        type,
        ...runtime,
        sequence: ++sequence,
        timestamp: new Date(1767225600000 + sequence * 100).toISOString(),
        payload,
        requestId,
      })
    );
  }
  /**
   * Publishes a terminal assistant message while intentionally delaying Agent settlement.
   */
  function finish(stopReason, errorMessage) {
    const message = {
      ...assistant,
      content: partial ? [{ type: 'text', text: partial }] : [],
      stopReason,
      errorMessage,
    };
    messages = [...messages.filter((item) => item.id !== assistant.id), message];
    emit({ type: 'message_end', message });
  }
  /**
   * Completes runtime cleanup independently of the assistant's terminal message.
   */
  function settle() {
    emit({ type: 'agent_settled' });
    runtime.state = 'idle';
    emit({ state: 'idle' }, 'agent.state');
    if (stopRequestId && !holdStopReply) {
      socket.send(JSON.stringify({ type: 'command.ack', requestId: stopRequestId, sessionId: session.id }));
    }
  }
  /**
   * Publishes new background work so the UI can clear a persisted dismissal.
   */
  function startBackgroundTask() {
    if (!backgroundTasks) return;
    backgroundTasks = {
      ...backgroundTasks,
      activeCount: 1,
      revision: backgroundTasks.revision + 1,
      tasks: [
        ...backgroundTasks.tasks,
        {
          taskId: '33333333-3333-4333-8333-333333333333',
          label: 'New preview server',
          state: 'running',
          createdAt: Date.now(),
        },
      ],
    };
    socket.send(
      JSON.stringify({
        type: 'extension.ui',
        ...runtime,
        sequence: ++sequence,
        timestamp: new Date().toISOString(),
        payload: {},
        backgroundTasks,
      })
    );
  }
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith('/api/')) {
      await route.continue();
      return;
    }
    let json = [];
    if (path === '/api/workspaces') json = [workspace];
    else if (path === '/api/conversation-models')
      json = {
        models: [
          {
            provider: 'fixture',
            id: 'fixture-model',
            name: 'Fixture model',
            reasoning: false,
            input: ['text'],
          },
        ],
        defaults: {
          configured: true,
          available: true,
          providerId: 'fixture',
          modelId: 'fixture-model',
          effect: 'new_sessions',
        },
      };
    else if (path === '/api/notifications') json = { items: [], unreadCount: 0, hasMore: false };
    else if (path.endsWith('/bootstrap') || path.endsWith('/snapshot')) json = snapshot();
    else if (path.endsWith('/start-receipt')) json = null;
    else if (path.endsWith('/history')) json = { sessionId: session.id, messages, messageFeedback: [] };
    else if (path.endsWith('/sessions')) json = [session];
    else if (path.endsWith(`/sessions/${session.id}`)) json = session;
    else if (path.endsWith('/files')) json = { entries: [] };
    else if (path.endsWith('/events')) {
      await route.fulfill({ contentType: 'text/event-stream', body: ': connected\n\n' });
      return;
    }
    await route.fulfill({ json });
  });
  await page.routeWebSocket('**/ws**', (ws) => {
    socket = ws;
    ws.onMessage((raw) => {
      const command = JSON.parse(String(raw));
      if (command.type === 'session.subscribe') {
        ws.send(
          JSON.stringify({
            type: 'session.subscribed',
            requestId: command.requestId,
            sessionId: session.id,
            runtime,
          })
        );
      } else if (command.type === 'agent.prompt') {
        if (command.payload.message.startsWith('/octopus-background ') && backgroundTasks) {
          const [, action, id] = command.payload.message.split(' ');
          if (action === 'logs')
            backgroundTasks = {
              ...backgroundTasks,
              logs: { taskId: id, text: 'server ready on localhost', truncated: false },
            };
          if (action === 'stop') {
            const tasks = backgroundTasks.tasks.map((task) =>
              task.taskId === id ? { ...task, state: 'stopped' } : task
            );
            backgroundTasks = {
              ...backgroundTasks,
              activeCount: tasks.filter((task) =>
                ['starting', 'running', 'stopping', 'unknown'].includes(task.state)
              ).length,
              tasks,
            };
          }
          backgroundTasks.revision++;
          ws.send(
            JSON.stringify({
              type: 'extension.ui',
              ...runtime,
              sequence: ++sequence,
              timestamp: new Date().toISOString(),
              payload: {},
              backgroundTasks,
            })
          );
          ws.send(
            JSON.stringify({ type: 'command.ack', requestId: command.requestId, sessionId: session.id })
          );
          return;
        }
        const user = {
          id: `user-${sequence}`,
          role: 'user',
          content: [{ type: 'text', text: command.payload.message }],
          timestamp: 1767225600000,
        };
        messages = [...messages, user];
        runtime.state = 'running';
        emit({ state: 'running' }, 'agent.state');
        emit({ type: 'message_start', message: user }, 'agent.event', command.requestId);
        emit({ type: 'message_end', message: user }, 'agent.event', command.requestId);
        emit({ type: 'message_start', message: assistant });
        if (partial)
          emit({
            type: 'message_update',
            assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: partial },
          });
      } else if (command.type === 'agent.abort') {
        abortCount += 1;
        stopRequestId = command.requestId;
        if (backgroundTasks) {
          backgroundTasks = {
            ...backgroundTasks,
            activeCount: 0,
            revision: backgroundTasks.revision + 1,
            tasks: backgroundTasks.tasks.map((task) =>
              ['starting', 'running', 'stopping', 'unknown'].includes(task.state)
                ? { ...task, state: 'stopped' }
                : task
            ),
          };
          ws.send(
            JSON.stringify({
              type: 'extension.ui',
              ...runtime,
              sequence: ++sequence,
              timestamp: new Date().toISOString(),
              payload: {},
              backgroundTasks,
            })
          );
          settle();
          return;
        }
        finish(abortReason, 'This operation was aborted');
        return;
      }
      ws.send(JSON.stringify({ type: 'command.ack', requestId: command.requestId, sessionId: session.id }));
    });
    ws.send(JSON.stringify({ type: 'connection.ready', protocolVersion: 5, connectionId: 'connection-e2e' }));
  });
  return {
    path: `/workspaces/${workspace.id}/sessions/${session.id}`,
    settle,
    finish,
    startBackgroundTask,
    getAbortCount: () => abortCount,
    failStop: () =>
      socket.send(
        JSON.stringify({
          type: 'error',
          requestId: stopRequestId,
          code: 'SESSION_RUNTIME_STALE',
          message: 'Background stop timed out',
        })
      ),
  };
}
