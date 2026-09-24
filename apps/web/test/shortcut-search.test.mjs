/**
 * @author Claude
 * @description Verifies the shortcuts settings search predicate across localized labels and combo text.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesShortcutQuery } from '../src/features/settings/utils/shortcut-search.ts';

test('matches localized labels case-insensitively', () => {
  const target = { label: 'Toggle left sidebar', combo: 'Ctrl+B' };
  assert.equal(matchesShortcutQuery(target, 'sidebar'), true);
  assert.equal(matchesShortcutQuery(target, 'TOGGLE'), true);
  assert.equal(matchesShortcutQuery({ label: '切换左侧栏', combo: 'Ctrl+B' }, '侧栏'), true);
});

test('matches combo text verbatim, case-insensitively', () => {
  const target = { label: 'Toggle left sidebar', combo: 'Ctrl+B' };
  assert.equal(matchesShortcutQuery(target, 'ctrl+b'), true);
  assert.equal(matchesShortcutQuery(target, 'Ctrl+B'), true);
});

test('matches combo text with separators stripped', () => {
  assert.equal(matchesShortcutQuery({ label: 'x', combo: 'Ctrl+B' }, 'ctrl b'), true);
  assert.equal(matchesShortcutQuery({ label: 'x', combo: 'Ctrl+B' }, 'ctrlb'), true);
  assert.equal(matchesShortcutQuery({ label: 'x', combo: 'Ctrl+Shift+B' }, 'ctrlshiftb'), true);
  assert.equal(matchesShortcutQuery({ label: 'x', combo: 'Shift+Esc' }, 'shift esc'), true);
});

test('empty queries match everything and misses return false', () => {
  const target = { label: 'New session', combo: 'Alt+N' };
  assert.equal(matchesShortcutQuery(target, ''), true);
  assert.equal(matchesShortcutQuery(target, '   '), true);
  assert.equal(matchesShortcutQuery(target, 'zzz'), false);
});

test('unbound rows match by label only', () => {
  const target = { label: 'New session', combo: null };
  assert.equal(matchesShortcutQuery(target, 'new'), true);
  assert.equal(matchesShortcutQuery(target, 'alt'), false);
});
