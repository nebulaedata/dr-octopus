/**
 * @author Codex
 * @description Verifies immutable requirement inputs and unknown-effect handling of the test-only choice phase.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { choiceToolPrototype } from './fixtures/choice-tool-prototype.mjs';

const required = { id: 'choice', group: '配送', option: '优先', role: 'radio', checked: true };

test('model cannot supply a replacement option, group, state or raw element index', () => {
  const prototype = choiceToolPrototype([required], {});
  for (const patch of [{ option: '普通' }, { checked: false }, { group: '发票' }, { elementIndex: 1 }]) {
    assert.equal(
      prototype.tools.apply_choice.inputSchema.safeParse({ requirementId: 'choice', ...patch }).success,
      false
    );
  }
});

test('requirements cannot contain unknown state, conflicting targets or duplicate identities', () => {
  assert.throws(() => choiceToolPrototype([{ ...required, checked: 'unknown' }], {}));
  assert.throws(() => choiceToolPrototype([required, { ...required, checked: false }], {}));
  assert.throws(() => choiceToolPrototype([required, { ...required, id: 'other', checked: false }], {}));
});

test('changing source or exported requirements cannot retarget an already created phase', async () => {
  const original = structuredClone(required);
  const prototype = choiceToolPrototype([original], {
    observe: async () => [{ ...required, enabled: true }],
  });
  original.option = '普通';
  prototype.requirements[0].option = '普通';
  assert.deepEqual(await prototype.tools.apply_choice.execute({ requirementId: 'choice' }), {
    status: 'satisfied',
    changed: false,
  });
});

test('failed post-action observation blocks automatic retry and completion', async () => {
  let observations = 0;
  let actions = 0;
  const prototype = choiceToolPrototype([required], {
    observe: async () => {
      if (++observations > 1) {
        throw Error('observation failed');
      }
      return [{ ...required, checked: false, enabled: true }];
    },
    apply: async () => {
      actions++;
      return 'applied';
    },
  });
  assert.equal(
    (await prototype.tools.apply_choice.execute({ requirementId: 'choice' })).status,
    'outcome_unknown'
  );
  assert.equal(
    (await prototype.tools.apply_choice.execute({ requirementId: 'choice' })).status,
    'outcome_unknown'
  );
  assert.equal((await prototype.tools.finish_run.execute({})).finished, false);
  assert.equal(actions, 1);
});
