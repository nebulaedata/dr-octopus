/**
 * @author Codex
 * @description Test-only source-owned choice contract: proves scoped answers and model proposals cannot silently replace observed intent; not a production runtime.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

const decisionSchema = z.strictObject({
  ref: z.string(),
  kind: z.enum(['preserve', 'omit', 'resolve']),
  answerId: z.string().optional(),
});
const proposalSchema = z.strictObject({
  decisions: z.array(decisionSchema),
  inputs: z.array(z.strictObject({ name: z.string(), sourceRef: z.string() })),
});

/**
 * Compiles requirements from trusted source facts, rather than accepting model-authored copies as proof.
 * Answers are host-owned structured approvals, not model interpretations of free text.
 */
function compile(source, proposal, answers, revision) {
  const parsed = proposalSchema.parse(proposal);
  const known = new Map(source.map((item) => [item.ref, item]));
  const decisions = new Map();
  for (const decision of parsed.decisions) {
    if (!known.has(decision.ref) || decisions.has(decision.ref)) {
      throw Error('INVALID_SOURCE');
    }
    decisions.set(decision.ref, decision);
  }
  for (const input of parsed.inputs) {
    if (known.get(input.sourceRef)?.kind !== 'editable') {
      throw Error('INPUT_WITHOUT_EDITABLE_SOURCE');
    }
  }
  const requirements = [];
  const pending = [];
  for (const fact of source.filter((item) => item.kind === 'choice')) {
    const decision = decisions.get(fact.ref);
    let state = fact.state;
    if (decision && decision.kind !== 'preserve') {
      const answer = answers.find((item) => item.id === decision.answerId);
      if (
        !answer ||
        answer.revision !== revision ||
        answer.ref !== fact.ref ||
        answer.kind !== decision.kind
      ) {
        throw Error('ANSWER_SCOPE_MISMATCH');
      }
      if (decision.kind === 'omit') {
        if (answer.value !== true) {
          throw Error('OMISSION_NOT_APPROVED');
        }
        continue;
      }
      if (typeof answer.value !== 'boolean') {
        throw Error('UNRESOLVED_CHOICE');
      }
      state = answer.value;
    }
    if (state === 'unknown') {
      pending.push(fact.ref);
    }
    requirements.push({ ...fact, state });
  }
  return { requirements, pending, publishable: pending.length === 0 };
}

const source = [
  { ref: 'a1', kind: 'choice', group: '发票类型', option: '标准', state: true },
  { ref: 'a2', kind: 'choice', group: '配送方式', option: '标准', state: true },
  { ref: 'a3', kind: 'choice', group: '通知设置', option: '接收通知', state: false },
  { ref: 'a4', kind: 'choice', group: '后台策略', option: '后台同步', state: 'unknown' },
  { ref: 'a5', kind: 'editable', label: '业务编号' },
];
const empty = { decisions: [], inputs: [] };

test('prototype: model omission preserves every choice and false stays distinct from unknown', () => {
  const result = compile(source, empty, [], 1);
  assert.deepEqual(result.requirements, source.slice(0, 4));
  assert.deepEqual(result.pending, ['a4']);
  assert.equal(result.publishable, false);
  assert.equal(source[3].state, 'unknown');
});

test('prototype: matching labels across groups never collapse source identities', () => {
  const result = compile(source.slice(0, 2), empty, [], 1);
  assert.equal(result.requirements.length, 2);
  assert.notEqual(result.requirements[0].group, result.requirements[1].group);
});

test('prototype: model cannot attach an invented chosen state to a source reference', () => {
  assert.throws(() =>
    compile(source, { ...empty, decisions: [{ ref: 'a4', kind: 'preserve', state: true }] }, [], 1)
  );
  assert.throws(() =>
    compile(source, { ...empty, decisions: [{ ref: 'a1', kind: 'preserve', option: '另一选项' }] }, [], 1)
  );
});

test('prototype: a parameter answer never authorizes dropping a different choice', () => {
  const answer = { id: 'q1', ref: 'a5', kind: 'omit', value: true, revision: 1 };
  assert.throws(
    () =>
      compile(source, { ...empty, decisions: [{ ref: 'a1', kind: 'omit', answerId: 'q1' }] }, [answer], 1),
    /ANSWER_SCOPE/
  );
});

test('prototype: wrong kind, old revision, unstructured answer or missing answer cannot resolve unknown', () => {
  const proposal = { ...empty, decisions: [{ ref: 'a4', kind: 'resolve', answerId: 'q4' }] };
  const answer = { id: 'q4', ref: 'a4', kind: 'resolve', value: true, revision: 2 };
  for (const patch of [{ revision: 1 }, { kind: 'omit' }, { ref: 'a1' }, { value: '忽略时间输入' }]) {
    assert.throws(() => compile(source, proposal, [{ ...answer, ...patch }], 2));
  }
  assert.throws(() => compile(source, proposal, [], 2));
  assert.equal(compile(source, proposal, [answer], 2).publishable, true);
});

test('prototype: explicit scoped omission removes only the approved source choice', () => {
  const proposal = { ...empty, decisions: [{ ref: 'a2', kind: 'omit', answerId: 'q2' }] };
  const answer = { id: 'q2', ref: 'a2', kind: 'omit', value: true, revision: 1 };
  const result = compile(source, proposal, [answer], 1);
  assert.deepEqual(
    result.requirements.map((item) => item.ref),
    ['a1', 'a3', 'a4']
  );
  assert.throws(() => compile(source, proposal, [{ ...answer, value: false }], 1), /NOT_APPROVED/);
});

test('prototype: choice-only metadata cannot become any typed input, including a disguised text date', () => {
  assert.throws(
    () => compile(source, { ...empty, inputs: [{ name: 'maintenance_date', sourceRef: 'a1' }] }, [], 1),
    /EDITABLE_SOURCE/
  );
  assert.throws(
    () => compile(source, { ...empty, inputs: [{ name: 'unknown', sourceRef: 'invented' }] }, [], 1),
    /EDITABLE_SOURCE/
  );
  assert.equal(
    compile(source, { ...empty, inputs: [{ name: 'business_id', sourceRef: 'a5' }] }, [], 1).requirements
      .length,
    4
  );
});

test('prototype: unknown or repeated decision references are rejected rather than last-write-wins', () => {
  for (const decisions of [
    [{ ref: 'invented', kind: 'preserve' }],
    [
      { ref: 'a1', kind: 'preserve' },
      { ref: 'a1', kind: 'omit', answerId: 'q' },
    ],
  ]) {
    assert.throws(() => compile(source, { ...empty, decisions }, [], 1), /INVALID_SOURCE/);
  }
});
