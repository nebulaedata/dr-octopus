/**
 * @author Codex
 * @description Regresses production session ownership, linear questions and non-replaying external tool transitions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const bundle = await build({
  stdin: {
    contents:
      "export * from './src/lib/builtin-agent/skill-session'; export * from './src/lib/builtin-agent/skill-question'; export * from './src/lib/builtin-agent/skill-response';",
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
const {
  recordSkillResponse,
  createSkillSession,
  extendSkillBudget,
  reserveSkillModelCall,
  admitSkillSessionTurn,
  answerSkillSession,
  dispatchSkillTool,
  settleSkillTool,
  interruptSkillSession,
  completeSkillTool,
  skillToolResult,
  skillQuestionSchema,
  validateSkillAnswer,
} = module.exports;
const question = {
  question: '请输入本次订单编号',
  fields: [{ id: 'orderNo', label: '订单编号', type: 'text', required: true, maxLength: 100 }],
  allowDefer: false,
};
/**
 * Creates a reproducible task without a provider or browser.
 */
function session(mode = 'replay') {
  return createSkillSession({ id: 'session-1', recordingId: 'recording-1', name: '查询订单', mode }, 1);
}
/**
 * Constructs one external invocation.
 */
function call(toolName, toolCallId, input = {}) {
  return { toolName, toolCallId, input };
}

test('ask wins over an earlier action and additional questions get paired rejections', () => {
  const current = session();
  const result = admitSkillSessionTurn(current, [
    call('browser_fill', 'a1'),
    call('ask_user_question', 'q1', question),
    call('ask_user_question', 'q2', question),
  ]);
  assert.equal(result.effect, undefined);
  assert.equal(current.status, 'waiting_user');
  assert.equal(current.pendingQuestion.toolCallId, 'q1');
  assert.deepEqual(
    result.rejected.map((item) => [item.toolCallId, item.output.value]),
    [
      ['a1', 'SKILL_USER_ANSWER_REQUIRED'],
      ['q2', 'SKILL_QUESTION_ALREADY_PENDING'],
    ]
  );
  assert.throws(() => dispatchSkillTool(current, 'a1'), /STALE/);
});

test('completed cumulative observations are excluded, one effect is dispatched, duplicate dispatch fails', () => {
  const current = session();
  const observed = call('browser_snapshot', 'o1');
  completeSkillTool(current, observed, skillToolResult(observed, { snapshotId: 's1' }));
  current.observationRequired = false;
  const result = admitSkillSessionTurn(current, [
    observed,
    call('browser_click', 'a1'),
    call('browser_click', 'a2'),
  ]);
  assert.equal(result.effect.toolCallId, 'a1');
  assert.equal(current.toolCalls, 2);
  assert.equal(result.rejected[0].output.value, 'SKILL_OBSERVE_BEFORE_NEXT_ACTION');
  dispatchSkillTool(current, 'a1');
  assert.throws(() => dispatchSkillTool(current, 'a1'), /OUTCOME_PENDING/);
  settleSkillTool(current, 'a1', { businessEffect: 'applied' });
  assert.equal(current.observationRequired, true);
});

test('answers preserve leading zeros and require new observation before replay side effects', () => {
  const current = session();
  admitSkillSessionTurn(current, [call('ask_user_question', 'q1', question)]);
  const input = {
    submissionId: 'answer-1',
    toolCallId: 'q1',
    answer: { status: 'answered', values: { orderNo: '000123' } },
  };
  assert.equal(answerSkillSession(current, input), true);
  assert.equal(answerSkillSession(current, input), false);
  assert.equal(current.messages.length, 1);
  assert.equal(current.messages[0].content[0].output.value.values.orderNo, '000123');
  assert.throws(
    () =>
      answerSkillSession(current, {
        ...input,
        answer: { status: 'answered', values: { orderNo: 'different' } },
      }),
    /CONFLICT/
  );
  assert.equal(
    admitSkillSessionTurn(current, [call('browser_fill', 'a1')]).rejected[0].output.value,
    'SKILL_OBSERVATION_REQUIRED'
  );
});

test('restart preserves pending questions but freezes unknown effects and replaces the execution epoch', () => {
  const waiting = session();
  admitSkillSessionTurn(waiting, [call('ask_user_question', 'q1', question)]);
  const epoch = waiting.epoch;
  interruptSkillSession(waiting);
  assert.equal(waiting.status, 'waiting_user');
  assert.notEqual(waiting.epoch, epoch);
  assert.equal(waiting.pendingQuestion.toolCallId, 'q1');
  const running = session();
  running.observationRequired = false;
  admitSkillSessionTurn(running, [call('browser_click', 'o1')]);
  dispatchSkillTool(running, 'o1');
  interruptSkillSession(running, true);
  assert.equal(running.status, 'outcome_unknown');
  assert.throws(() => admitSkillSessionTurn(running, [call('browser_click', 'different-id')]), /STALE/);
});

