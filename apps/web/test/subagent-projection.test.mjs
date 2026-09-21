/**
 * @author Codex
 * @description Verifies structured Subagent ToolCard projection and realtime/bootstrap Fleet reconciliation.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  projectSubagentDetails,
  summarizeSubagent,
} from '../src/features/session/tool-renderers/CustomToolRenderers/index.ts';
import { resolveToolRenderer } from '../src/features/session/tool-renderers/registry.ts';
import { createSessionStore } from '../src/stores/session/store.ts';

const fleet = {
  kind: 'pi-subagents.async-status-snapshot',
  version: 1,
  generatedAt: 1_000,
  omitted: { runs: 0, children: 0, byteLimitExceeded: false },
  runs: [{ id: 'run-1', kind: 'subagent', label: 'reviewer', state: 'running' }],
};

/**
 * Creates a minimal authoritative Session snapshot.
 */
function sessionSnapshot(subagentFleet = undefined) {
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
    ...(subagentFleet === undefined ? {} : { subagentFleet }),
  };
}

test('merges live progress and terminal results by stable child index', () => {
  const tool = {
    id: 'tool-1',
    name: 'subagent',
    status: 'success',
    content: [],
    startedAt: 0,
    details: {
      mode: 'workflow',
      runId: 'run-1',
      progress: [{ index: 1, agent: 'reviewer', status: 'running', task: 'Review', currentTool: 'read' }],
      results: [
        {
          index: 1,
          agent: 'reviewer',
          task: 'Review',
          exitCode: 0,
          finalOutput: 'No blockers.',
          usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 0 },
        },
      ],
    },
  };

  assert.deepEqual(projectSubagentDetails(tool).children, [
    {
      index: 1,
      agent: 'reviewer',
      status: 'completed',
      task: 'Review',
      currentTool: 'read',
      tokens: 17,
      output: 'No blockers.',
    },
  ]);
  assert.equal(summarizeSubagent(tool), '1/1 completed');
  assert.equal(resolveToolRenderer('subagent').component.name, 'SubagentToolRenderer');
  assert.equal(resolveToolRenderer('bg_wait').component.name, 'SubagentToolRenderer');
});

test('hydrates, updates, and clears the Session Fleet projection', () => {
  const store = createSessionStore('session-1');
  store.getState().hydrate(sessionSnapshot(fleet));
  assert.equal(store.getState().subagentFleet?.runs[0]?.id, 'run-1');

  const updated = {
    ...fleet,
    generatedAt: 2_000,
    runs: [{ ...fleet.runs[0], state: 'complete' }],
  };
  store.getState().applyEvent({
    type: 'subagents.state',
    runtimeId: 'runtime-1',
    epoch: 1,
    workspaceId: 'workspace-1',
    sessionId: 'session-1',
    sequence: 2,
    timestamp: '2026-01-01T00:00:01.000Z',
    payload: updated,
  });
  assert.equal(store.getState().subagentFleet?.runs[0]?.state, 'complete');

  store.getState().applyEvent({
    type: 'subagents.state',
    runtimeId: 'runtime-1',
    epoch: 1,
    workspaceId: 'workspace-1',
    sessionId: 'session-1',
    sequence: 3,
    timestamp: '2026-01-01T00:00:02.000Z',
    payload: null,
  });
  assert.equal(store.getState().subagentFleet, undefined);
});
