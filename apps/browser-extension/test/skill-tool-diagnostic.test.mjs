/**
 * @author Codex
 * @description Regresses optional question policy, private SDK validation diagnostics and evidence-based correction states.
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
      "export * from './src/lib/builtin-agent/skill-question'; export * from './src/lib/builtin-agent/skill-tool-diagnostic';",
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
const { skillQuestionSchema, validateSkillAnswer, safeToolIssues, toolInputIssues, skillToolDiagnostic } =
  module.exports;

test('access diagnostics accept only finite reasons, tab IDs and origin-only URLs', () => {
  const session = {
    messages: [],
    ledger: {
      denied: {
        toolName: 'browser_snapshot',
        result: {
          output: {
            type: 'json',
            value: {
              error: 'FORBIDDEN_PAGE',
              access: { reason: 'permission', tabId: 4, origin: 'https://fixture.test' },
            },
          },
        },
      },
    },
  };
  assert.deepEqual(skillToolDiagnostic(session, 'denied', 'browser_snapshot', '', 0).access, {
    reason: 'permission',
    tabId: 4,
    origin: 'https://fixture.test',
  });
  session.ledger.denied.result.output.value.access.origin =
    'https://user:secret@fixture.test/path?private=value';
  assert.equal(skillToolDiagnostic(session, 'denied', 'browser_snapshot', '', 0).access, undefined);
});

test('omitted allowDefer defaults false without weakening actual question validation', () => {
  const input = {
    question: '查询编号？',
    fields: [{ id: 'order', label: '编号', required: true, type: 'text', maxLength: 30 }],
  };
  const question = skillQuestionSchema.parse(input);
  assert.equal(question.allowDefer, false);
  assert.throws(() => validateSkillAnswer(question, { status: 'deferred' }), /SKILL_ANSWER_REQUIRED/);
  assert.equal(skillQuestionSchema.safeParse({ ...input, allowDefer: 'true' }).success, false);
  assert.equal(skillQuestionSchema.safeParse({ ...input, fields: [] }).success, false);
  assert.equal(
    skillQuestionSchema.safeParse({ ...input, fields: [{ ...input.fields[0], required: 'yes' }] }).success,
    false
  );
  assert.equal(skillQuestionSchema.parse({ ...input, allowDefer: true }).allowDefer, true);
});

test('SDK cause diagnostics retain only bounded codes and safe schema paths', () => {
  const error = {
    message: 'PRIVATE_SDK_VALUE',
    cause: {
      cause: {
        issues: [
          {
            code: 'invalid_type',
            path: ['fields', 0, 'required'],
            received: 'PRIVATE_VALUE',
            message: 'SECRET',
          },
        ],
      },
    },
  };
  assert.deepEqual(toolInputIssues(error), [{ code: 'INVALID_TYPE', path: ['fields', 0, 'required'] }]);
  const safe = safeToolIssues([
    { code: 'bad secret value', path: ['fields', -1, 'PRIVATE_FIELD'], message: 'SECRET' },
  ]);
  assert.deepEqual(safe, [{ code: 'SKILL_TOOL_INPUT_INVALID', path: ['fields', '[field]', '[field]'] }]);
  assert.equal(/PRIVATE|SECRET/.test(JSON.stringify({ safe, issues: toolInputIssues(error) })), false);
  assert.deepEqual(toolInputIssues({ message: 'Type validation failed: PRIVATE' }), []);
});

/**
 * Reproduces a rejected SDK question followed by a separate, durably admitted valid question.
 */
function correctedSession() {
  return {
    status: 'waiting_user',
    pendingQuestion: { toolCallId: 'new' },
    messages: [
      { role: 'tool', content: [] },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'new', toolName: 'ask_user_question' }],
      },
    ],
    ledger: {
      old: {
        toolName: 'ask_user_question',
        invalid: true,
        state: 'completed',
        inputIssues: [{ code: 'INVALID_TYPE', path: ['fields', 0, 'required'] }],
        result: { output: { type: 'error-text', value: 'SKILL_TOOL_INPUT_INVALID' } },
      },
      new: { toolName: 'ask_user_question', invalid: false, state: 'pending' },
    },
  };
}

test('ledger code survives canonical SDK error text and a valid pending question proves correction', () => {
  const result = skillToolDiagnostic(
    correctedSession(),
    'old',
    'ask_user_question',
    'Invalid input for tool: PRIVATE_VALUE',
    0
  );
  assert.equal(result.code, 'SKILL_TOOL_INPUT_INVALID');
  assert.equal(result.recovered, true);
  assert.deepEqual(result.issues, [{ code: 'INVALID_TYPE', path: ['fields', 0, 'required'] }]);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});

test('repeated invalid calls, unrelated tools and unknown results never masquerade as corrected', () => {
  const session = correctedSession();
  session.ledger.new.invalid = true;
  assert.equal(skillToolDiagnostic(session, 'old', 'ask_user_question', '', 0).recovered, false);
  session.ledger.new.invalid = false;
  session.ledger.new.state = 'unknown';
  assert.equal(skillToolDiagnostic(session, 'old', 'ask_user_question', '', 0).recovered, false);
  session.ledger.new.state = 'completed';
  session.ledger.new.result = { output: { type: 'json', value: { error: 'SKILL_QUESTION_BUDGET' } } };
  assert.equal(skillToolDiagnostic(session, 'old', 'ask_user_question', '', 0).recovered, false);
  session.ledger.new.result = { output: { type: 'json', value: { status: 'answered' } } };
  assert.equal(skillToolDiagnostic(session, 'old', 'ask_user_question', '', 0).recovered, true);
  assert.equal(skillToolDiagnostic(session, 'old', 'browser_click', 'OUTCOME_UNKNOWN', 0).recovered, false);
  session.ledger.old.result.output.value = 'SKILL_QUESTION_BUDGET';
  assert.equal(skillToolDiagnostic(session, 'old', 'ask_user_question', '', 0).recovered, false);
});
