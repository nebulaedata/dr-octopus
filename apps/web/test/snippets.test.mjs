/**
 * @author Codex
 * @description Verifies quick phrase limits, validation and durable mode bindings.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSnippetsStore } from '../src/stores/snippets/store.ts';

test('persists four phrases and rejects invalid replacements without losing saved settings', () => {
  const records = new Map();
  const storage = {
    getItem: (key) => records.get(key) ?? null,
    setItem: (key, value) => records.set(key, value),
    removeItem: (key) => records.delete(key),
  };
  const store = createSnippetsStore(() => storage);
  const snippets = Array.from({ length: 4 }, (_, index) => ({
    id: String(index),
    title: ` Phrase ${index} `,
    message: ' Help me plan ',
    workMode: 'plan',
  }));
  store.getState().save(snippets);
  assert.equal(store.getState().snippets[0].title, 'Phrase 0');
  assert.equal(store.getState().snippets[0].action, 'send');
  store.getState().save([{ ...snippets[0], action: 'fill' }]);
  assert.equal(createSnippetsStore(() => storage).getState().snippets[0].action, 'fill');
  store.getState().save(snippets);
  assert.throws(() => store.getState().save([...snippets, snippets[0]]));
  assert.throws(() => store.getState().save([{ ...snippets[0], message: '   ' }]));
  assert.throws(() => store.getState().save([{ ...snippets[0], workMode: 'invalid' }]));
  assert.deepEqual(createSnippetsStore(() => storage).getState().snippets, store.getState().snippets);
  store.getState().save([]);
  assert.deepEqual(createSnippetsStore(() => storage).getState().snippets, []);
});

test('corrupt persisted phrase settings never expose invalid mode or excessive cards', () => {
  const store = createSnippetsStore(() => ({
    getItem: () =>
      JSON.stringify({ state: { snippets: [{ title: 'broken', workMode: 'unknown' }] }, version: 0 }),
    setItem() {},
    removeItem() {},
  }));
  assert.deepEqual(store.getState().snippets, []);
});
