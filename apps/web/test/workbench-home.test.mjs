/**
 * @author Codex
 * @description Verifies repeated New session actions reuse workspace drafts until publication.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkbenchHomeStore } from '../src/stores/workbench-home/index.ts';

test('repeated New session actions and home remounts share one workspace draft', () => {
  const useWorkbenchHome = createWorkbenchHomeStore(() => createTabStorage());
  const home = useWorkbenchHome.getState();
  const general = home.ensureDraftId('general');
  const project = home.ensureDraftId('project');
  const state = useWorkbenchHome.getState();
  assert.notEqual(general, project);
  for (let click = 0; click < 100; click += 1) {
    assert.equal(home.ensureDraftId('general'), general);
    assert.equal(home.ensureDraftId('project'), project);
  }
  assert.equal(useWorkbenchHome.getState(), state);
  assert.deepEqual(useWorkbenchHome.getState().draftIds, { general, project });
});

test('publication allows one new draft without replacing another workspace draft', () => {
  const useWorkbenchHome = createWorkbenchHomeStore(() => createTabStorage());
  const home = useWorkbenchHome.getState();
  const published = home.ensureDraftId('general');
  const project = home.ensureDraftId('project');
  home.forgetDraft('general');
  const next = home.ensureDraftId('general');
  assert.notEqual(next, published);
  assert.equal(home.ensureDraftId('general'), next);
  assert.equal(home.ensureDraftId('project'), project);
});

/**
 * Models storage that survives document reloads but belongs to one browser tab.
 */
function createTabStorage() {
  const entries = new Map();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
}

test('full reloads restore the draft before home prewarming requests an identity', () => {
  const storage = createTabStorage();
  const firstPage = createWorkbenchHomeStore(() => storage);
  const general = firstPage.getState().ensureDraftId('general');
  const project = firstPage.getState().ensureDraftId('project');
  for (let refresh = 0; refresh < 20; refresh += 1) {
    const reloadedPage = createWorkbenchHomeStore(() => storage);
    assert.equal(reloadedPage.persist.hasHydrated(), true);
    assert.equal(reloadedPage.getState().ensureDraftId('general'), general);
    assert.equal(reloadedPage.getState().ensureDraftId('project'), project);
  }
});

test('publication remains forgotten after reload while other workspace drafts survive', () => {
  const storage = createTabStorage();
  const firstPage = createWorkbenchHomeStore(() => storage);
  const published = firstPage.getState().ensureDraftId('general');
  const project = firstPage.getState().ensureDraftId('project');
  firstPage.getState().forgetDraft('general');
  const reloadedPage = createWorkbenchHomeStore(() => storage);
  assert.equal(reloadedPage.getState().draftIds.general, undefined);
  const next = reloadedPage.getState().ensureDraftId('general');
  assert.notEqual(next, published);
  assert.equal(reloadedPage.getState().ensureDraftId('project'), project);
  assert.equal(
    createWorkbenchHomeStore(() => storage)
      .getState()
      .ensureDraftId('general'),
    next
  );
});

test('independent browser tabs keep separate draft ownership', () => {
  const firstTab = createWorkbenchHomeStore(() => createTabStorage());
  const secondTab = createWorkbenchHomeStore(() => createTabStorage());
  assert.notEqual(
    firstTab.getState().ensureDraftId('general'),
    secondTab.getState().ensureDraftId('general')
  );
});

test('expired draft recovery persists one successor and preserves other workspace identities', () => {
  const storage = createTabStorage();
  const home = createWorkbenchHomeStore(() => storage).getState();
  const expired = home.ensureDraftId('general');
  const project = home.ensureDraftId('project');
  const replacement = home.renewDraftId('general', expired);
  assert.notEqual(replacement, expired);
  assert.equal(home.renewDraftId('general', expired), replacement);
  assert.equal(home.ensureDraftId('project'), project);
  const restored = createWorkbenchHomeStore(() => storage).getState();
  assert.equal(restored.ensureDraftId('general'), replacement);
  assert.equal(restored.ensureDraftId('project'), project);
});

test('late expiry recovery cannot recreate a draft after publication', () => {
  const home = createWorkbenchHomeStore(() => createTabStorage()).getState();
  const published = home.ensureDraftId('general');
  home.forgetDraft('general');
  assert.equal(home.renewDraftId('general', published), published);
  assert.notEqual(home.ensureDraftId('general'), published);
});
