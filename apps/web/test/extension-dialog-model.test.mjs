/**
 * @author Codex
 * @description Verifies Pi Extension UI strings become concise titles and text-agnostic immediate select values.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  encodeRpivMultipleResponse,
  getDisplayCopy,
  getDisplayOptions,
  getImmediateSelectValue,
  getPlanModeQuestionnaire,
  getRpivMultipleQuestionnaire,
} from '../src/features/session/utils/extension-dialog-model.ts';

test('presents Plan choices from Host metadata while preserving exact RPC option values', () => {
  const payload = {
    id: 'plan-1',
    method: 'select',
    options: [
      '1. Focused — Selected feature only.',
      '2. Complete — Supporting changes.',
      'Other (free-form)',
    ],
    hostQuestionnaire: {
      adapter: 'pi-plan-mode',
      package: '@narumitw/pi-plan-mode',
      version: '0.55.3',
      toolCallId: 'tool-plan',
      questionIndex: 0,
      multiple: false,
      header: 'Scope',
      title: 'Which scope should the plan cover?',
      options: [
        { id: '0', label: 'Focused', description: 'Selected feature only.' },
        { id: '1', label: 'Complete', description: 'Supporting changes.' },
      ],
      responseEncoding: 'pi-tui-kit-select-v1',
    },
  };

  assert.ok(getPlanModeQuestionnaire(payload));
  assert.deepEqual(getDisplayCopy(payload), {
    title: '[Scope] Which scope should the plan cover?',
    description: 'Choose one option. Select Other to write a custom answer.',
  });
  assert.deepEqual(getDisplayOptions(payload)[2], {
    label: 'Other',
    description: 'Write a custom answer.',
    value: '2',
  });
  assert.equal(getImmediateSelectValue(payload, '2'), 'Other (free-form)');
  assert.equal(
    getPlanModeQuestionnaire({
      ...payload,
      hostQuestionnaire: { ...payload.hostQuestionnaire, version: '0.56.0' },
    }),
    undefined
  );
});

test('permission titles retain only the request subject', () => {
  const copy = getDisplayCopy({
    id: 'permission-1',
    method: 'select',
    title: 'Permission Required\ntool : ask_user_question\ninput : with input {"questions":[]}',
  });

  assert.deepEqual(copy, {
    title: 'Permission Required tool: ask_user_question',
    description: 'This extension needs your input before it can continue.',
  });
});

test('permission follow-up input retains its user-facing instruction', () => {
  const copy = getDisplayCopy({
    id: 'permission-2',
    method: 'input',
    title: 'Permission Required\nShare why this request was denied (optional).',
  });

  assert.equal(copy.title, 'Permission Required');
  assert.equal(copy.description, 'Share why this request was denied (optional).');
});

test('replaces the fixed ready-plan menu details with concise Host copy', () => {
  const copy = getDisplayCopy({
    id: 'plan-ready',
    method: 'select',
    title:
      'Proposed plan ready. What next?\nImplement here keeps this planning conversation.\nStart fresh transfers only the approved plan to a new session.\nPlan reinjection: Off; use conversation history only.',
    options: [
      'Implement here',
      'Start fresh and implement',
      'Export plan...',
      'Save for later',
      'Stay in Plan mode',
      'Discard plan and exit',
    ],
  });

  assert.deepEqual(copy, {
    title: 'Proposed plan ready. What next?',
    description: 'Choose how to continue with this plan.',
  });
});

test('all select choices resolve immediately without display-text conventions', () => {
  const payload = {
    id: 'question-1',
    method: 'select',
    options: ['1. Clear — No changes needed.', '任意本地化选项', '3. Type something.'],
  };
  const options = getDisplayOptions(payload);

  assert.equal(options[0]?.label, 'Clear');
  assert.equal(options[0]?.description, 'No changes needed.');
  assert.equal(options[1]?.label, '任意本地化选项');
  assert.equal(getImmediateSelectValue(payload, '0'), payload.options[0]);
  assert.equal(getImmediateSelectValue(payload, '1'), payload.options[1]);
  assert.equal(getImmediateSelectValue(payload, '2'), payload.options[2]);
  assert.equal(getImmediateSelectValue(payload, 'missing'), undefined);
  assert.equal(getImmediateSelectValue({ ...payload, method: 'confirm' }, '0'), undefined);
});

test('accepts only the complete pinned rpiv multi-select projection', () => {
  const payload = {
    id: 'multi-1',
    method: 'input',
    hostQuestionnaire: {
      adapter: 'rpiv-ask-user-question',
      package: '@juicesharp/rpiv-ask-user-question',
      version: '2.7.1',
      toolCallId: 'tool-1',
      questionIndex: 0,
      multiple: true,
      header: 'Context',
      title: 'What should be inspected?',
      options: [
        { id: '0', label: 'Source', description: 'Relevant source files.' },
        { id: '1', label: 'Tests', description: 'Existing tests.' },
      ],
      responseEncoding: 'rpiv-rpc-v1',
    },
  };

  const questionnaire = getRpivMultipleQuestionnaire(payload);
  assert.ok(questionnaire);
  assert.deepEqual(getDisplayCopy(payload), {
    title: '[Context] What should be inspected?',
    description: 'Select all that apply, or provide a custom answer.',
  });
  assert.deepEqual(getDisplayOptions(payload), [
    { value: '0', label: 'Source', description: 'Relevant source files.' },
    { value: '1', label: 'Tests', description: 'Existing tests.' },
  ]);
  assert.equal(getRpivMultipleQuestionnaire({ ...payload, method: 'select' }), undefined);
  assert.equal(
    getRpivMultipleQuestionnaire({
      ...payload,
      hostQuestionnaire: { ...payload.hostQuestionnaire, version: '2.8.0' },
    }),
    undefined
  );
});

test('encodes checkbox choices in source order and keeps custom answers exclusive', () => {
  const questionnaire = getRpivMultipleQuestionnaire({
    id: 'multi-2',
    method: 'input',
    hostQuestionnaire: {
      adapter: 'rpiv-ask-user-question',
      package: '@juicesharp/rpiv-ask-user-question',
      version: '2.7.1',
      toolCallId: 'tool-2',
      questionIndex: 0,
      multiple: true,
      header: '',
      title: 'Choose context',
      options: [
        { id: '0', label: 'Source', description: 'Source files.' },
        { id: '1', label: 'Tests', description: 'Tests.' },
        { id: '2', label: 'Docs', description: 'Documentation.' },
      ],
      responseEncoding: 'rpiv-rpc-v1',
    },
  });
  assert.ok(questionnaire);
  assert.equal(encodeRpivMultipleResponse(questionnaire, ['2', '0', '2'], ''), '1,3');
  assert.equal(encodeRpivMultipleResponse(questionnaire, [], ''), '');
  assert.equal(
    encodeRpivMultipleResponse(questionnaire, ['0'], '  inspect generated files  '),
    'inspect generated files'
  );
  assert.equal(encodeRpivMultipleResponse(questionnaire, ['missing'], ''), undefined);
});
