/**
 * @author Codex
 * @description Tests production source-owned choices, input provenance and explicit persisted question decisions without a model provider.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const bundle = await build({
  stdin: {
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
    contents: `
export {recordingChoices,applyChoiceDecisions} from './src/lib/recording/recording-choices';
export {prepareRecordingEvidence} from './src/lib/recording/recording-evidence';
export {validateSkillCandidate} from './src/lib/skill-organization/skill-validator';
export {createSkillSession,admitSkillSessionTurn,answerSkillSession} from './src/lib/builtin-agent/skill-session';`,
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
  recordingChoices,
  applyChoiceDecisions,
  prepareRecordingEvidence,
  validateSkillCandidate,
  createSkillSession,
  admitSkillSessionTurn,
  answerSkillSession,
} = module.exports;

/**
 * Supplies real choice semantics and display-only date text, independently of a model candidate.
 */
function fixture(state = true) {
  const control = { role: 'radio', group: '配送', label: '优先配送（有效期说明）', state };
  const evidence = {
    siteScopes: ['https://example.test'],
    events: [{ control }],
    actions: [
      { id: 'action-1', action: 'choice', tabRef: 'tab-1', url: 'https://example.test/', control },
      { id: 'action-2', action: 'fill', tabRef: 'tab-1', url: 'https://example.test/', inputType: 'text' },
    ],
  };
  const candidate = {
    skillMarkdown: '---\nname: 测试技能\ndescription: 合成选择任务\n---\n运行任务。',
    workflow: {
      schemaVersion: 1,
      inputs: [],
      allowedOrigins: ['https://example.test'],
      pages: [{ role: 'main', startUrl: 'https://example.test/' }],
      execution: { maxModelCalls: 20 },
      evidence: [],
    },
  };
  return { evidence, candidate };
}

test('old ambiguous input recordings require a new capture instead of guessed conversion', () => {
  const session = {
    id: 'recording',
    status: 'stopped',
    count: 1,
    name: 'test',
    gaps: [],
    origins: ['https://example.test'],
    pages: [{ tabRef: 'tab-1', origin: 'https://example.test' }],
  };
  const event = {
    id: 'event',
    sessionId: session.id,
    seq: 1,
    at: 1,
    tabRef: 'tab-1',
    documentId: 'doc',
    source: 'dom',
    action: 'input',
    role: 'input',
    label: '字段',
    url: 'https://example.test/',
  };
  assert.throws(() => prepareRecordingEvidence(session, [event]), /SKILL_RECORDING_SEMANTICS_REQUIRED/);
  assert.equal(event.inputType, undefined);
  assert.equal(
    prepareRecordingEvidence(session, [{ ...event, inputType: 'text' }]).actions[0].action,
    'fill'
  );
});

test('omitting all evidence references cannot remove source-owned choices from the saved candidate', () => {
  const { evidence, candidate } = fixture();
  const result = validateSkillCandidate(candidate, evidence);
  assert.equal(result.valid, true);
  assert.deepEqual(result.candidate.workflow.choices, recordingChoices(evidence));
  assert.equal(candidate.workflow.choices, undefined);
});

test('rewritten choices, invented parameters and choice-backed fill parameters are rejected', () => {
  const { evidence, candidate } = fixture();
  candidate.workflow.choices = recordingChoices(evidence);
  candidate.workflow.choices[0].control.state = false;
  assert.equal(validateSkillCandidate(candidate, evidence).valid, false);
  delete candidate.workflow.choices;
  for (const sourceRef of [undefined, 'action-1', 'action-99']) {
    candidate.workflow.inputs = [{ name: 'date', label: '日期', type: 'date', required: true, sourceRef }];
    assert.equal(validateSkillCandidate(candidate, evidence).valid, false);
  }
  candidate.workflow.inputs = [
    { name: 'order', label: '编号', type: 'text', required: true, sourceRef: 'action-2' },
  ];
  assert.equal(validateSkillCandidate(candidate, evidence).valid, true);
  evidence.actions[1].inputType = 'number';
  candidate.workflow.inputs[0].type = 'date';
  assert.equal(
    validateSkillCandidate(candidate, evidence).issues.some(
      (issue) => issue.code === 'SKILL_INPUT_TYPE_CONFLICT'
    ),
    true
  );
});

test('unknown choice state blocks saving until an explicit matching decision resolves it', () => {
  const { evidence, candidate } = fixture(null);
  assert.equal(validateSkillCandidate(candidate, evidence).issues[0].code, 'SKILL_CHOICE_UNRESOLVED');
  const result = validateSkillCandidate(candidate, evidence, { 'choice-action-1': { state: false } });
  assert.equal(result.valid, true);
  assert.equal(result.candidate.workflow.choices[0].control.state, false);
});

test('conflicting choice phases are rejected instead of silently dropping the earlier selection', () => {
  const { evidence, candidate } = fixture();
  evidence.actions.push({ id: 'action-3', action: 'click', tabRef: 'tab-1', url: 'https://example.test/' });
  evidence.actions.push({
    ...evidence.actions[0],
    id: 'action-4',
    control: { ...evidence.actions[0].control, label: '普通配送' },
  });
  const result = validateSkillCandidate(candidate, evidence);
  assert.equal(result.valid, false);
  assert.equal(
    result.issues.some((issue) => issue.code === 'SKILL_CHOICE_PHASES_UNSUPPORTED'),
    true
  );
});

