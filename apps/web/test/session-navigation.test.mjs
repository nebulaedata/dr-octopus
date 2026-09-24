/**
 * @author Codex
 * @description Covers Session shortcut entry from other pages and cyclic Sidebar navigation.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { getSiblingSession } from '../src/features/layout/utils/session-navigation.ts';

const sessions = [{ id: 'pinned' }, { id: 'recent' }, { id: 'older' }];

test('non-Session pages and stale Session routes enter at the directional end', () => {
  for (const current of [undefined, 'deleted']) {
    assert.equal(getSiblingSession(sessions, current, 1), sessions[0]);
    assert.equal(getSiblingSession(sessions, current, -1), sessions[2]);
  }
});

test('both directions traverse Sidebar order and wrap around repeatedly', () => {
  for (const direction of [-1, 1]) {
    let current = sessions[0];
    const visited = [];
    for (let step = 0; step < 6; step += 1) {
      current = getSiblingSession(sessions, current.id, direction);
      visited.push(current.id);
    }
    assert.deepEqual(
      visited,
      direction === 1
        ? ['recent', 'older', 'pinned', 'recent', 'older', 'pinned']
        : ['older', 'recent', 'pinned', 'older', 'recent', 'pinned']
    );
  }
});

test('empty lists have no destination and single-Session lists stay navigable', () => {
  for (const direction of [-1, 1]) {
    assert.equal(getSiblingSession([], undefined, direction), undefined);
    assert.equal(getSiblingSession([], 'deleted', direction), undefined);
    assert.equal(getSiblingSession([sessions[0]], undefined, direction), sessions[0]);
    assert.equal(getSiblingSession([sessions[0]], sessions[0].id, direction), sessions[0]);
  }
});
