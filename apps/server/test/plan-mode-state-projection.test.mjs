/**
 * @author Codex
 * @description Verifies persisted pi-plan-mode state projects into the transport-safe Session contract.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { projectPlanModeState } from '../dist/infrastructure/runtime/plan-mode-state-projection.js';

test('projects unavailable and enabled planning states without leaking the plan body', () => {
  assert.deepEqual(projectPlanModeState([], false), {
    available: false,
    workMode: 'agent',
    phase: 'off',
    awaitingAction: false,
  });
  assert.deepEqual(
    projectPlanModeState(
      [{ type: 'custom', customType: 'plan-mode-state', data: { enabled: true, latestPlan: '# secret' } }],
      true
    ),
    { available: true, workMode: 'plan', phase: 'ready', awaitingAction: false }
  );
});

test('uses the latest state entry and preserves implementation precedence', () => {
  const entries = [
    { type: 'custom', customType: 'plan-mode-state', data: { enabled: true } },
    {
      type: 'custom',
      customType: 'plan-mode-state',
      data: { enabled: false, savedPlan: '# saved', activeImplementation: { plan: '# active' } },
    },
  ];
  assert.deepEqual(projectPlanModeState(entries, true), {
    available: true,
    workMode: 'agent',
    phase: 'implementing',
    awaitingAction: false,
  });
});