test('model budget and owner checks remain cumulative across serialization', () => {
  const current = session('organize');
  for (let i = 0; i < 50; i++) {
    reserveSkillModelCall(current, current.epoch);
  }
  const resumed = structuredClone(current);
  assert.throws(() => reserveSkillModelCall(resumed, resumed.epoch), /MODEL_BUDGET/);
  assert.throws(() => reserveSkillModelCall(resumed, 'old'), /STALE/);
});

test('invalid and unauthorized tool turns never grant browser privileges to organizer', () => {
  const current = session('organize');
  assert.equal(
    admitSkillSessionTurn(current, [call('browser_click', 'a1')]).rejected[0].output.value,
    'SKILL_TOOL_FORBIDDEN'
  );
  assert.throws(() => admitSkillSessionTurn(current, [call('submit_skill', '__proto__')]), /CONFLICT/);
  assert.throws(
    () => admitSkillSessionTurn(current, [call('submit_skill', 'dup'), call('submit_skill', 'dup')]),
    /CONFLICT/
  );
});

test('multi-type answers reject undeclared values, invalid dates, duplicate choices and unsupported secret fields', () => {
  const q = skillQuestionSchema.parse({
    question: '确认查询信息',
    allowDefer: false,
    fields: [
      { id: 'email', label: '邮箱', type: 'email', required: true, maxLength: 100 },
      { id: 'count', label: '数量', type: 'number', required: true, min: 1, max: 5 },
      { id: 'date', label: '日期', type: 'date', required: true },
      {
        id: 'types',
        label: '类型',
        type: 'multiple',
        required: true,
        min: 1,
        max: 2,
        options: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
      },
    ],
  });
  const values = { email: 'demo@example.com', count: 2, date: '2026-11-01', types: ['a'] };
  assert.equal(validateSkillAnswer(q, { status: 'answered', values }).values.count, 2);
  for (const changes of [
    { email: 'bad' },
    { count: '2' },
    { count: NaN },
    { date: '2026-02-30' },
    { types: ['a', 'a'] },
    { unknown: 'x' },
  ]) {
    assert.throws(
      () => validateSkillAnswer(q, { status: 'answered', values: { ...values, ...changes } }),
      /INVALID/
    );
  }
  assert.throws(() => validateSkillAnswer(q, { status: 'deferred' }), /REQUIRED/);
  assert.equal(
    skillQuestionSchema.safeParse({ ...question, fields: [{ ...question.fields[0], type: 'password' }] })
      .success,
    false
  );
});

test('interruption closes undispatched actions and interrupted reads without inventing an action outcome', () => {
  const pending = session();
  pending.observationRequired = false;
  admitSkillSessionTurn(pending, [call('browser_click', 'pending')]);
  interruptSkillSession(pending);
  assert.equal(pending.ledger.pending.result.output.value, 'SKILL_NOT_DISPATCHED');
  assert.equal(pending.status, 'interrupted');
  const reading = session();
  admitSkillSessionTurn(reading, [call('browser_snapshot', 'read')]);
  dispatchSkillTool(reading, 'read');
  interruptSkillSession(reading);
  assert.equal(reading.ledger.read.result.output.value, 'SKILL_INTERRUPTED_READ');
  assert.equal(reading.status, 'interrupted');
  assert.equal(reading.observationRequired, true);
});

test('failed observation never unlocks actions after a user answer', () => {
  const current = session();
  admitSkillSessionTurn(current, [call('browser_snapshot', 'failed-read')]);
  dispatchSkillTool(current, 'failed-read');
  settleSkillTool(current, 'failed-read', { error: 'TARGET_CHANGED' });
  assert.equal(current.observationRequired, true);
  assert.equal(
    admitSkillSessionTurn(current, [call('browser_click', 'action')]).rejected[0].output.value,
    'SKILL_OBSERVATION_REQUIRED'
  );
});

