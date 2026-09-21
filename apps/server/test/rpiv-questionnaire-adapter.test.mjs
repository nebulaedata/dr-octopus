/**
 * @author Codex
 * @description Verifies versioned, fail-closed projection of rpiv 2.7.1 questionnaire RPC dialogs.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { RpivQuestionnaireAdapter } from '../src/lib/runtime/rpiv-questionnaire-adapter.ts';

const questions = [
  {
    question: 'Choose a direction?',
    header: 'Direction',
    options: [
      { label: 'Timeline', description: 'Show tool calls.' },
      { label: 'Approvals', description: 'Add checkpoints.' },
    ],
  },
  {
    question: 'What context should be inspected?',
    header: 'Context',
    multiSelect: true,
    options: [
      { label: 'Source', description: 'Relevant source files.' },
      { label: 'Tests', description: 'Existing tests.' },
      { label: 'Docs', description: 'Architecture documentation.' },
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
 * Registers one valid rpiv tool execution.
 */
function startFlow(adapter, toolCallId = 'tool-1', args = { questions }) {
  adapter.observe(
    hostEvent('agent-event', {
      type: 'tool_execution_start',
      toolCallId,
      toolName: 'ask_user_question',
      args,
    })
  );
}

test('advances a single-select step before projecting multi-select structure', () => {
  const adapter = new RpivQuestionnaireAdapter();
  startFlow(adapter);
  const select = hostEvent('extension-ui', {
    type: 'extension_ui_request',
    id: 'dialog-1',
    method: 'select',
    title: 'untrusted display copy',
    options: ['1. Timeline — Show tool calls.', '2. Approvals — Add checkpoints.', '3. Type something.'],
  });

  assert.deepEqual(adapter.project(select), select.payload);
  adapter.resolve('session-1', {
    type: 'extension_ui_response',
    id: 'dialog-1',
    value: '2. Approvals — Add checkpoints.',
  });

  const projected = adapter.project(
    hostEvent('extension-ui', {
      type: 'extension_ui_request',
      id: 'dialog-2',
      method: 'input',
      title: 'localized text that must not be parsed',
      placeholder: '1,3',
    })
  );
  assert.deepEqual(projected.hostQuestionnaire, {
    adapter: 'rpiv-ask-user-question',
    package: '@juicesharp/rpiv-ask-user-question',
    version: '2.7.1',
    toolCallId: 'tool-1',
    questionIndex: 1,
    multiple: true,
    header: 'Context',
    title: 'What context should be inspected?',
    options: [
      { id: '0', label: 'Source', description: 'Relevant source files.' },
      { id: '1', label: 'Tests', description: 'Existing tests.' },
      { id: '2', label: 'Docs', description: 'Architecture documentation.' },
    ],
    responseEncoding: 'rpiv-rpc-v1',
  });
});

test('tracks the single-select custom-answer follow-up without confusing it for multi-select', () => {
  const adapter = new RpivQuestionnaireAdapter();
  startFlow(adapter);
  const options = ['1. Timeline', '2. Approvals', '3. Localized custom answer'];
  adapter.project(
    hostEvent('extension-ui', {
      type: 'extension_ui_request',
      id: 'dialog-1',
      method: 'select',
      options,
    })
  );
  adapter.resolve('session-1', {
    type: 'extension_ui_response',
    id: 'dialog-1',
    value: options[2],
  });
  const custom = hostEvent('extension-ui', {
    type: 'extension_ui_request',
    id: 'dialog-custom',
    method: 'input',
    title: 'Type a custom answer',
  });

  assert.deepEqual(adapter.project(custom), custom.payload);
  adapter.resolve('session-1', {
    type: 'extension_ui_response',
    id: 'dialog-custom',
    value: 'A different direction',
  });
  const multi = adapter.project(
    hostEvent('extension-ui', {
      type: 'extension_ui_request',
      id: 'dialog-2',
      method: 'input',
    })
  );
  assert.equal(multi.hostQuestionnaire.questionIndex, 1);
});

test('falls back when structure, method, or concurrent ownership is ambiguous', () => {
  const invalid = new RpivQuestionnaireAdapter();
  startFlow(invalid, 'invalid', { questions: [{ question: 'Missing options', header: 'Invalid' }] });
  const request = hostEvent('extension-ui', {
    type: 'extension_ui_request',
    id: 'dialog-1',
    method: 'input',
  });
  assert.deepEqual(invalid.project(request), request.payload);

  const concurrent = new RpivQuestionnaireAdapter();
  startFlow(concurrent, 'tool-1', { questions: [questions[1]] });
  startFlow(concurrent, 'tool-2', { questions: [questions[1]] });
  assert.deepEqual(concurrent.project(request), request.payload);

  const mismatch = new RpivQuestionnaireAdapter();
  startFlow(mismatch, 'tool-3', { questions: [questions[1]] });
  const selectRequest = hostEvent('extension-ui', { ...request.payload, method: 'select' });
  assert.deepEqual(mismatch.project(selectRequest), selectRequest.payload);
});

test('clears stale correlation state when the runtime generation changes', () => {
  const adapter = new RpivQuestionnaireAdapter();
  startFlow(adapter, 'tool-1', { questions: [questions[1]] });
  const replacementRequest = hostEvent(
    'extension-ui',
    { type: 'extension_ui_request', id: 'dialog-new', method: 'input' },
    { runtimeId: 'runtime-2', epoch: 2 }
  );

  assert.deepEqual(adapter.project(replacementRequest), replacementRequest.payload);
});
