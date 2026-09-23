/**
 * @author Codex
 * @description Verifies fail-closed projection of pi-plan-mode 0.55.3 sequential questionnaire dialogs.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PlanModeQuestionnaireAdapter } from '../src/infrastructure/runtime/plan-mode-questionnaire-adapter.ts';

const questions = [
  {
    id: 'scope',
    header: 'Scope',
    question: 'Which scope should the plan cover?',
    options: [
      { label: 'Focused', description: 'Only the selected feature.' },
      { label: 'Complete', description: 'Include supporting changes.' },
    ],
  },
  {
    id: 'validation',
    header: 'Validation',
    question: 'How should it be verified?',
    options: [
      { label: 'Focused tests', description: 'Run affected tests.' },
      { label: 'Full checks', description: 'Run all quality gates.' },
    ],
  },
];

/**
 * Creates one managed-runtime event fixture.
 */
function hostEvent(type, payload, overrides = {}) {
  return {
    type,
    runtimeId: 'runtime-1',
    epoch: 1,
    workspaceId: 'workspace-1',
    sessionId: 'session-1',
    sequence: 1,
    timestamp: '2026-01-01T00:00:00.000Z',
    payload,
    ...overrides,
  };
}

/**
 * Starts one valid Plan question tool flow.
 */
function startFlow(adapter) {
  adapter.observe(
    hostEvent('agent-event', {
      type: 'tool_execution_start',
      toolCallId: 'tool-1',
      toolName: 'plan_mode_question',
      args: { questions },
    })
  );
}

test('projects Plan question copy and advances after an exact wire response', () => {
  const adapter = new PlanModeQuestionnaireAdapter();
  startFlow(adapter);
  const options = [
    '1. Focused — Only the selected feature.',
    '2. Complete — Include supporting changes.',
    'Other (free-form)',
  ];
  const projected = adapter.project(
    hostEvent('extension-ui', {
      type: 'extension_ui_request',
      id: 'dialog-1',
      method: 'select',
      title: 'Untrusted localized title',
      options,
    })
  );

  assert.equal(projected.hostQuestionnaire.adapter, 'pi-plan-mode');
  assert.equal(projected.hostQuestionnaire.title, questions[0].question);
  assert.deepEqual(projected.hostQuestionnaire.options[0], { id: '0', ...questions[0].options[0] });

  adapter.resolve('session-1', {
    type: 'extension_ui_response',
    id: 'dialog-1',
    value: options[1],
  });
  const next = adapter.project(
    hostEvent('extension-ui', {
      type: 'extension_ui_request',
      id: 'dialog-2',
      method: 'select',
      options: ['1. Focused tests', '2. Full checks', 'Other'],
    })
  );
  assert.equal(next.hostQuestionnaire.questionIndex, 1);
  assert.equal(next.hostQuestionnaire.header, 'Validation');
});

test('tracks the Other editor step without projecting unrelated editors', () => {
  const adapter = new PlanModeQuestionnaireAdapter();
  startFlow(adapter);
  const options = ['1. Focused', '2. Complete', 'Other'];
  adapter.project(hostEvent('extension-ui', { id: 'dialog-1', method: 'select', options }));
  adapter.resolve('session-1', {
    type: 'extension_ui_response',
    id: 'dialog-1',
    value: options[2],
  });
  const editor = hostEvent('extension-ui', { id: 'editor-1', method: 'editor' });
  assert.deepEqual(adapter.project(editor), editor.payload);
  adapter.resolve('session-1', {
    type: 'extension_ui_response',
    id: 'editor-1',
    value: 'Only API compatibility matters',
  });
  const next = adapter.project(
    hostEvent('extension-ui', {
      id: 'dialog-2',
      method: 'select',
      options: ['1. Focused tests', '2. Full checks', 'Other'],
    })
  );
  assert.equal(next.hostQuestionnaire.questionIndex, 1);
});

test('falls back for invalid structures and ambiguous concurrent flows', () => {
  const invalid = new PlanModeQuestionnaireAdapter();
  invalid.observe(
    hostEvent('agent-event', {
      type: 'tool_execution_start',
      toolCallId: 'invalid',
      toolName: 'plan_mode_question',
      args: { questions: [{ id: 'missing-options', header: 'Invalid', question: 'Invalid?' }] },
    })
  );
  const request = hostEvent('extension-ui', {
    id: 'dialog',
    method: 'select',
    options: ['one', 'two', 'other'],
  });
  assert.deepEqual(invalid.project(request), request.payload);

  const concurrent = new PlanModeQuestionnaireAdapter();
  startFlow(concurrent);
  concurrent.observe(
    hostEvent('agent-event', {
      type: 'tool_execution_start',
      toolCallId: 'tool-2',
      toolName: 'plan_mode_question',
      args: { questions },
    })
  );
  assert.deepEqual(concurrent.project(request), request.payload);
});
