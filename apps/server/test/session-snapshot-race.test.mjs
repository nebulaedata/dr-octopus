/**
 * @author Codex
 * @description Verifies runtime snapshots reflect transitions during asynchronous resource loading.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { SessionRuntimeOperation } from '../dist/infrastructure/runtime/operation.js';
import { createSessionsService } from '../dist/modules/sessions/index.js';

/**
 * Pauses resource loading after the operation has captured its initial runtime binding.
 */
function createFixture(initialState) {
  const server = Fastify();
  const requested = Promise.withResolvers();
  const resume = Promise.withResolvers();
  let listener;
  let binding = {
    runtimeId: 'runtime-a',
    epoch: 1,
    workspaceId: 'workspace-a',
    workspaceCwd: '/tmp',
    agentSessionId: 'agent-a',
    sessionId: 'session-a',
    sessionPath: '/tmp/session-a.jsonl',
    state: initialState,
    lastActiveAt: 1,
  };
  const managed = {
    acquireOperation: () => () => {},
    getBinding: () => ({ ...binding }),
    getPermissionState: async () => ({ mode: 'full', scope: 'runtime-generation', persisted: false }),
    execute: async (command) => {
      const data =
        command.type === 'get_state'
          ? {
              isStreaming: initialState === 'running',
              isCompacting: false,
              pendingMessageCount: 0,
              thinkingLevel: 'off',
            }
          : { commands: [], levels: ['off'] };
      if (command.type === 'get_commands') {
        requested.resolve();
        await resume.promise;
      }
      return { type: 'response', command: command.type, success: true, data };
    },
  };
  const runtime = {
    onEvent: (callback) => {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
    getBindingBySessionId: managed.getBinding,
    getControl: () => ({ restartRequired: false, changedConfigRoutes: [], restart: { status: 'idle' } }),
    withExisting: async (_input, callback) => {
      const operation = new SessionRuntimeOperation(managed, 1, () => {});
      try {
        return await callback(operation);
      } finally {
        operation.release();
      }
    },
  };
  const session = {
    id: binding.sessionId,
    workspaceId: binding.workspaceId,
    agentSessionId: binding.agentSessionId,
    agentSessionPath: binding.sessionPath,
    preferences: { thinkingLevel: 'off' },
  };
  const service = createSessionsService(server, {
    runtime,
    workspaceService: { resolve: async () => ({ id: binding.workspaceId, cwd: '/tmp' }) },
    sessionsRepository: { get: () => session, getRow: () => session },
    messageFeedbackRepository: { listBySession: () => [] },
    piSessionsRepository: { getBranch: () => [] },
  });
  return {
    service,
    requested: requested.promise,
    /**
     * Publishes a transition before allowing the older resource query to finish.
     */
    transition(state) {
      binding = { ...binding, state, lastActiveAt: 2 };
      listener({
        type: 'runtime-state',
        runtimeId: binding.runtimeId,
        epoch: binding.epoch,
        workspaceId: binding.workspaceId,
        sessionId: binding.sessionId,
        sequence: 11,
        timestamp: '2026-09-17T06:00:00.000Z',
        payload: { state },
      });
      resume.resolve();
    },
    /**
     * Releases the service and server without opening any real Agent process.
     */
    async close() {
      service.dispose();
      await server.close();
    },
  };
}

for (const method of ['getSnapshot', 'getBootstrap']) {
  for (const [initialState, finalState] of [
    ['idle', 'running'],
    ['running', 'idle'],
  ]) {
    test(`${method} pairs the current sequence with ${finalState} after ${initialState} changes during loading`, async (t) => {
      const fixture = createFixture(initialState);
      t.after(() => fixture.close());
      const loading = fixture.service[method]('session-a');
      await fixture.requested;
      fixture.transition(finalState);
      const snapshot = await loading;
      assert.equal(snapshot.sequence, 11);
      assert.equal(snapshot.runtime.state, finalState);
      assert.equal(snapshot.runtime.lastActiveAt, 2);
      assert.equal(snapshot.session.runtime.state, snapshot.runtime.state);
      assert.equal(snapshot.runtime.epoch, 1);
      // The earlier RPC response must not override the more recent Host transition.
      assert.equal(snapshot.state.isStreaming, initialState === 'running');
      if (method === 'getBootstrap') {
        assert.equal(snapshot.readiness.runtimeId, snapshot.runtime.runtimeId);
        assert.equal(snapshot.readiness.epoch, snapshot.runtime.epoch);
      }
    });
  }
}

test('current binding reads preserve the operation generation fence and reject released handles', () => {
  let state = 'idle';
  let stale = false;
  const operation = new SessionRuntimeOperation(
    {
      acquireOperation: () => () => {},
      getBinding: () => ({ runtimeId: 'runtime-a', epoch: 1, state }),
    },
    1,
    () => {
      if (stale) throw new Error('stale generation');
    }
  );
  state = 'running';
  assert.equal(operation.binding.state, 'idle');
  assert.equal(operation.getCurrentBinding().state, 'running');
  stale = true;
  assert.throws(() => operation.getCurrentBinding(), /stale generation/);
  operation.release();
  assert.throws(() => operation.getCurrentBinding(), { code: 'SESSION_RUNTIME_STALE' });
});
