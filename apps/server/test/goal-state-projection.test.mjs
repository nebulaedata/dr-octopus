/**
 * @author Codex
 * @description Verifies fail-closed projection of pi-goal 0.54.3 Session state entries.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { projectGoalState } from '../src/lib/runtime/goal-state-projection.ts';

const goal = {
  id: 'goal-1',
  text: 'Ship the Goal adapter',
  status: 'active',
  startedAt: 1_000,
  updatedAt: 2_000,
  iteration: 2,
  tokenBudget: 100_000,
  tokensUsed: 12_000,
  timeUsedSeconds: 42.5,
  baselineTokens: 500,
  automaticModelTurns: 3,
  toolFreeRepeatCount: 1,
  lastToolFreeOutputFingerprint: 'private-runtime-field',
  waiting: { reason: 'Waiting for CI', resumeAt: 60_000 },
};

/**
 * Creates one Pi custom entry with the canonical vendor discriminator.
 */
function goalEntry(value) {
  return {
    type: 'custom',
    id: crypto.randomUUID(),
    parentId: null,
    timestamp: new Date().toISOString(),
    customType: 'goal-state',
    data: { goal: value },
  };
}

test('projects the latest Goal while omitting extension-private accounting fields', () => {
  const projected = projectGoalState([goalEntry({ ...goal, status: 'paused' }), goalEntry(goal)]);

  assert.deepEqual(projected, {
    id: 'goal-1',
    objective: 'Ship the Goal adapter',
    status: 'active',
    startedAt: 1_000,
    updatedAt: 2_000,
    iteration: 2,
    tokenBudget: 100_000,
    tokensUsed: 12_000,
    timeUsedSeconds: 42.5,
    automaticModelTurns: 3,
    waiting: { reason: 'Waiting for CI', resumeAt: 60_000 },
  });
  assert.equal('baselineTokens' in projected, false);
  assert.equal('lastToolFreeOutputFingerprint' in projected, false);
});

test('treats a canonical clear entry and invalid state as no visible Goal', () => {
  assert.equal(projectGoalState([goalEntry(goal), goalEntry(null)]), undefined);
  assert.equal(projectGoalState([goalEntry({ ...goal, status: 'complete' })]), undefined);
  assert.equal(projectGoalState([goalEntry({ ...goal, tokenBudget: -1 })]), undefined);
});
