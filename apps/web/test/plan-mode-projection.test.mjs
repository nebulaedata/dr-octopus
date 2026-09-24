/**
 * @author Codex
 * @description Verifies defensive Plan tool-card projection from arguments and versioned result details.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  projectPlanModeTool,
  summarizePlanModeTool,
} from '../src/features/session/utils/plan-mode-projection.ts';

test('projects question answers by stable id', () => {
  const tool = {
    name: 'plan_mode_question',
    arguments: {
      questions: [
        {
          id: 'scope',
          header: 'Scope',
          question: 'Which scope?',
          options: [
            { label: 'Focused', description: 'Feature only.' },
            { label: 'Complete', description: 'Include dependencies.' },
          ],
        },
      ],
    },
    details: {
      cancelled: false,
      answers: [{ id: 'scope', answer: 'Complete', wasCustom: false }],
    },
  };

  assert.equal(projectPlanModeTool(tool).questions[0].answer, 'Complete');
  assert.equal(summarizePlanModeTool(tool), '1 answered');
});

test('accepts only the versioned completion details contract', () => {
  const valid = {
    name: 'plan_mode_complete',
    details: { version: 1, source: 'plan_mode_complete', plan: '# Safe plan' },
  };
  assert.equal(projectPlanModeTool(valid).plan, '# Safe plan');
  assert.equal(summarizePlanModeTool(valid), 'Proposed plan ready');
  assert.equal(projectPlanModeTool({ ...valid, details: { ...valid.details, version: 2 } }).plan, undefined);
});
