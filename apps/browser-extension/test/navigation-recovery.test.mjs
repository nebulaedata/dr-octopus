/**
 * @author Codex
 * @description Regresses production navigation admission and persisted access-recovery gates.
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
      "export * from './src/lib/builtin-agent/skill-session'; export {PageAccessError} from './src/page-access'; export {pageWaitStepTimeout} from './src/page-wait-policy';",
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
const { createSkillSession, admitSkillSessionTurn, dispatchSkillTool, settleSkillTool } = module.exports;

test('all access refusal shapes are strict JSON, including absent tab IDs and non-web origins', () => {
  for (const [reason, tabId, url] of [
    ['scheme', 1, undefined],
    ['private', 1, undefined],
    ['window', 1, undefined],
    ['permission', undefined, 'https://user:secret@fixture.test/path?private=value'],
    ['origin', undefined, 'https://fixture.test'],
  ]) {
    const error = new module.exports.PageAccessError(reason, tabId, url);
    const output = module.exports.skillToolResult(
      { toolName: 'browser_snapshot', toolCallId: reason },
      { error: error.message, access: error.access }
    );
    assert.deepEqual(output, JSON.parse(JSON.stringify(output)));
    assert.equal(JSON.stringify(output).includes('secret'), false);
    assert.equal(Object.values(error.access).includes(undefined), false);
  }
});

test('persisted permission recovery refuses page tools and completed claims, allowing incomplete results', () => {
  const { session } = fixture();
  session.pageAccess = { reason: 'permission', tabId: 1, origin: 'https://fixture.test' };
  const restored = structuredClone(session);
  for (const name of ['browser_navigate', 'browser_open_tab', 'browser_snapshot', 'browser_click']) {
    assert.equal(
      admitSkillSessionTurn(restored, [{ toolName: name, toolCallId: name, input: {} }]).rejected[0].output
        .value,
      'SKILL_ACCESS_RECOVERY_REQUIRED'
    );
  }
  assert.equal(
    admitSkillSessionTurn(restored, [
      { toolName: 'finish_run', toolCallId: 'complete', input: { outcome: 'completed' } },
    ]).rejected[0].output.value,
    'SKILL_ACCESS_RECOVERY_REQUIRED'
  );
  assert.equal(
    admitSkillSessionTurn(restored, [
      { toolName: 'finish_run', toolCallId: 'incomplete', input: { outcome: 'incomplete' } },
    ]).effect.toolName,
    'finish_run'
  );
});

/**
 * Creates an isolated replay and finite navigation request, independent of any business website.
 */
function fixture() {
  return {
    session: createSkillSession({
      id: crypto.randomUUID(),
      recordingId: crypto.randomUUID(),
      mode: 'replay',
      name: '导航恢复验证',
    }),
    navigation: {
      toolName: 'browser_navigate',
      toolCallId: 'navigate',
      input: { tabId: 1, url: 'https://fixture.test/start' },
    },
  };
}

test('navigation requires no old observation but element actions still require a fresh snapshot', () => {
  const { session, navigation } = fixture();
  assert.equal(admitSkillSessionTurn(session, [navigation]).effect.toolName, 'browser_navigate');
  assert.equal(session.observationRequired, true);
  dispatchSkillTool(session, navigation.toolCallId);
  settleSkillTool(session, navigation.toolCallId, {
    businessEffect: 'applied',
    code: 'NAVIGATION_COMPLETED',
  });
  assert.equal(session.observationRequired, true);
  for (const name of ['browser_click', 'browser_fill', 'browser_select', 'apply_choice']) {
    assert.equal(
      admitSkillSessionTurn(session, [{ toolName: name, toolCallId: name, input: {} }]).rejected[0].output
        .value,
      'SKILL_OBSERVATION_REQUIRED'
    );
  }
});

test('navigation cannot bypass unknown effects, response recovery or question priority', () => {
  const uncertain = fixture();
  uncertain.session.status = 'outcome_unknown';
  assert.throws(
    () => admitSkillSessionTurn(uncertain.session, [uncertain.navigation]),
    /SKILL_SESSION_STALE/
  );
  const recovery = fixture();
  recovery.session.responseRecovery = true;
  assert.equal(
    admitSkillSessionTurn(recovery.session, [recovery.navigation]).rejected[0].output.value,
    'SKILL_RECOVERY_ACTION_BLOCKED'
  );
  const asking = fixture();
  const admitted = admitSkillSessionTurn(asking.session, [
    asking.navigation,
    {
      toolName: 'ask_user_question',
      toolCallId: 'question',
      input: {
        question: '请确认当前任务需要的页面访问权限。',
        fields: [{ id: 'answer', label: '处理结果', type: 'text', required: true, maxLength: 100 }],
        allowDefer: true,
      },
    },
  ]);
  assert.equal(admitted.effect, undefined);
  assert.equal(asking.session.status, 'waiting_user');
  assert.equal(admitted.rejected[0].output.value, 'SKILL_USER_ANSWER_REQUIRED');
});

test('SDK deadline includes all configured page waits plus the model allowance', () => {
  assert.equal(module.exports.pageWaitStepTimeout(), 110000);
  assert.equal(module.exports.pageWaitStepTimeout({ seconds: 60, attempts: 5 }), 365000);
});
