/**
 * @author Codex
 * @description Verifies deterministic built-in selection and fallback behavior for tool card renderers.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveToolRenderer } from '../src/features/session/tool-renderers/registry.ts';

test('Pi built-in tools resolve specialized renderers', () => {
  assert.equal(resolveToolRenderer('bash').component.name, 'BashToolRenderer');
  assert.equal(resolveToolRenderer('edit').component.name, 'EditToolRenderer');
  assert.equal(resolveToolRenderer('grep').component.name, 'SearchToolRenderer');
});

test('unregistered custom tools resolve the raw fallback renderer', () => {
  assert.equal(resolveToolRenderer('third_party_custom_tool').component.name, 'FallbackToolRenderer');
});
