/**
 * @author Codex
 * @description Verifies policy drafts detect meaningful changes while reversions and reordered tool sets stay clean.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { toolPoliciesEqual } from '../src/renderer/src/features/settings/utils/tool-policy-diff.ts';

const saved = {
  revision: 2,
  selectedId: 'readonly',
  custom: [
    { id: 'first', name: '工作', enabledTools: ['read', 'write'] },
    { id: 'second', name: '查询', enabledTools: ['read'] },
  ],
};

test('policy diff ignores publication revisions and ordering without mutating saved content', () => {
  const before = structuredClone(saved);
  const reordered = {
    ...saved,
    revision: 3,
    custom: saved.custom.toReversed().map((policy) => ({
      name: policy.name,
      enabledTools: policy.enabledTools.toReversed(),
      id: policy.id,
    })),
  };
  assert.equal(toolPoliciesEqual(saved, reordered), true);
  assert.deepEqual(saved, before);
});

test('selection, custom name, membership, creation and deletion are dirty until reverted', () => {
  const changes = [
    { ...saved, selectedId: 'all' },
    { ...saved, custom: [{ ...saved.custom[0], name: '新名称' }, saved.custom[1]] },
    { ...saved, custom: [{ ...saved.custom[0], enabledTools: ['read'] }, saved.custom[1]] },
    { ...saved, custom: [...saved.custom, { id: 'third', name: '新策略', enabledTools: [] }] },
    { ...saved, custom: [saved.custom[0]] },
  ];
  for (const changed of changes) {
    assert.equal(toolPoliciesEqual(saved, changed), false);
  }
  const reverted = { ...changes[0], selectedId: saved.selectedId };
  assert.equal(toolPoliciesEqual(saved, reverted), true);
});
