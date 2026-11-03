/**
 * @author Codex
 * @description Preserves recording normalization and redaction regressions after removal of the obsolete workflow compiler.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { crossTabWorkflow } from './fixtures/workflow-cross-tab.mjs';
const require = createRequire(import.meta.url);
const bundle = await build({
  stdin: {
    contents:
      "export {modelSettingsSchema,modelSettingsRequestSchema} from './src/lib/model-settings/model-settings-messages'; export {normalizeRecordingActions} from './src/lib/recording/recording-actions'; export {prepareRecordingEvidence} from './src/lib/recording/recording-evidence';",
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
const { normalizeRecordingActions, prepareRecordingEvidence } = module.exports;
test('same edit merges across transport pauses while blur, another target, document or operation remain boundaries', () => {
  const base = {
    id: '20000000-0000-4000-8000-000000000001',
    seq: 1,
    tabRef: 'tab-1',
    source: 'dom',
    action: 'input',
    label: 'Same label',
    url: 'https://example.com',
    targetRef: 'control-1',
    editRef: '30000000-0000-4000-8000-000000000001',
    documentRef: 'document-1',
  };
  const second = { ...base, id: '20000000-0000-4000-8000-000000000002', seq: 2 };
  assert.equal(normalizeRecordingActions([base, second]).length, 1);
  assert.deepEqual(normalizeRecordingActions([base, second])[0].sourceEventIds, [base.id, second.id]);
  for (const patch of [
    { editRef: 'different-edit' },
    { targetRef: 'control-2' },
    { documentRef: 'document-2' },
    { editRef: undefined },
    { targetRef: undefined },
  ]) {
    assert.equal(normalizeRecordingActions([base, { ...second, ...patch }]).length, 2);
  }
  const click = { ...second, id: '20000000-0000-4000-8000-000000000003', action: 'click' };
  assert.equal(normalizeRecordingActions([base, click, { ...second, seq: 3 }]).length, 3);
});

test('42 cross-tab notification interleavings retain every source action and causal order', () => {
  const original = crossTabWorkflow();
  const expected = prepareRecordingEvidence(original.session, original.events).actions.map(
    (action) => action.sourceEventIds
  );
  for (let first = 0; first <= 5; first++) {
    for (let second = 0; second <= 6; second++) {
      const { session, events } = crossTabWorkflow();
      const notices = events.filter((event) => event.source === 'browser');
      const ordered = events.filter((event) => event.source === 'dom');
      ordered.splice(first, 0, notices[0]);
      ordered.splice(second, 0, notices[1]);
      ordered.forEach((event, index) => {
        event.seq = index + 1;
      });
      assert.deepEqual(
        prepareRecordingEvidence(session, ordered).actions.map((action) => action.sourceEventIds),
        expected
      );
    }
  }
});
test('recording projection rejects partial facts and excludes private fields and runtime identities', () => {
  const { session, events } = crossTabWorkflow();
  events[0].value = 'PRIVATE-VALUE';
  events[0].documentId = 'PRIVATE-DOCUMENT';
  const evidence = prepareRecordingEvidence(session, events);
  assert.equal(JSON.stringify(evidence).includes('PRIVATE-'), false);
  assert.throws(() => prepareRecordingEvidence({ ...session, status: 'recording' }, events), /ACTIVE/);
  assert.throws(() => prepareRecordingEvidence(session, []), /EMPTY/);
  assert.throws(() => prepareRecordingEvidence(session, events.slice(1)), /INCOMPLETE/);
  assert.throws(() => prepareRecordingEvidence(session, [...events].reverse()), /INCOMPLETE/);
  events[0].causationId = events.at(-1).id;
  assert.throws(() => prepareRecordingEvidence(session, events), /INCOMPLETE/);
});

test('settings accept HTTP and HTTPS without credentials, query secrets or other protocols', () => {
  const { modelSettingsSchema, modelSettingsRequestSchema } = module.exports;
  for (const baseUrl of [
    'http://localhost:8080/v1',
    'http://192.168.1.20:8080/v1',
    'http://api.example.com/v1',
    'http://[2001:db8::1]:8080/v1',
    'https://api.example.com/v1',
  ]) {
    const settings = { provider: 'openai-compatible', baseUrl, model: 'test-model' };
    assert.equal(
      modelSettingsRequestSchema.safeParse({
        type: 'settings-save',
        settings,
        consent: false,
        limits: { organize: 50, replay: 100 },
      }).success,
      true
    );
  }
  for (const url of [
    '',
    'http://',
    'not-a-url',
    'ftp://api.example.com',
    'https://user:pass@api.example.com',
    'http://api.example.com?key=secret',
    'http://api.example.com#fragment',
  ]) {
    assert.equal(modelSettingsSchema.shape.baseUrl.safeParse(url).success, false);
  }
});

test('page readiness defaults and configurable bounds are validated at settings admission', () => {
  const request = {
    type: 'settings-save',
    settings: { provider: 'openai-compatible', baseUrl: 'https://example.test/v1', model: 'test' },
    consent: false,
    limits: { organize: 50, replay: 100 },
  };
  const parsed = module.exports.modelSettingsRequestSchema.parse(request);
  assert.equal(parsed.limits.pageWaitSeconds, 15);
  assert.equal(parsed.limits.pageWaitAttempts, 3);
  for (const limits of [
    { pageWaitSeconds: 0 },
    { pageWaitSeconds: 61 },
    { pageWaitAttempts: 0 },
    { pageWaitAttempts: 6 },
    { pageWaitAttempts: 1.5 },
  ]) {
    assert.equal(
      module.exports.modelSettingsRequestSchema.safeParse({
        ...request,
        limits: { ...request.limits, ...limits },
      }).success,
      false
    );
  }
});
