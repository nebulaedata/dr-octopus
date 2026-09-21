/**
 * @author Codex
 * @description Keeps invalid background ownership visible and rejects obsolete runtime observations.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionStore } from '../src/stores/session/store.ts';

test('invalid ownership remains distinguishable from absent extension and recovery clears it', () => {
  const store = createSessionStore('session');
  const event = {
    type: 'extension.ui',
    runtimeId: 'runtime',
    epoch: 1,
    sessionId: 'session',
    workspaceId: 'workspace',
    timestamp: new Date().toISOString(),
    payload: {},
  };
  const snapshot = {
    schemaVersion: 1,
    generation: 'generation',
    revision: 1,
    accepting: true,
    activeCount: 0,
    tasks: [],
  };
  store.getState().applyEvent({ ...event, sequence: 1, backgroundTasks: snapshot });
  assert.deepEqual(store.getState().backgroundTasks, snapshot);
  store.getState().applyEvent({ ...event, sequence: 2, backgroundTasks: null });
  assert.equal(store.getState().backgroundTasks, null);
  store.getState().applyEvent({ ...event, runtimeId: 'obsolete', sequence: 3, backgroundTasks: snapshot });
  assert.equal(store.getState().backgroundTasks, null);
  store
    .getState()
    .applyEvent({ ...event, type: 'agent.state', sequence: 3, payload: { state: 'recovering' } });
  assert.equal(store.getState().backgroundTasks, undefined);
});
