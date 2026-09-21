/**
 * @author Claude
 * @description Verifies shortcuts store actions, effective-binding resolution, conflict detection, persistence, and rehydrate sanitization.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

function createLocalStorageStub() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      data.set(key, String(value));
    },
    removeItem: (key) => {
      data.delete(key);
    },
    clear: () => data.clear(),
    key: (index) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
}

// Hydration runs at import time, so dirty storage must be seeded before the module loads.
globalThis.localStorage = createLocalStorageStub();
globalThis.localStorage.setItem(
  'dr-octopus.shortcuts.bindings.v1',
  JSON.stringify({
    state: {
      overrides: {
        'session.new': 'Ctrl+Alt+N',
        'session.previous': null,
        'unknown.command': 'Ctrl+X',
        'session.stop': 42,
        'session.next': 'not a combo',
      },
    },
    version: 0,
  })
);

const { useShortcutsStore, SHORTCUT_BINDINGS_STORAGE_KEY } = await import('../src/stores/shortcuts/index.ts');
const { findBindingConflict, resolveEffectiveBinding, sanitizeShortcutOverrides } =
  await import('../src/lib/shortcuts/shortcut-catalog.ts');

test('rehydrate keeps valid overrides and drops unknown IDs and malformed combos', () => {
  const { overrides } = useShortcutsStore.getState();
  assert.deepEqual(overrides, { 'session.new': 'Ctrl+Alt+N', 'session.previous': null });
});

test('setBinding/clearBinding/resetBinding/resetAll mutate overrides with clear-vs-default semantics', () => {
  const store = useShortcutsStore.getState();
  store.resetAll();
  store.setBinding('session.new', 'Ctrl+Alt+Shift+N');
  assert.equal(
    resolveEffectiveBinding(useShortcutsStore.getState().overrides, 'session.new'),
    'Ctrl+Alt+Shift+N'
  );
  store.clearBinding('session.new');
  assert.equal(resolveEffectiveBinding(useShortcutsStore.getState().overrides, 'session.new'), null);
  store.resetBinding('session.new');
  assert.equal(resolveEffectiveBinding(useShortcutsStore.getState().overrides, 'session.new'), 'Alt+N');
  store.setBinding('session.new', 'Ctrl+Alt+N');
  store.resetAll();
  assert.deepEqual(useShortcutsStore.getState().overrides, {});
});

test('actions persist overrides into the storage record', () => {
  const store = useShortcutsStore.getState();
  store.resetAll();
  store.setBinding('layout.toggleLeftSidebar', 'Ctrl+Shift+L');
  const persisted = JSON.parse(globalThis.localStorage.getItem(SHORTCUT_BINDINGS_STORAGE_KEY));
  assert.deepEqual(persisted.state.overrides, { 'layout.toggleLeftSidebar': 'Ctrl+Shift+L' });
  store.resetAll();
});

test('findBindingConflict is scope-aware and ignores placeholders and the edited command', () => {
  assert.equal(findBindingConflict({}, 'session.new', 'Ctrl+B'), 'layout.toggleLeftSidebar');
  assert.equal(findBindingConflict({}, 'layout.toggleLeftSidebar', 'Ctrl+B'), undefined);
  // Placeholder voice.toggle is excluded even though it displays Ctrl+D.
  assert.equal(findBindingConflict({}, 'session.new', 'Ctrl+D'), undefined);
  // Composer scope is a separate namespace from global.
  assert.equal(findBindingConflict({}, 'composer.send', 'Ctrl+B'), undefined);
  assert.equal(findBindingConflict({}, 'composer.newline', 'Enter'), 'composer.send');
  // Overrides participate: clearing the owner frees the combo.
  assert.equal(findBindingConflict({ 'layout.toggleLeftSidebar': null }, 'session.new', 'Ctrl+B'), undefined);
});

test('sanitizeShortcutOverrides filters shapes, unknown IDs, and invalid combos', () => {
  assert.deepEqual(sanitizeShortcutOverrides(undefined), {});
  assert.deepEqual(sanitizeShortcutOverrides('junk'), {});
  assert.deepEqual(
    sanitizeShortcutOverrides({
      'session.new': 'Alt+Shift+N',
      'session.stop': null,
      'layout.toggleLeftSidebar': 'ctrl+b',
      'voice.toggle': 'Ctrl+D',
      ghost: 'Ctrl+G',
    }),
    { 'session.new': 'Alt+Shift+N', 'session.stop': null, 'voice.toggle': 'Ctrl+D' }
  );
});
