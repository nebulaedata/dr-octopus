/**
 * @author Codex
 * @description Verifies fail-closed pi-subagents widget parsing and bounded Host DTO projection.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { projectSubagentFleetPayload } from '../src/infrastructure/runtime/subagent-fleet-projection.ts';

const snapshot = {
  kind: 'pi-subagents.async-status-snapshot',
  version: 1,
  generatedAt: 1_000,
  caps: {
    maxRuns: 20,
    maxChildrenPerNode: 8,
    maxDepth: 3,
    maxStringLength: 160,
    maxSerializedBytes: 32_768,
  },
  omitted: { runs: 0, children: 0, byteLimitExceeded: false },
  runs: [
    {
      id: 'run-1',
      kind: 'workflow',
      label: 'Review workflow',
      state: 'running',
      startedAt: 500,
      activity: { currentTool: 'read', toolCount: 2 },
      children: [{ id: 'step-1', kind: 'step', label: 'reviewer', state: 'running' }],
    },
  ],
};

/**
 * Creates one RPC widget request carrying the supplied snapshot.
 */
function widgetPayload(value = snapshot) {
  return {
    type: 'extension_ui_request',
    id: 'widget-1',
    method: 'setWidget',
    widgetKey: 'subagent-async',
    widgetLines: [`PI_SUBAGENT_ASYNC_JSON:${JSON.stringify(value)}`],
  };
}

test('parses the versioned widget snapshot and discards extension-private fields', () => {
  const result = projectSubagentFleetPayload(widgetPayload());
  assert.equal(result.kind, 'snapshot');
  assert.equal(result.snapshot?.runs[0]?.label, 'Review workflow');
  assert.equal('caps' in result.snapshot, false);
});

test('fails closed for a recognized widget with an unsupported snapshot version', () => {
  assert.deepEqual(projectSubagentFleetPayload(widgetPayload({ ...snapshot, version: 2 })), {
    kind: 'invalid',
  });
  assert.deepEqual(projectSubagentFleetPayload({ method: 'notify', message: 'hello' }), {
    kind: 'unmatched',
  });
});

test('projects an undefined widget body as an explicit Fleet clear', () => {
  assert.deepEqual(
    projectSubagentFleetPayload({
      method: 'setWidget',
      widgetKey: 'subagent-async',
    }),
    { kind: 'snapshot', snapshot: undefined }
  );
});
