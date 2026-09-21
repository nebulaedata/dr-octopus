/**
 * @author Codex
 * @description Guards mode transition acknowledgements and knowledge renderer routing in ordinary Sessions.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionStore } from '../src/stores/session/store.ts';
import { resolveToolRenderer } from '../src/features/session/tool-renderers/registry.ts';

test('intermediate mode events keep Composer locked until the matching acknowledgement', () => {
  const store = createSessionStore('session');
  store.setState({ hydrated: true, loadState: 'ready', runtimeId: 'runtime', epoch: 1, lastSequence: 1 });
  store.getState().beginWorkModeChange('request', 'knowledge');
  store
    .getState()
    .applyEvent({
      type: 'extension.ui',
      sessionId: 'session',
      runtimeId: 'runtime',
      epoch: 1,
      sequence: 2,
      payload: { method: 'setStatus', statusKey: 'octopus-knowledge-mode' },
      planMode: { available: true, workMode: 'agent', phase: 'off', awaitingAction: false },
    });
  assert.equal(store.getState().pendingWorkMode.requestId, 'request');
  const complete = { available: true, workMode: 'knowledge', phase: 'off', awaitingAction: false };
  store.getState().setPlanMode(complete, 'older-request');
  assert.equal(store.getState().pendingWorkMode.requestId, 'request');
  store.getState().setPlanMode(complete, 'request');
  assert.equal(store.getState().pendingWorkMode, undefined);
});

test('knowledge source evidence uses its renderer while unknown tools retain fallback', () => {
  assert.equal(resolveToolRenderer('knowledge_search').component.name, 'KnowledgeToolRenderer');
  assert.equal(resolveToolRenderer('unrelated_tool').component.name, 'FallbackToolRenderer');
});
