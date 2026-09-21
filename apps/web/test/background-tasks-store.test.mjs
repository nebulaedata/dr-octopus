/**
 * @author Codex
 * @description Verifies background-task dismissals remain session-scoped across page reloads.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createBackgroundTasksStore } from '../src/stores/background-tasks/store.ts';

test('dismissed background-task snapshots survive reloads without crossing sessions', () => {
  const storage = createLocalStorage();
  const firstPage = createBackgroundTasksStore(() => storage);
  firstPage.getState().dismissSnapshot('session-a', 'generation-a:3');
  firstPage.getState().dismissSnapshot('session-b', 'generation-b:8');

  const reloadedPage = createBackgroundTasksStore(() => storage);
  assert.equal(reloadedPage.persist.hasHydrated(), true);
  assert.deepEqual(reloadedPage.getState().dismissedSnapshots, {
    'session-a': 'generation-a:3',
    'session-b': 'generation-b:8',
  });

  reloadedPage.getState().dismissSnapshot('session-a', 'generation-a:4');
  assert.deepEqual(createBackgroundTasksStore(() => storage).getState().dismissedSnapshots, {
    'session-a': 'generation-a:4',
    'session-b': 'generation-b:8',
  });

  reloadedPage.getState().clearDismissedSnapshot('session-a');
  assert.deepEqual(createBackgroundTasksStore(() => storage).getState().dismissedSnapshots, {
    'session-b': 'generation-b:8',
  });
});

/**
 * Models browser localStorage shared by every reload in the same origin.
 */
function createLocalStorage() {
  const entries = new Map();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
}
