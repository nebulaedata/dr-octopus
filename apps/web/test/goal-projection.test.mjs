/**
 * @author Codex
 * @description Verifies pi-goal ToolCard projection and realtime/bootstrap Goal reconciliation.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { projectGoalToolDetails } from '../src/features/session/utils/goal-projection.ts';
import { summarizeGoalTool } from '../src/features/session/utils/goal-projection.ts';
import { resolveToolRenderer } from './helpers/tool-renderer-selection.mjs';
import { createGoalClearCommand, GOAL_CLEAR_MESSAGE } from '../src/features/session/utils/goal-command.ts';
import { createSessionStore } from '../src/stores/session/store.ts';

const goal = {
  id: 'goal-1',
  objective: 'Ship the Goal adapter',
  status: 'active',
  startedAt: 1_000,
  updatedAt: 2_000,
  iteration: 1,
  tokensUsed: 200,
  timeUsedSeconds: 10,
  automaticModelTurns: 2,
};

/**
 * Creates a minimal authoritative Session snapshot.
 */
function sessionSnapshot(currentGoal = undefined) {
  return {
    session: {
      id: 'session-1',
      workspaceId: 'workspace-1',
      title: 'Session',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      preferences: {
        steeringMode: 'one-at-a-time',
        followUpMode: 'one-at-a-time',
        autoCompactionEnabled: true,
        autoRetryEnabled: true,
      },
    },
    thinking: { level: 'off', availableLevels: ['off'] },
    permission: { mode: 'ask', scope: 'runtime-generation', persisted: false },
    runtime: {
      runtimeId: 'runtime-1',
      epoch: 1,
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      state: 'idle',
      lastActiveAt: 0,
    },
    sequence: 1,
    messages: [],
    pendingExtensionUi: [],
    planMode: { available: true, workMode: 'agent', phase: 'off', awaitingAction: false },
    ...(currentGoal === undefined ? {} : { goal: currentGoal }),
  };
}

test('projects structured Goal blocker details and registers all Goal tools', () => {
  const tool = {
    id: 'tool-1',
    name: 'goal_blocked',
    status: 'success',
    content: [],
    startedAt: 0,
    details: {
      goal: 'Ship the Goal adapter',
      goal_id: 'goal-1',
      reason: 'CI credentials are unavailable',
      evidence: 'Three authenticated attempts returned 401.',
      repeated_turns: 3,
    },
  };

  assert.deepEqual(projectGoalToolDetails(tool), {
    goal: 'Ship the Goal adapter',
    goalId: 'goal-1',
    reason: 'CI credentials are unavailable',
    evidence: 'Three authenticated attempts returned 401.',
    repeatedTurns: 3,
  });
  assert.equal(summarizeGoalTool(tool), 'CI credentials are unavailable');
  for (const name of ['goal_complete', 'goal_blocked', 'goal_wait']) {
    assert.equal(resolveToolRenderer(name).component.name, 'GoalToolRenderer');
  }
});

test('hydrates, updates, and explicitly clears Goal state on ordinary runtime events', () => {
  const store = createSessionStore('session-1');
  store.getState().hydrate(sessionSnapshot(goal));
  assert.equal(store.getState().goal?.id, 'goal-1');

  store.getState().applyEvent({
    type: 'agent.event',
    runtimeId: 'runtime-1',
    epoch: 1,
    workspaceId: 'workspace-1',
    sessionId: 'session-1',
    sequence: 2,
    timestamp: '2026-01-01T00:00:01.000Z',
    payload: { type: 'agent_end' },
    goal: { ...goal, status: 'paused' },
  });
  assert.equal(store.getState().goal?.status, 'paused');

  store.getState().applyEvent({
    type: 'extension.ui',
    runtimeId: 'runtime-1',
    epoch: 1,
    workspaceId: 'workspace-1',
    sessionId: 'session-1',
    sequence: 3,
    timestamp: '2026-01-01T00:00:02.000Z',
    payload: { method: 'notify', message: 'Goal cleared' },
    goal: null,
  });
  assert.equal(store.getState().goal, undefined);
});

test('stopped Goal dismissal uses the canonical extension clear command', () => {
  assert.deepEqual(createGoalClearCommand('request-1', 'session-1', 'runtime-1', 2), {
    type: 'agent.prompt',
    requestId: 'request-1',
    sessionId: 'session-1',
    runtimeId: 'runtime-1',
    epoch: 2,
    payload: { message: GOAL_CLEAR_MESSAGE },
  });
  assert.equal(GOAL_CLEAR_MESSAGE, '/goal clear');
});
