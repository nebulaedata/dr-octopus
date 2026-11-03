/**
 * @author Codex
 * @description Traces trusted recording, durable question/skill recovery and real Router/Controller effects with a controlled correct candidate; browser APIs are isolated peers, not an installed-extension acceptance.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
/* global Chain */
const root = fileURLToPath(new URL('../../', import.meta.url));
const liveKeyFile = process.env.CHOICE_CHAIN_LIVE_KEY;
const liveCase = process.env.CHOICE_CHAIN_LIVE_CASE ?? 'available';
assert.ok(
  [
    'available',
    'unavailable',
    'unavailable-preflight',
    'unavailable-recovery',
    'unavailable-choice',
  ].includes(liveCase)
);
const liveDirectory = join(root, 'build/validation-evidence/apply-choice-poc-20261103');
const liveReportFile = join(liveDirectory, 'paid-20.json');
let liveModel;
let liveReport;
if (liveKeyFile) {
  const { key } = JSON.parse(await readFile(liveKeyFile, 'utf8'));
  assert.ok(typeof key === 'string' && key.length > 10);
  await mkdir(liveDirectory, { recursive: true });
  liveReport = await readFile(liveReportFile, 'utf8')
    .then(JSON.parse)
    .catch((error) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      return { limit: 20, model: 'qwen3.6-flash-open', requests: [] };
    });
  assert.equal(liveReport.limit, 20);
  const endpoint = 'https://api.mrtoken.cn/v1';
  const discovery = await fetch(endpoint + '/models', {
    headers: { Authorization: 'Bearer ' + key },
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(discovery.status, 200);
  assert.ok((await discovery.json()).data.some((item) => item.id === liveReport.model));
  liveModel = createOpenAICompatible({
    name: 'choice-chain',
    baseURL: endpoint,
    apiKey: key,
    supportsStructuredOutputs: false,
    fetch: async (input, init) => {
      assert.equal(String(input), endpoint + '/chat/completions');
      assert.ok(liveReport.requests.length < liveReport.limit, 'LIVE_REQUEST_CAP');
      const item = {
        number: liveReport.requests.length + 1,
        state: 'reserved',
        scenario: 'integrated-' + liveCase,
      };
      liveReport.requests.push(item);
      await writeFile(liveReportFile, JSON.stringify(liveReport, null, 2));
      console.log('Synthetic live request ' + item.number);
      try {
        const response = await fetch(input, {
          ...init,
          redirect: 'error',
          signal: AbortSignal.timeout(45000),
        });
        const body = await response.clone().json();
        item.state = 'received';
        item.status = response.status;
        item.usage = body.usage;
        item.tools = body.choices?.[0]?.message?.tool_calls?.map((call) => call.function.name) ?? [];
        return response;
      } catch {
        item.state = 'uncertain';
        throw Error('LIVE_TRANSPORT_FAILED');
      } finally {
        await writeFile(liveReportFile, JSON.stringify(liveReport, null, 2));
      }
    },
  }).chatModel(liveReport.model);
}
const bundle = await build({
  stdin: {
    resolveDir: root,
    contents: `export {DOMRecorder} from './src/lib/recording/dom-recorder';
      export {RecordingRepository} from './src/lib/recording/recording-repository';
      export {SkillSessionRepository} from './src/lib/builtin-agent/skill-session-repository';
      export {BuiltinAgentService} from './src/lib/builtin-agent/builtin-service';
      export {createBuiltinAgent} from './src/lib/builtin-agent/builtin-agent';
      export {BrowserRouter} from './src/browser-router';
      export {PageControllerAdapter} from './src/page-controller-adapter';
      export {preflightFixtureCalls} from './test/fixtures/tool-target-probe.mjs';`,
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  globalName: 'Chain',
  plugins: [
    {
      name: 'isolated-api-peer',
      setup(builder) {
        builder.onResolve({ filter: /^wxt\/browser$/ }, () => ({ path: 'api', namespace: 'peer' }));
        builder.onLoad({ filter: /.*/, namespace: 'peer' }, () => ({
          contents: 'export const browser = new Proxy({}, {get(_t,k){return globalThis.peer[k]}});',
        }));
      },
    },
  ],
});
const html = `<!doctype html><meta charset="utf-8"><title>Choice chain fixture</title>
<style>body{padding:30px}label{display:block;margin:15px}</style>
<fieldset><legend>配送方式</legend><label><input id="standard" type="radio" name="delivery" checked>普通配送</label>
<label><input id="express" type="radio" name="delivery">优先配送 服务时间：09:00至18:00</label></fieldset>
<button id="submit">创建发货单</button><p id="result"></p>
<script>window.commits=[];document.querySelector('#submit').onclick=()=>{window.commits.push({express:document.querySelector('#express').checked});document.querySelector('#result').textContent='已创建发货单'};</script>`;

/**
 * Installs transport peers only; service, repositories, router, adapter, SDK and DOM operations are production code.
 */
async function setup(page) {
  await page.evaluate(() => {
    window.peer = { tabs: { onActivated: { addListener() {} }, onUpdated: { addListener() {} } } };
  });
  const errors = [];
  const collect = (error) => errors.push(error.message);
  page.on('pageerror', collect);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  page.off('pageerror', collect);
  assert.deepEqual(errors, [], 'Probe bundle must initialize');
  await page.evaluate(async () => {
    const listeners = [];
    const tab = {
      id: 1,
      windowId: 1,
      url: location.href,
      title: document.title,
      active: true,
      incognito: false,
      discarded: false,
      frozen: false,
    };
    const settings = {
      provider: 'openai-compatible',
      baseUrl: 'https://synthetic-model.test/v1',
      model: 'controlled',
    };
    const panelUrl = 'chrome-extension://fixture/window-panel.html?instance=panel';
    const values = { workflowSettings: settings, skillExecutionLimits: { organize: 60, replay: 60 } };
    window.peer = {
      runtime: {
        id: 'fixture',
        getURL: (path) => 'chrome-extension://fixture' + path,
        onMessage: { addListener: (listener) => listeners.push(listener) },
        sendMessage: async (message) => {
          for (const listener of listeners) {
            const result = listener(message, {
              id: 'fixture',
              frameId: 0,
              documentId: 'page-document',
              tab,
              url: location.href,
            });
            if (result) {
              return result;
            }
          }
        },
        getContexts: async () => [
          { documentId: 'panel-document', documentUrl: panelUrl, windowId: 1, contextType: 'SIDE_PANEL' },
        ],
      },
      storage: {
        session: { get: async () => ({}), set: async () => {} },
        local: { get: async () => values, set: async (update) => Object.assign(values, update) },
      },
      permissions: { contains: async () => true },
      windows: {
        get: async () => ({ id: 1, type: 'normal', state: 'normal', incognito: false }),
        update: async () => ({}),
      },
      alarms: { create: async () => {} },
      tabs: {
        onRemoved: { addListener() {} },
        onReplaced: { addListener() {} },
        onUpdated: { addListener() {} },
        onActivated: { addListener() {} },
        get: async () => tab,
        query: async () => [tab],
        update: async () => tab,
        sendMessage: async (_id, message) => {
          const owner = { localRunId: message.localRunId };
          if (message.type === 'page.ping') {
            window.adapter.bind(owner, message.documentRevision, message.taskId);
            return window.adapter.identity();
          }
          if (message.type === 'page.release') {
            window.adapter.endTask(message.taskId, owner);
            return { released: true };
          }
          if (message.type === 'page.release-if-idle') {
            return window.adapter.releaseIfIdle(message.taskId, owner);
          }
          try {
            return { result: await window.adapter.execute(message) };
          } catch (error) {
            return { error: { code: error.message, message: error.message } };
          }
        },
      },
    };
    window.adapter = new Chain.PageControllerAdapter();
    window.router = new Chain.BrowserRouter();
    window.service = new Chain.BuiltinAgentService(
      window.router,
      { connected: () => false },
      { canSend: async () => true, resolve: async () => 'synthetic-only' }
    );
    const sender = { id: 'fixture', url: panelUrl, documentId: 'panel-document', frameId: 0 };
    await new Promise((resolve, reject) =>
      window.service.connect({
        name: 'octopus-window-panel:1',
        sender,
        onMessage: { addListener() {} },
        onDisconnect: { addListener() {} },
        postMessage: (message) => {
          if (message.type === 'panel.ready') {
            resolve();
          }
        },
        disconnect: () => reject(Error('panel registration failed')),
      })
    );
    window.command = async (input) => {
      const reply = await window.service.receive(input, sender);
      if (!reply?.ok) {
        throw Error(reply?.error ?? 'NO_REPLY');
      }
      return reply.value;
    };
    window.turn = async (id, name, input) => {
      let session = await window.command({ type: 'skill.get', id });
      const rpc = (type, fields = {}) => window.command({ type, id, epoch: session.epoch, ...fields });
      if (!session.hostDelivered) {
        await rpc('skill.host.ready');
      }
      const callId = crypto.randomUUID();
      const model = {
        specificationVersion: 'v4',
        provider: 'controlled',
        modelId: 'fixture',
        supportedUrls: {},
        doGenerate: async () => ({
          content: [{ type: 'tool-call', toolCallId: callId, toolName: name, input: JSON.stringify(input) }],
          finishReason: { unified: 'tool-calls' },
          warnings: [],
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        }),
      };
      await Chain.createBuiltinAgent(model, session.mode, undefined, {
        prepare: () => rpc('skill.host.prepare'),
        record: async (messages, calls, finishReason) => {
          if (window.usePreflight) {
            const current = await window.command({ type: 'skill.get', id });
            calls = Chain.preflightFixtureCalls(current, calls);
          }
          return rpc('skill.host.step', { messages, calls, finishReason });
        },
        execute: async (toolCallId) => (await rpc('skill.host.tool', { toolCallId })).output,
        checkpoint: (messages) => rpc('skill.host.checkpoint', { messages }),
        stopped: () => true,
      }).generate({ prompt: 'controlled contract validation' });
      session = await window.command({ type: 'skill.get', id });
      if (session.status !== 'running') {
        await rpc('skill.host.end');
      }
      return {
        session: await window.command({ type: 'skill.get', id }),
        result: session.ledger[callId]?.result,
      };
    };
    window.start = (recordingId, mode) =>
      window.command({
        type: 'skill.start',
        recordingId,
        mode,
        consent: { baseUrl: settings.baseUrl, model: settings.model },
      });
  });
}

for (const flavor of ['chrome', 'edge']) {
  test(
    `${flavor}: actual persistence and page effects retain a controlled choice across recovery`,
    { timeout: liveKeyFile ? 600000 : 90000 },
    async () => {
      const browser = await chromium.launch({
        executablePath:
          flavor === 'chrome'
            ? join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe')
            : join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
        headless: true,
      });
      try {
        const page = await browser.newPage();
        if (liveModel) {
          await page.exposeFunction('invokeChoiceModel', async (options) => {
            const result = await liveModel.doGenerate({
              ...options,
              abortSignal: AbortSignal.timeout(50000),
            });
            return {
              content: result.content,
              finishReason: result.finishReason,
              usage: result.usage,
              warnings: result.warnings,
            };
          });
        }
        await page.route('https://synthetic.test/**', (route) =>
          route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
        );
        await page.goto('https://synthetic.test/');
        await setup(page);
        await page.evaluate(() => {
          window.facts = [];
          window.recorder = new Chain.DOMRecorder(
            document.createElement('div'),
            (fact) => window.facts.push(fact),
            () => {}
          );
          window.recorder.start();
        });
        await page.locator('#express').check();
        await page.locator('#submit').click();
        const recordingId = await page.evaluate(async () => {
          window.recorder.stop();
          const id = crypto.randomUUID();
          const now = Date.now();
          const events = window.facts.map((fact, index) => ({
            ...fact,
            sessionId: id,
            seq: index + 1,
            tabRef: 'tab-1',
            documentId: 'page-document',
            source: 'dom',
          }));
          await new Chain.RecordingRepository().save(
            {
              id,
              name: '合成配送验证',
              status: 'stopped',
              startedAt: now,
              updatedAt: now,
              elapsedMs: 1,
              resumedAt: null,
              windowId: 1,
              origins: [location.origin],
              includeRelated: false,
              pages: [
                {
                  tabId: 1,
                  tabRef: 'tab-1',
                  origin: location.origin,
                  title: document.title,
                  lastBatch: 1,
                  included: true,
                },
              ],
              epoch: 1,
              count: events.length,
              actionCount: events.length,
              recentEvents: [],
              bytes: JSON.stringify(events).length,
              gaps: [],
            },
            events
          );
          return id;
        });
        const organize = await page.evaluate((id) => window.start(id, 'organize'), recordingId);
        const read = await page.evaluate(
          (id) => window.turn(id, 'read_recording', { offset: 0, limit: 50 }),
          organize.id
        );
        const actions = read.result.output.value.actions;
        assert.ok(
          actions.some(
            (action) => action.action === 'choice' && action.label.includes('优先配送') && !action.parameterId
          ),
          'Choice changes must not be text parameters'
        );
        const requirements = read.result.output.value.choices;
        assert.equal(requirements.length, 1);
        assert.equal(requirements[0].control.state, true);
        await page.evaluate(
          (id) =>
            window.turn(id, 'ask_user_question', {
              question: '是否需要输入服务时间？',
              fields: [
                {
                  id: 'time',
                  type: 'single',
                  label: '服务时间',
                  required: true,
                  options: [
                    { id: 'skip', label: '不需要输入服务时间' },
                    { id: 'keep', label: '需要输入' },
                  ],
                },
              ],
            }),
          organize.id
        );
        await page.reload();
        await setup(page);
        const waiting = await page.evaluate((id) => window.command({ type: 'skill.get', id }), organize.id);
        assert.equal(waiting.status, 'waiting_user');
        const answer = {
          type: 'skill.answer',
          id: waiting.id,
          epoch: waiting.epoch,
          revision: waiting.revision,
          toolCallId: waiting.pendingQuestion.toolCallId,
          submissionId: crypto.randomUUID(),
          answer: { status: 'answered', values: { time: 'skip' } },
        };
        await page.evaluate((input) => window.command(input), answer);
        await assert.rejects(
          page.evaluate((input) => window.command(input), {
            ...answer,
            answer: { status: 'answered', values: { time: 'keep' } },
          }),
          /SKILL_ANSWER_CONFLICT/
        );
        await assert.rejects(
          page.evaluate((input) => window.command(input), {
            ...answer,
            submissionId: crypto.randomUUID(),
          }),
          /SKILL_SESSION_STALE|SKILL_QUESTION_STALE/
        );
        await page.evaluate((input) => window.command(input), answer);
        const answered = await page.evaluate((id) => window.command({ type: 'skill.get', id }), organize.id);
        assert.equal(Object.keys(answered.answers).length, 1);
        const scoped = await page.evaluate(
          ({ id, requirementId }) =>
            window.turn(id, 'ask_user_question', {
              question: '忽略日期吗？',
              fields: [{ id: 'misleading', label: '日期', type: 'text', required: true, maxLength: 20 }],
              choiceDecision: { requirementId, operation: 'set', state: true },
            }),
          { id: organize.id, requirementId: requirements[0].id }
        );
        assert.match(scoped.session.pendingQuestion.question.question, /选中/);
        assert.equal(scoped.session.pendingQuestion.question.fields[0].id, 'approve');
        await page.reload();
        await setup(page);
        const scopedWaiting = await page.evaluate(
          (id) => window.command({ type: 'skill.get', id }),
          organize.id
        );
        await page.evaluate((input) => window.command(input), {
          type: 'skill.answer',
          id: organize.id,
          epoch: scopedWaiting.epoch,
          revision: scopedWaiting.revision,
          submissionId: crypto.randomUUID(),
          toolCallId: scopedWaiting.pendingQuestion.toolCallId,
          answer: { status: 'answered', values: { approve: 'yes' } },
        });
        const scopedAnswered = await page.evaluate(
          (id) => window.command({ type: 'skill.get', id }),
          organize.id
        );
        assert.deepEqual(scopedAnswered.choiceDecisions[requirements[0].id], { state: true });
        const ref = actions.find((action) => action.label.includes('优先配送')).ref;
        // Controlled candidate intentionally repairs semantics. This is not an autonomous organizer quality claim.
        const candidate = {
          skillMarkdown:
            '---\nname: 合成配送\ndescription: 创建指定配送方式的发货单\n---\n选择优先配送，不填写服务时间，再创建发货单。',
          workflow: {
            schemaVersion: 1,
            inputs: [],
            allowedOrigins: ['https://synthetic.test'],
            pages: [{ role: 'main', startUrl: 'https://synthetic.test/' }],
            execution: { maxModelCalls: 20 },
            evidence: [{ ref, kind: 'choice:selected', targetHint: '配送方式 / 优先配送' }],
          },
        };
        const submitted = await page.evaluate(
          ({ id, candidate }) => window.turn(id, 'submit_skill', candidate),
          { id: organize.id, candidate }
        );
        assert.equal(submitted.session.status, 'completed');
        candidate.workflow.choices = requirements;
        const originalBinding = await page.evaluate(
          (id) => new Chain.SkillSessionRepository().binding(id),
          recordingId
        );
        const retry = await page.evaluate((id) => window.start(id, 'organize'), recordingId);
        const invalid = await page.evaluate(
          ({ id, candidate }) =>
            window.turn(id, 'submit_skill', {
              ...candidate,
              workflow: {
                ...candidate.workflow,
                choices: undefined,
                allowedOrigins: ['https://outside.test'],
                pages: [{ role: 'main', startUrl: 'https://outside.test/' }],
              },
            }),
          { id: retry.id, candidate }
        );
        assert.equal(invalid.session.status, 'running');
        assert.equal(invalid.result.output.value.valid, false);
        assert.deepEqual(
          await page.evaluate((id) => new Chain.SkillSessionRepository().binding(id), recordingId),
          originalBinding
        );
        await page.evaluate(
          (session) => window.command({ type: 'skill.cancel', id: session.id, epoch: session.epoch }),
          invalid.session
        );
        await page.reload();
        await setup(page);
        const replay = await page.evaluate((id) => window.start(id, 'replay'), recordingId);
        const skill = await page.evaluate((id) => window.turn(id, 'read_skill', {}), replay.id);
        assert.deepEqual(skill.result.output.value.candidate, candidate);
        const snap = await page.evaluate(
          (id) => window.turn(id, 'browser_snapshot', { tabId: 1, screenshot: false }),
          replay.id
        );
        const snapshot = snap.result.output.value;
        assert.equal(
          /\[\d+\]<input[^\n]*id=express/.test(snapshot.text),
          false,
          'Raw choice indexes are not offered'
        );
        const initialSubmit = /\[(\d+)\]<button[^\n]*id=submit/.exec(snapshot.text);
        assert.ok(initialSubmit);
        const target = {
          documentId: snapshot.documentId,
          controllerId: snapshot.controllerId,
          snapshotId: snapshot.snapshotId,
          elementIndex: Number(initialSubmit[1]),
        };
        const bypass = await page.evaluate(
          ({ id, target }) => window.turn(id, 'browser_click', { tabId: 1, target }),
          { id: replay.id, target }
        );
        assert.equal(bypass.result.output.value.status, 'choice_required');
        assert.deepEqual(await page.evaluate(() => window.commits), []);
        await page.evaluate(
          (id) => window.turn(id, 'browser_snapshot', { tabId: 1, screenshot: false }),
          replay.id
        );
        const clicked = await page.evaluate(
          ({ id, requirementId }) => window.turn(id, 'apply_choice', { tabId: 1, requirementId }),
          {
            id: replay.id,
            requirementId: requirements[0].id,
          }
        );
        assert.equal(clicked.result.output.value.businessEffect, 'applied');
        const premature = await page.evaluate(
          ({ id, target }) => window.turn(id, 'browser_click', { tabId: 1, target }),
          { id: replay.id, target }
        );
        assert.equal(premature.result.output.type, 'error-text');
        assert.equal(premature.result.output.value, 'SKILL_OBSERVATION_REQUIRED');
        assert.deepEqual(await page.evaluate(() => window.commits), []);
        const after = await page.evaluate(
          (id) => window.turn(id, 'browser_snapshot', { tabId: 1, screenshot: false }),
          replay.id
        );
        const latest = after.result.output.value;
        assert.equal(await page.locator('#express').isChecked(), true);
        const submitIndex = /\[(\d+)\]<button[^\n]*id=submit/.exec(latest.text);
        assert.ok(submitIndex);
        await page.evaluate(({ id, target }) => window.turn(id, 'browser_click', { tabId: 1, target }), {
          id: replay.id,
          target: { ...target, snapshotId: latest.snapshotId, elementIndex: Number(submitIndex[1]) },
        });
        await page.evaluate(
          (id) => window.turn(id, 'browser_snapshot', { tabId: 1, screenshot: false }),
          replay.id
        );
        const finished = await page.evaluate(
          (id) => window.turn(id, 'finish_run', { outcome: 'completed', summary: '已创建优先配送发货单。' }),
          replay.id
        );
        assert.equal(finished.session.status, 'completed');
        const commits = await page.evaluate(() => window.commits);
        assert.deepEqual(commits, [{ express: true }]);
        const directory = join(root, 'build/validation-evidence/choice-chain-implementation');
        await mkdir(directory, { recursive: true });
        await writeFile(
          join(directory, `${flavor}.json`),
          JSON.stringify(
            {
              flavor,
              recordingId,
              providerCalls: 0,
              actualProductionModules: [
                'DOMRecorder',
                'RecordingRepository',
                'BuiltinAgentService',
                'SkillSessionRepository',
                'ToolLoopAgent',
                'BrowserRouter',
                'PageControllerAdapter',
                'PageController',
              ],
              peers: ['browser extension API transport', 'model responses'],
              sourceDefectStillPresent: false,
              candidateOrigin: 'controlled prose; source-owned choices added by production validation',
              actions,
              candidate,
              durableAnswerCount: Object.keys(scopedAnswered.answers).length,
              scopedChoiceDecisionSurvivedReload: true,
              conflictingAnswerRejected: true,
              staleAnswerRejected: true,
              failedReorganizationPreservedBinding: true,
              secondActionWithoutObservationRejected: true,
              commits,
              finalStatus: finished.session.status,
              verdict: 'production-recording-choice-save-replay-chain-passed',
            },
            null,
            2
          )
        );
        if (liveModel && flavor === 'chrome') {
          // A second immutable artifact isolates JSON use: its Markdown deliberately contains no delivery option.
          const jsonOnly = structuredClone(candidate);
          jsonOnly.skillMarkdown =
            '---\nname: 创建发货单\ndescription: 按技能要求创建发货单\n---\n创建一份发货单。具体选择要求见 workflow.evidence。不要猜测或省略要求。';
          const newOrganization = await page.evaluate((id) => window.start(id, 'organize'), recordingId);
          await page.evaluate(({ id, candidate }) => window.turn(id, 'submit_skill', candidate), {
            id: newOrganization.id,
            candidate: jsonOnly,
          });
          await page.reload();
          await setup(page);
          if (liveCase.startsWith('unavailable')) {
            await page.evaluate(() => document.querySelector('#express').closest('label').remove());
          }
          const realReplay = await page.evaluate((id) => window.start(id, 'replay'), recordingId);
          const liveResult = await page.evaluate(
            async ({ id, preflight, seedFailure, seedChoice }) => {
              let session = await window.command({ type: 'skill.get', id });
              const epoch = session.epoch;
              const rpc = (type, fields = {}) => window.command({ type, id, epoch, ...fields });
              await rpc('skill.host.ready');
              let stopped = false;
              let seeded = 0;
              const model = {
                specificationVersion: 'v4',
                provider: 'choice-chain',
                modelId: 'qwen3.6-flash-open',
                supportedUrls: {},
                doGenerate: async (options) => {
                  if (seedFailure && seeded < 4) {
                    const names = [
                      'read_skill',
                      'browser_tabs',
                      'browser_snapshot',
                      seedChoice ? 'apply_choice' : 'browser_select',
                    ];
                    const toolName = names[seeded++];
                    let input = {};
                    if (toolName === 'browser_snapshot') {
                      input = { tabId: 1, screenshot: false };
                    }
                    if (toolName === 'apply_choice') {
                      const current = await window.command({ type: 'skill.get', id });
                      input = {
                        tabId: 1,
                        requirementId: current.context.skill.candidate.workflow.choices[0].id,
                      };
                    }
                    if (toolName === 'browser_select') {
                      const current = await window.command({ type: 'skill.get', id });
                      const snapshot = current.ledger[current.lastObservationCallId].result.output.value;
                      const index = /\[(\d+)\]<label[^\n]*普通配送/.exec(snapshot.text);
                      if (!index) {
                        throw Error('Controlled failure target missing');
                      }
                      input = {
                        tabId: 1,
                        target: {
                          documentId: snapshot.documentId,
                          controllerId: snapshot.controllerId,
                          snapshotId: snapshot.snapshotId,
                          elementIndex: Number(index[1]),
                        },
                        optionText: '优先配送',
                      };
                    }
                    return {
                      content: [
                        {
                          type: 'tool-call',
                          toolName,
                          toolCallId: crypto.randomUUID(),
                          input: JSON.stringify(input),
                        },
                      ],
                      finishReason: { unified: 'tool-calls' },
                      warnings: [],
                      usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } },
                    };
                  }
                  const safeOptions = { ...options };
                  delete safeOptions.abortSignal;
                  return window.invokeChoiceModel(safeOptions);
                },
              };
              let failed;
              try {
                await Chain.createBuiltinAgent(model, 'replay', undefined, {
                  prepare: () => rpc('skill.host.prepare'),
                  record: async (messages, calls, finishReason) => {
                    if (preflight) {
                      const current = await window.command({ type: 'skill.get', id });
                      calls = Chain.preflightFixtureCalls(current, calls);
                    }
                    const reply = await rpc('skill.host.step', { messages, calls, finishReason });
                    stopped = reply.status !== 'running';
                  },
                  execute: async (toolCallId) => {
                    const reply = await rpc('skill.host.tool', { toolCallId });
                    stopped = reply.status !== 'running';
                    return reply.output;
                  },
                  checkpoint: (messages) => rpc('skill.host.checkpoint', { messages }),
                  stopped: () => stopped,
                }).generate({ prompt: '运行已选择的技能。' });
                await rpc('skill.host.end');
              } catch {
                failed = 'LIVE_RUN_FAILED';
              }
              session = await window.command({ type: 'skill.get', id });
              return { session, commits: window.commits, failed };
            },
            {
              id: realReplay.id,
              preflight: ['unavailable-preflight', 'unavailable-recovery'].includes(liveCase),
              seedFailure: ['unavailable-recovery', 'unavailable-choice'].includes(liveCase),
              seedChoice: liveCase === 'unavailable-choice',
            }
          );
          await writeFile(
            join(liveDirectory, `integrated-chrome-replay-${liveCase}.json`),
            JSON.stringify({ candidate: jsonOnly, ...liveResult }, null, 2)
          );
          assert.equal(liveResult.failed, undefined);
          if (liveCase.startsWith('unavailable')) {
            assert.equal(liveResult.session.status, 'waiting_user');
            assert.deepEqual(liveResult.commits, []);
          } else {
            assert.equal(liveResult.session.status, 'completed');
            assert.deepEqual(liveResult.commits, [{ express: true }]);
          }
        }
        if (!liveModel) {
          await page.reload();
          await setup(page);
          await page.evaluate(() => document.querySelector('#express').closest('label').remove());
          const missing = await page.evaluate((id) => window.start(id, 'replay'), recordingId);
          await page.evaluate((id) => window.turn(id, 'read_skill', {}), missing.id);
          await page.evaluate(
            (id) => window.turn(id, 'browser_snapshot', { tabId: 1, screenshot: false }),
            missing.id
          );
          const refused = await page.evaluate(
            ({ id, requirementId }) => window.turn(id, 'apply_choice', { tabId: 1, requirementId }),
            { id: missing.id, requirementId: requirements[0].id }
          );
          assert.equal(refused.session.status, 'running');
          assert.equal(refused.result.output.value.status, 'unavailable');
          assert.deepEqual(await page.evaluate(() => window.commits), []);
          const pending = await page.evaluate(
            ({ id, requirementId }) =>
              window.turn(id, 'ask_user_question', {
                question: '当前没有要求的配送方式，是否停止？',
                choiceDecision: { requirementId, operation: 'omit' },
                fields: [
                  {
                    id: 'action',
                    label: '处理方式',
                    type: 'single',
                    required: true,
                    options: [
                      { id: 'stop', label: '停止' },
                      { id: 'later', label: '稍后处理' },
                    ],
                  },
                ],
              }),
            { id: missing.id, requirementId: requirements[0].id }
          );
          assert.equal(pending.session.status, 'waiting_user');
          await page.reload();
          await setup(page);
          const restored = await page.evaluate((id) => window.command({ type: 'skill.get', id }), missing.id);
          assert.equal(restored.pendingQuestion.toolCallId, pending.session.pendingQuestion.toolCallId);
          assert.match(restored.pendingQuestion.question.reason, /不修改技能文件/);
          let decisionSession = restored;
          for (const approve of ['no', 'yes']) {
            await page.evaluate((input) => window.command(input), {
              type: 'skill.answer',
              id: missing.id,
              epoch: decisionSession.epoch,
              revision: decisionSession.revision,
              toolCallId: decisionSession.pendingQuestion.toolCallId,
              submissionId: crypto.randomUUID(),
              answer: { status: 'answered', values: { approve } },
            });
            const observation = await page.evaluate(
              (id) => window.turn(id, 'browser_snapshot', { tabId: 1, screenshot: false }),
              missing.id
            );
            const value = observation.result.output.value;
            const button = /\[(\d+)\]<button[^\n]*id=submit/.exec(value.text);
            assert.ok(button);
            const mutation = await page.evaluate(
              ({ id, target }) => window.turn(id, 'browser_click', { tabId: 1, target }),
              {
                id: missing.id,
                target: {
                  documentId: value.documentId,
                  controllerId: value.controllerId,
                  snapshotId: value.snapshotId,
                  elementIndex: Number(button[1]),
                },
              }
            );
            if (approve === 'no') {
              assert.equal(mutation.result.output.value.status, 'choice_required');
              assert.deepEqual(await page.evaluate(() => window.commits), []);
              decisionSession = (
                await page.evaluate(({ id, question }) => window.turn(id, 'ask_user_question', question), {
                  id: missing.id,
                  question: restored.pendingQuestion.question,
                })
              ).session;
            } else {
              assert.equal(mutation.result.output.value.businessEffect, 'applied');
              assert.deepEqual(await page.evaluate(() => window.commits), [{ express: false }]);
              const reread = await page.evaluate((id) => window.turn(id, 'read_skill', {}), missing.id);
              assert.deepEqual(reread.result.output.value.executionChoices, []);
              assert.deepEqual(reread.result.output.value.candidate.workflow.choices, requirements);
              assert.deepEqual(
                await page.evaluate((id) => new Chain.SkillSessionRepository().binding(id), recordingId),
                originalBinding
              );
            }
          }
          await writeFile(
            join(directory, `${flavor}-unavailable.json`),
            JSON.stringify(
              {
                refusal: refused.result.output.value,
                beforeApprovalCommits: [],
                afterExplicitApprovalCommits: [{ express: false }],
                savedSkillUnchanged: true,
              },
              null,
              2
            )
          );
        }
      } finally {
        await browser.close();
      }
    }
  );
}
