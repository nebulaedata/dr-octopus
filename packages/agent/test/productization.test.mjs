/**
 * @author Codex
 * @description Verifies Dr.Octopus identity injection.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductizationExtension } from '../dist/decorators/productization.js';

const PI_IDENTITY =
  'You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.';

test('productization replaces the Pi identity with the Dr.Octopus identity', () => {
  let beforeAgentStart;
  createProductizationExtension()({
    on: (event, handler) => {
      if (event === 'before_agent_start') {
        beforeAgentStart = handler;
      }
    },
  });

  const result = beforeAgentStart({ systemPrompt: `${PI_IDENTITY}\n\nAvailable tools:` });
  assert.match(result.systemPrompt, /^You are Dr\.Octopus,/);
  assert.doesNotMatch(result.systemPrompt, /You are an expert coding assistant operating inside pi/);
  assert.match(result.systemPrompt, /Available tools:/);
});
