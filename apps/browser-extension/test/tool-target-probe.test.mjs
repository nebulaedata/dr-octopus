/**
 * @author Codex
 * @description Exercises test-only target preflight without claiming arbitrary page text is safe to parse as capabilities.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { preflightFixtureCalls } from './fixtures/tool-target-probe.mjs';

/**
 * Binds one synthetic indexed row to its exact observation identity.
 */
function fixture(text, toolName = 'browser_select') {
  const identity = { snapshotId: 's', controllerId: 'c', documentId: 'd' };
  const session = {
    observationRequired: false,
    lastObservationCallId: 'o',
    ledger: {
      o: { input: { tabId: 1 }, result: { output: { type: 'json', value: { ...identity, text } } } },
    },
  };
  const call = { toolName, toolCallId: 'a', input: { tabId: 1, target: { ...identity, elementIndex: 2 } } };
  return { session, call };
}

test('prototype rejects select on labels, radio buttons and custom comboboxes without selecting another element', () => {
  for (const row of ['[2]<label >普通配送 />', '[2]<input type=radio />', '[2]<div role=combobox />']) {
    const { session, call } = fixture(row);
    const [result] = preflightFixtureCalls(session, [call]);
    assert.equal(result.invalid, true);
    assert.deepEqual(result.input, call.input);
    assert.equal(call.invalid, undefined);
  }
});

test('prototype permits native select and text editing but refuses filling choice controls', () => {
  for (const [row, tool, rejected] of [
    ['[2]<select >区域 />', 'browser_select', false],
    ['[2]<input type=text />', 'browser_fill', false],
    ['[2]<textarea />', 'browser_fill', false],
    ['[2]<input type=checkbox />', 'browser_fill', true],
  ]) {
    const { session, call } = fixture(row, tool);
    assert.equal(preflightFixtureCalls(session, [call])[0].invalid === true, rejected);
  }
});

test('prototype does not derive capabilities from stale, unrelated or ambiguous observations', () => {
  for (const patch of [{ snapshotId: 'old' }, { documentId: 'old' }, { controllerId: 'old' }]) {
    const { session, call } = fixture('[2]<label >其他 />');
    Object.assign(call.input.target, patch);
    assert.equal(preflightFixtureCalls(session, [call])[0], call);
  }
  for (const text of ['[3]<label >其他 />', '[2]<label >A />\n[2]<select >B />']) {
    const { session, call } = fixture(text);
    assert.equal(preflightFixtureCalls(session, [call])[0], call);
  }
  const { session, call } = fixture('[2]<label >其他 />');
  session.observationRequired = true;
  assert.equal(preflightFixtureCalls(session, [call])[0], call);
});

test('prototype limitation: a valid click on the wrong option is not a type mismatch', () => {
  const { session, call } = fixture('[2]<label >普通配送 />', 'browser_click');
  assert.equal(preflightFixtureCalls(session, [call])[0], call);
});
