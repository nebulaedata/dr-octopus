/**
 * @author Codex
 * @description Verify bounded cross-turn evidence, refusal boundaries and explicit save intent.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { memorySaveIntent, selectMemoryRun } from '../dist/extensions/memory/services/run-policy.js';

test('explicit requests include recent user evidence while automatic runs only evaluate new entries', () => {
  const old = { sessionId: 's', entryId: 'old', evidence: '我叫 Alex，喜欢钓鱼。' };
  const fresh = { sessionId: 's', entryId: 'new', evidence: '保存在长期记忆中' };
  const baseline = new Set(['old']);
  assert.deepEqual(selectMemoryRun([old, fresh], baseline), { intent: 'explicit', sources: [old, fresh] });
  const greeting = { ...fresh, evidence: '你好' };
  assert.deepEqual(selectMemoryRun([old, greeting], baseline), { intent: 'automatic', sources: [greeting] });
  assert.deepEqual(selectMemoryRun([old], baseline).sources, []);
});

test('refusals prevent automatic saving and bound future explicit lookback', () => {
  for (const text of ['不要记住我', '别保存这条', "don't remember this", 'do not store this']) {
    assert.equal(memorySaveIntent(text), 'declined');
  }
  const sources = ['私密内容', '不要记住这条', '记住我喜欢中文'].map((evidence, i) => ({
    sessionId: 's',
    entryId: String(i),
    evidence,
  }));
  assert.deepEqual(selectMemoryRun(sources, new Set(['0', '1'])).sources, [sources[2]]);
  assert.deepEqual(selectMemoryRun(sources.slice(0, 2), new Set(['0'])).sources, []);
});

test('lookback is bounded and ordinary memory questions are not explicit write requests', () => {
  for (const text of ['记住我', '记住：我喜欢中文', '请记下我的爱好', 'save this in memory', 'remember me']) {
    assert.equal(memorySaveIntent(text), 'explicit');
  }
  assert.equal(memorySaveIntent('你记得我的爱好吗？'), 'automatic');
  assert.equal(memorySaveIntent('你记住我了吗？'), 'automatic');
  assert.equal(memorySaveIntent('Do you remember my hobbies?'), 'automatic');
  const sources = Array.from({ length: 20 }, (_, i) => ({
    sessionId: 's',
    entryId: String(i),
    evidence: i === 19 ? '记住上述内容' : '事实 ' + i,
  }));
  assert.deepEqual(
    selectMemoryRun(sources, new Set(sources.slice(0, -1).map((s) => s.entryId))).sources,
    sources.slice(-8)
  );
});
