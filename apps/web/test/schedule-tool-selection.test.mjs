/**
 * @author Codex
 * @description Verifies local search and cross-filter authorization selection boundaries.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { filterTaskTools, selectTaskToolMatches } from '../src/features/schedules/schedule-tool-selection.ts';
const tools = [
  {
    name: 'web_search',
    description: 'Search news',
    identity: 'search',
    source: 'provider A',
    unavailableReason: null,
  },
  {
    name: 'fetch',
    description: 'Read pages',
    identity: 'fetch',
    source: 'provider B',
    unavailableReason: null,
  },
  {
    name: 'blocked_search',
    description: 'Search files',
    identity: 'blocked',
    source: 'provider A',
    unavailableReason: 'Policy deny',
  },
];
test('local search covers names, descriptions, sources and empty results', () => {
  assert.equal(filterTaskTools(tools, ' NEWS ')[0].identity, 'search');
  assert.equal(filterTaskTools(tools, 'provider b read')[0].identity, 'fetch');
  assert.equal(filterTaskTools(tools, 'no-result').length, 0);
  assert.equal(filterTaskTools(tools, '').length, 3);
});
test('selecting or clearing search results preserves hidden selections and excludes blocked tools', () => {
  const matches = filterTaskTools(tools, 'search');
  const selected = selectTaskToolMatches(['fetch'], matches, true);
  assert.deepEqual(selected, ['fetch', 'search']);
  assert.deepEqual(selectTaskToolMatches(selected, matches, false), ['fetch']);
  assert.deepEqual(selectTaskToolMatches(selected, [], false), selected);
});