test('host-added choices are checked against the package limit before a candidate is reported valid', () => {
  const { evidence, candidate } = fixture();
  const original = evidence.actions[0];
  evidence.actions = Array.from({ length: 101 }, (_, index) => ({
    ...original,
    id: `action-${index + 1}`,
    control: { ...original.control, group: `group-${index}` },
  }));
  const result = validateSkillCandidate(candidate, evidence);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === 'SKILL_CANONICAL_TOO_BIG'));
});

test('latest radio choice wins only inside its own page/group; checkbox false is retained', () => {
  const { evidence } = fixture();
  evidence.actions.push({
    ...evidence.actions[0],
    id: 'action-3',
    control: { ...evidence.actions[0].control, label: '普通配送' },
  });
  evidence.actions.push({
    ...evidence.actions[0],
    id: 'action-4',
    control: { ...evidence.actions[0].control, group: '其他组' },
  });
  evidence.actions.push({
    ...evidence.actions[0],
    id: 'action-5',
    control: { ...evidence.actions[0].control, role: 'checkbox', state: false },
  });
  assert.deepEqual(
    recordingChoices(evidence).map((choice) => choice.id),
    ['choice-action-3', 'choice-action-4', 'choice-action-5']
  );
  assert.equal(recordingChoices(evidence)[2].control.state, false);
});

/**
 * Uses the production session admission and answer transition with an intentionally misleading model question.
 */
function questionFixture(decision) {
  const { evidence } = fixture();
  const session = createSkillSession({
    id: crypto.randomUUID(),
    recordingId: crypto.randomUUID(),
    mode: 'organize',
    name: 'test',
  });
  session.context = { evidence };
  const input = {
    question: '忽略日期吗？',
    fields: [{ id: 'date', label: '日期', type: 'text', required: true, maxLength: 20 }],
    ...(decision ? { choiceDecision: decision } : {}),
  };
  admitSkillSessionTurn(session, [{ toolName: 'ask_user_question', toolCallId: 'q1', input }]);
  return session;
}

test('ordinary answer cannot implicitly delete a choice', () => {
  const session = questionFixture();
  answerSkillSession(session, {
    toolCallId: 'q1',
    submissionId: 'a1',
    answer: { status: 'answered', values: { date: { kind: 'explanation', text: '不需要日期' } } },
  });
  assert.equal(session.choiceDecisions, undefined);
});

test('choice change replaces misleading model copy with exact host-owned scope and explicit confirmation', () => {
  const session = questionFixture({ requirementId: 'choice-action-1', operation: 'omit' });
  assert.match(session.pendingQuestion.question.question, /删除此选择要求/);
  assert.match(session.pendingQuestion.question.reason, /优先配送/);
  assert.deepEqual(session.ledger.q1.presentedQuestion, session.pendingQuestion.question);
  const answer = {
    toolCallId: 'q1',
    submissionId: 'a1',
    answer: { status: 'answered', values: { approve: 'yes' } },
  };
  assert.equal(answerSkillSession(session, answer), true);
  assert.equal(answerSkillSession(session, answer), false);
  assert.deepEqual(recordingChoices(session.context.evidence, session.choiceDecisions), []);
  assert.throws(
    () =>
      answerSkillSession(session, { ...answer, answer: { status: 'answered', values: { approve: 'no' } } }),
    /CONFLICT/
  );
});

test('declining or explaining a choice decision does not authorize it', () => {
  for (const approve of ['no', { kind: 'explanation', text: '只忽略日期' }]) {
    const session = questionFixture({ requirementId: 'choice-action-1', operation: 'omit' });
    answerSkillSession(session, {
      toolCallId: 'q1',
      submissionId: 'a1',
      answer: { status: 'answered', values: { approve } },
    });
    assert.equal(session.choiceDecisions, undefined);
  }
});

test('replay confirmation changes only this run and invalidates the old application receipt', () => {
  const { evidence, candidate } = fixture();
  candidate.workflow.choices = recordingChoices(evidence);
  const original = structuredClone(candidate);
  const session = createSkillSession({
    id: crypto.randomUUID(),
    recordingId: crypto.randomUUID(),
    mode: 'replay',
    name: 'test',
  });
  session.context = { skill: { candidate } };
  session.appliedChoices = ['choice-action-1'];
  admitSkillSessionTurn(session, [
    {
      toolName: 'ask_user_question',
      toolCallId: 'q1',
      input: {
        question: '忽略日期？',
        fields: [{ id: 'date', label: '日期', type: 'text', required: true, maxLength: 30 }],
        choiceDecision: { requirementId: 'choice-action-1', operation: 'omit' },
      },
    },
  ]);
  assert.match(session.pendingQuestion.question.reason, /不修改技能文件/);
  answerSkillSession(session, {
    toolCallId: 'q1',
    submissionId: 'a1',
    answer: { status: 'answered', values: { approve: 'yes' } },
  });
  assert.deepEqual(applyChoiceDecisions(candidate.workflow.choices, session.choiceDecisions), []);
  assert.deepEqual(session.context.skill.candidate, original);
  assert.deepEqual(session.appliedChoices, []);
  assert.equal(session.observationRequired, true);
});