test('explicit budget extension preserves completed tools and rejects duplicate or unknown-effect continuation', () => {
  const current = session('replay');
  current.modelCalls = 100;
  current.status = 'failed';
  current.error = 'SKILL_MODEL_BUDGET';
  current.ledger.done = { toolName: 'browser_fill', toolCallId: 'done', input: {}, state: 'completed' };
  const oldEpoch = current.epoch;
  extendSkillBudget(current, 20);
  assert.equal(current.modelCallLimit, 120);
  assert.equal(current.modelCalls, 100);
  assert.equal(current.ledger.done.state, 'completed');
  assert.equal(current.observationRequired, true);
  assert.notEqual(current.epoch, oldEpoch);
  assert.throws(() => extendSkillBudget(current, 20), /STALE/);
  current.status = 'failed';
  current.error = 'SKILL_MODEL_BUDGET';
  current.ledger.pending = { toolName: 'browser_click', toolCallId: 'pending', input: {}, state: 'unknown' };
  assert.throws(() => extendSkillBudget(current, 20), /STALE/);
  delete current.ledger.pending;
  current.modelCallLimit = 500;
  assert.throws(() => extendSkillBudget(current, 1), /BUDGET_LIMIT/);
});
test('new replay limits are user owned, not lowered by a model-generated skill limit', () => {
  const current = session('replay');
  current.context = { skill: { candidate: { workflow: { execution: { maxModelCalls: 1 } } } } };
  for (let i = 0; i < 100; i++) {
    reserveSkillModelCall(current, current.epoch);
  }
  assert.throws(() => reserveSkillModelCall(current, current.epoch), /MODEL_BUDGET/);
});

test('field explanations override required typed inputs and remain tool results rather than free chat', () => {
  const fields = [
    { id: 'date', label: '有效期', type: 'date', required: true },
    { id: 'number', label: '数量', type: 'number', required: true, min: 1, max: 5 },
    {
      id: 'kind',
      label: '类型',
      type: 'single',
      required: true,
      options: [
        { id: 'one', label: '一' },
        { id: 'two', label: '二' },
      ],
    },
    {
      id: 'many',
      label: '多选',
      type: 'multiple',
      required: true,
      min: 2,
      max: 2,
      options: [
        { id: 'one', label: '一' },
        { id: 'two', label: '二' },
      ],
    },
  ];
  const q = { question: '请确认', fields, allowDefer: false };
  const values = Object.fromEntries(
    fields.map((field) => [field.id, { kind: 'explanation', text: '无需此参数，请移除。' }])
  );
  assert.deepEqual(validateSkillAnswer(q, { status: 'answered', values }).values, values);
  assert.throws(
    () =>
      validateSkillAnswer(q, {
        status: 'answered',
        values: { ...values, date: { kind: 'explanation', text: '  ' } },
      }),
    /SKILL_ANSWER_INVALID/
  );
  assert.throws(
    () =>
      validateSkillAnswer(q, {
        status: 'answered',
        values: { ...values, unknown: { kind: 'explanation', text: '越界' } },
      }),
    /SKILL_ANSWER_INVALID/
  );
  assert.throws(
    () =>
      validateSkillAnswer(q, {
        status: 'answered',
        values: { ...values, date: { kind: 'explanation', text: 'x'.repeat(2001) } },
      }),
    /SKILL_ANSWER_INVALID/
  );
  const session = createSkillSession({
    id: crypto.randomUUID(),
    recordingId: crypto.randomUUID(),
    name: '说明',
    mode: 'organize',
  });
  admitSkillSessionTurn(session, [
    { toolName: 'ask_user_question', toolCallId: 'ask-explanation', input: q },
  ]);
  answerSkillSession(session, {
    submissionId: 'explanation-answer',
    toolCallId: 'ask-explanation',
    answer: { status: 'answered', values },
  });
  assert.equal(session.messages.at(-1).role, 'tool');
  assert.deepEqual(session.messages.at(-1).content[0].output.value.values, values);
});

