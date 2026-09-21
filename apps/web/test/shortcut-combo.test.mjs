/**
 * @author Claude
 * @description Verifies canonical combo normalization, parsing, validation, matching, and aria conversion.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  comboHasStrongModifier,
  comboMatches,
  isValidCombo,
  normalizeEvent,
  parseCombo,
  toAriaKeyShortcuts,
} from '../src/lib/shortcuts/shortcut-combo.ts';

function event(init = {}) {
  return { key: 'b', code: 'KeyB', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...init };
}

test('normalizes letters to uppercase with canonical modifier order', () => {
  assert.equal(normalizeEvent(event({ ctrlKey: true })), 'Ctrl+B');
  assert.equal(normalizeEvent(event({ ctrlKey: true, shiftKey: true })), 'Ctrl+Shift+B');
  assert.equal(
    normalizeEvent(event({ metaKey: true, altKey: true, ctrlKey: true, shiftKey: true })),
    'Ctrl+Alt+Shift+Meta+B'
  );
  assert.equal(normalizeEvent(event({ key: 'n', code: 'KeyN', altKey: true })), 'Alt+N');
});

test('prefers physical codes so Shift+punctuation stays layout stable', () => {
  assert.equal(normalizeEvent(event({ key: '[', code: 'BracketLeft', ctrlKey: true })), 'Ctrl+[');
  assert.equal(normalizeEvent(event({ key: '{', code: 'BracketLeft', shiftKey: true })), 'Shift+[');
  assert.equal(normalizeEvent(event({ key: ',', code: 'Comma', ctrlKey: true })), 'Ctrl+,');
});

test('maps named keys and falls back to key names when code is missing', () => {
  assert.equal(normalizeEvent(event({ key: 'Enter', code: 'Enter' })), 'Enter');
  assert.equal(normalizeEvent(event({ key: 'Escape', code: 'Escape', shiftKey: true })), 'Shift+Esc');
  assert.equal(normalizeEvent(event({ key: ' ', code: 'Space' })), 'Space');
  assert.equal(normalizeEvent(event({ key: 'Escape', code: '' })), 'Esc');
  assert.equal(normalizeEvent(event({ key: 'F11', code: 'F11' })), 'F11');
});

test('returns null for modifier-only presses and unrecognized keys', () => {
  assert.equal(normalizeEvent(event({ key: 'Control', code: 'ControlLeft', ctrlKey: true })), null);
  assert.equal(normalizeEvent(event({ key: 'Shift', code: 'ShiftLeft', shiftKey: true })), null);
  assert.equal(normalizeEvent(event({ key: 'Dead', code: 'Equal' })), null);
  assert.equal(normalizeEvent(event({ key: 'Unidentified', code: '' })), null);
});

test('ignoreAlt drops Alt from the produced combo', () => {
  assert.equal(
    normalizeEvent(event({ key: 'Enter', code: 'Enter', altKey: true }), { ignoreAlt: true }),
    'Enter'
  );
});

test('comboMatches compares normalized events, optionally ignoring Alt', () => {
  const enter = event({ key: 'Enter', code: 'Enter' });
  const altEnter = event({ key: 'Enter', code: 'Enter', altKey: true });
  assert.equal(comboMatches(enter, 'Enter'), true);
  assert.equal(comboMatches(altEnter, 'Enter'), false);
  assert.equal(comboMatches(altEnter, 'Enter', { ignoreAlt: true }), true);
});

test('parseCombo validates modifier order and rejects malformed strings', () => {
  assert.deepEqual(parseCombo('Ctrl+Shift+B'), { modifiers: ['Ctrl', 'Shift'], mainKey: 'B' });
  assert.deepEqual(parseCombo('Enter'), { modifiers: [], mainKey: 'Enter' });
  assert.equal(parseCombo('Shift+Ctrl+B'), null);
  assert.equal(parseCombo('Ctrl+Ctrl+B'), null);
  assert.equal(parseCombo('Ctrl+'), null);
  assert.equal(parseCombo('Ctrl+Shift'), null);
});

test('isValidCombo requires canonical casing and known main keys', () => {
  assert.equal(isValidCombo('Ctrl+Shift+B'), true);
  assert.equal(isValidCombo('Shift+Esc'), true);
  assert.equal(isValidCombo('Ctrl+,'), true);
  assert.equal(isValidCombo('ctrl+b'), false);
  assert.equal(isValidCombo('Ctrl+Banana'), false);
  assert.equal(isValidCombo(''), false);
});

test('comboHasStrongModifier reports Ctrl/Alt/Meta presence', () => {
  assert.equal(comboHasStrongModifier('Ctrl+B'), true);
  assert.equal(comboHasStrongModifier('Alt+N'), true);
  assert.equal(comboHasStrongModifier('Meta+K'), true);
  assert.equal(comboHasStrongModifier('Shift+Esc'), false);
  assert.equal(comboHasStrongModifier('Enter'), false);
});

test('toAriaKeyShortcuts expands long modifier and key names', () => {
  assert.equal(toAriaKeyShortcuts('Ctrl+Shift+B'), 'Control+Shift+B');
  assert.equal(toAriaKeyShortcuts('Shift+Esc'), 'Shift+Escape');
  assert.equal(toAriaKeyShortcuts('Ctrl+['), 'Control+[');
});