test('text-only turns are retained and correction allowance survives serialization without resetting model budget', () => {
  for (const mode of ['organize', 'replay']) {
    let session = createSkillSession({
      id: crypto.randomUUID(),
      recordingId: crypto.randomUUID(),
      name: 'response',
      mode,
    });
    reserveSkillModelCall(session, session.epoch);
    const messages = [{ role: 'assistant', content: [{ type: 'text', text: '正常文本总结' }] }];
    assert.equal(recordSkillResponse(session, [], messages, 'stop'), 'recover');
    assert.equal(session.messages.at(-1).content[0].text, '正常文本总结');
    assert.equal(session.responses[0].classification, 'text_only');
    assert.equal(session.status, 'running');
    session = JSON.parse(JSON.stringify(session));
    reserveSkillModelCall(session, session.epoch);
    assert.equal(session.responseRecoveryCalls, 1);
    assert.equal(recordSkillResponse(session, [], messages, 'stop'), 'recover');
    reserveSkillModelCall(session, session.epoch);
    assert.equal(recordSkillResponse(session, [], messages, 'stop'), 'fail');
    assert.equal(session.error, 'SKILL_RESPONSE_RECOVERY_EXHAUSTED');
    assert.equal(session.modelCalls, 3);
    assert.equal(session.messages.length, 3);
  }
});
test('empty, reasoning-only, truncated and filtered responses retain metadata and never dispatch parsed actions', () => {
  for (const [reason, expected] of [
    ['stop', 'MODEL_EMPTY_RESPONSE'],
    ['length', 'MODEL_OUTPUT_TRUNCATED'],
    ['content-filter', 'MODEL_RESPONSE_FILTERED'],
    ['error', 'MODEL_RESPONSE_ERROR'],
    ['other', 'MODEL_FINISH_UNKNOWN'],
  ]) {
    const session = createSkillSession({
      id: crypto.randomUUID(),
      recordingId: crypto.randomUUID(),
      name: 'response',
      mode: 'replay',
    });
    const calls =
      reason === 'length' ? [{ toolName: 'browser_click', toolCallId: 'partial', input: {} }] : [];
    assert.equal(
      recordSkillResponse(
        session,
        calls,
        [{ role: 'assistant', content: [{ type: 'reasoning', text: 'Only reasoning' }] }],
        reason
      ),
      'fail'
    );
    assert.equal(session.error, expected);
    assert.equal(session.responses[0].finishReason, reason);
    assert.equal(session.responses[0].reasoningLength, 14);
    assert.equal(session.responseRecoveryCalls, undefined);
    if (calls.length) {
      assert.equal(session.ledger.partial.result.output.value, 'SKILL_RESPONSE_NOT_EXECUTED');
    }
  }
});
test('replay correction cannot mutate pages even with a new call ID, and real answers restore normal observation gates', () => {
  const session = createSkillSession({
    id: crypto.randomUUID(),
    recordingId: crypto.randomUUID(),
    name: 'response',
    mode: 'replay',
  });
  session.observationRequired = false;
  session.responseRecovery = true;
  const result = admitSkillSessionTurn(session, [
    { toolName: 'browser_click', toolCallId: 'new-click', input: {} },
  ]);
  assert.equal(result.effect, undefined);
  assert.equal(result.rejected[0].output.value, 'SKILL_RECOVERY_ACTION_BLOCKED');
  admitSkillSessionTurn(session, [
    { toolName: 'ask_user_question', toolCallId: 'ask-recovery', input: question },
  ]);
  answerSkillSession(session, {
    submissionId: 'real-answer',
    toolCallId: 'ask-recovery',
    answer: { status: 'answered', values: { orderNo: '123' } },
  });
  assert.equal(session.responseRecovery, false);
  assert.equal(session.observationRequired, true);
});

test('correction respects the original model budget and cannot bypass unsettled side effects', () => {
  const session = createSkillSession({
    id: crypto.randomUUID(),
    recordingId: crypto.randomUUID(),
    name: 'budget',
    mode: 'replay',
  });
  session.modelCallLimit = 1;
  reserveSkillModelCall(session, session.epoch);
  recordSkillResponse(session, [], [{ role: 'assistant', content: '总结' }], 'stop');
  assert.throws(() => reserveSkillModelCall(session, session.epoch), /SKILL_MODEL_BUDGET/);
  assert.equal(session.modelCalls, 1);
  assert.equal(session.responses[0].textLength, 2);
  session.modelCallLimit = 100;
  session.ledger.uncertain = {
    toolCallId: 'uncertain',
    toolName: 'browser_click',
    input: {},
    state: 'unknown',
  };
  assert.throws(() => reserveSkillModelCall(session, session.epoch), /SKILL_OUTCOME_UNKNOWN/);
  assert.equal(session.modelCalls, 1);
  assert.equal(session.responseRecoveryCalls, undefined);
  const epoch = session.epoch;
  interruptSkillSession(session, true);
  assert.notEqual(session.epoch, epoch);
  assert.equal(session.status, 'outcome_unknown');
});

test('a valid organizer tool request ends correction mode without resetting its lifetime correction count', () => {
  const session = createSkillSession({
    id: crypto.randomUUID(),
    recordingId: crypto.randomUUID(),
    name: 'organization',
    mode: 'organize',
  });
  recordSkillResponse(session, [], [{ role: 'assistant', content: '准备整理' }], 'stop');
  reserveSkillModelCall(session, session.epoch);
  const call = { toolName: 'read_recording', toolCallId: 'read-after-text', input: { offset: 0, limit: 20 } };
  assert.equal(
    recordSkillResponse(
      session,
      [call],
      [{ role: 'assistant', content: [{ type: 'tool-call', ...call }] }],
      'tool-calls'
    ),
    'dispatch'
  );
  assert.equal(session.responseRecovery, false);
  assert.equal(session.responseRecoveryCalls, 1);
  reserveSkillModelCall(session, session.epoch);
  assert.equal(session.responseRecoveryCalls, 1);
});
