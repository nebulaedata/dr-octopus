/**
 * @author Codex
 * @description Drives production Skill coordination and the real SDK through synthetic tools with real IndexedDB, without provider requests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
const bundle = await build({
  stdin: {
    contents:
      "export {PageAccessError} from './src/page-access'; export {skillContentHash} from './src/lib/skill-library/skill-snapshot'; export {BuiltinAgentService} from './src/lib/builtin-agent/builtin-service'; export {SkillSessionRepository} from './src/lib/builtin-agent/skill-session-repository'; export {RecordingRepository} from './src/lib/recording/recording-repository'; export {createBuiltinAgent} from './src/lib/builtin-agent/builtin-agent'; export {runBuiltinAgent} from './src/lib/builtin-agent/builtin-host';",
    resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  globalName: 'BuiltinAgentServiceProbe',
  plugins: [
    {
      name: 'owned-browser-api',
      setup(builder) {
        builder.onResolve({ filter: /^wxt\/browser$/ }, () => ({
          path: 'browser',
          namespace: 'owned-browser',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'owned-browser' }, () => ({
          contents:
            'export const browser = new Proxy({}, {get(_target,key){return globalThis.__skillBrowser[key]}});',
          loader: 'js',
        }));
      },
    },
  ],
});
/* global BuiltinAgentServiceProbe */
for (const flavor of ['chrome', 'edge']) {
  test(
    `${flavor}: organizer saves once and replay resumes its own tool session`,
    { timeout: 45000 },
    async () => {
      const server = createServer((request, response) => {
        response.setHeader(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self'; connect-src 'none'"
        );
        if (request.url === '/agent.js') {
          response.setHeader('Content-Type', 'application/javascript');
          response.end(bundle.outputFiles[0].text);
        } else {
          response.end(
            '<!doctype html><title>Skill service fixture</title><script src="/agent.js"></script>'
          );
        }
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      let browser;
      try {
        browser = await chromium.launch({
          executablePath:
            flavor === 'chrome'
              ? join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe')
              : join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
          headless: true,
        });
        const page = await browser.newPage();
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        const result = await page.evaluate(async () => {
          const settings = {
            provider: 'openai-compatible',
            baseUrl: 'https://model.example.com/v1',
            model: 'synthetic-tool-model',
          };
          const values = { workflowSettings: settings, skillExecutionLimits: { organize: 80, replay: 200 } };
          const tabs = new Map();
          let nextTab = 10;
          globalThis.__skillBrowser = {
            runtime: {
              id: 'fixture',
              getURL: (path) => 'chrome-extension://fixture' + path,
              getContexts: async () => [
                {
                  documentId: 'panel-document',
                  documentUrl: 'chrome-extension://fixture/window-panel.html?instance=panel',
                  windowId: 1,
                },
              ],
            },
            storage: {
              session: { get: async () => ({}), set: async () => {} },
              local: { get: async () => values, set: async (update) => Object.assign(values, update) },
            },
            windows: { get: async () => ({ id: 1, type: 'normal', incognito: false }) },
            alarms: { create: async () => {} },
            tabs: {
              create: async ({ url }) => {
                const tab = { id: ++nextTab, url };
                tabs.set(tab.id, tab);
                return tab;
              },
              update: async (id, update) => {
                Object.assign(tabs.get(id), update);
                return tabs.get(id);
              },
              get: async (id) => {
                if (!tabs.has(id)) {
                  throw new Error('gone');
                }
                return tabs.get(id);
              },
              remove: async (id) => {
                tabs.delete(id);
              },
            },
          };
          const recordingId = crypto.randomUUID();
          const repository = new BuiltinAgentServiceProbe.RecordingRepository();
          const now = Date.now();
          const event = {
            id: crypto.randomUUID(),
            sessionId: recordingId,
            seq: 1,
            tabRef: 'tab-1',
            documentId: 'document-1',
            source: 'dom',
            at: now,
            action: 'click',
            label: '查询',
            url: 'https://orders.example.com/search',
            targetRef: 'control-1',
          };
          await repository.save(
            {
              id: recordingId,
              name: '查询订单',
              status: 'stopped',
              startedAt: now,
              updatedAt: now,
              elapsedMs: 1000,
              resumedAt: null,
              windowId: 1,
              origins: ['https://orders.example.com'],
              includeRelated: false,
              pages: [
                {
                  tabId: 1,
                  tabRef: 'tab-1',
                  origin: 'https://orders.example.com',
                  title: '订单查询',
                  lastBatch: 1,
                  included: true,
                },
              ],
              epoch: 1,
              count: 1,
              actionCount: 1,
              recentEvents: [],
              bytes: 200,
              gaps: [],
            },
            [event]
          );
          const candidate = {
            skillMarkdown:
              '---\nname: 订单查询技能\ndescription: 查询所选订单。\n---\nQuery {{orderNo}} and report the visible result.',
            workflow: {
              schemaVersion: 1,
              inputs: [{ name: 'orderNo', label: '订单编号', type: 'text', required: true }],
              allowedOrigins: ['https://orders.example.com'],
              pages: [{ role: 'search', startUrl: 'https://orders.example.com/search' }],
              execution: { maxModelCalls: 20 },
              evidence: [{ ref: 'action-1', kind: 'click', targetHint: '查询' }],
            },
          };
          let stored;
          let failSave = true;
          let dropReceipt = true;
          let nativeError;
          let nativeReads = 0;
          let saves = 0;
          let observations = 0;
          let actions = 0;
          let releaseAction;
          let lastSnapshot;
          let owner;
          const files = {
            connected: () => !failSave,
            request: async (command) => {
              if (command.type === 'skills.receipt') {
                return stored?.receipt.operationId === command.operationId ? stored.receipt : null;
              }
              if (command.type === 'skills.create') {
                if (failSave) {
                  throw new Error('SKILL_OFFLINE');
                }
                saves++;
                stored = {
                  candidate: command.candidate,
                  receipt: {
                    skillId: command.operationId,
                    operationId: command.operationId,
                    definitionHash: BuiltinAgentServiceProbe.skillContentHash(command.candidate),
                  },
                };
                if (dropReceipt) {
                  dropReceipt = false;
                  throw new Error('SKILL_FILE_OUTCOME_UNKNOWN');
                }
                return stored.receipt;
              }
              if (command.type === 'skills.read') {
                nativeReads++;
                if (nativeError) {
                  throw new Error(nativeError);
                }
                return {
                  skillId: stored.receipt.skillId,
                  definitionHash: 'b'.repeat(64),
                  candidate: {
                    ...stored.candidate,
                    skillMarkdown: stored.candidate.skillMarkdown + '\nUser edited: only read data.',
                  },
                };
              }
              return { opened: true };
            },
          };
          let requirePermission = false;
          let pendingOpenReceipt = false;
          let lastWaitObserver;
          let accessReason = 'permission';
          let reproduceUndefinedAccess = false;
          let permissionGranted = false;
          let permissionChecks = 0;
          const router = {
            hasSitePermission: async () => {
              permissionChecks++;
              return permissionGranted;
            },
            claimLocal: async (id) => {
              if (owner && owner !== id) {
                throw new Error('BROWSER_BUSY');
              }
              owner = id;
            },
            releaseLocal: async (id) => {
              if (owner === id) {
                owner = undefined;
              }
            },
            executeLocal: async (command, onWait) => {
              if (command.method === 'browser_open_tab' && pendingOpenReceipt) {
                if (pendingOpenReceipt === 'timeout') {
                  lastWaitObserver = onWait;
                  for (let attempt = 1; attempt <= 3; attempt++) {
                    await onWait?.({ seconds: 15, attempts: 3, attempt, tabId: 42, startedAt: Date.now() });
                    const saved = await new BuiltinAgentServiceProbe.SkillSessionRepository().get(
                      command.localRunId
                    );
                    const open = Object.values(saved.ledger).find(
                      (entry) => entry.toolName === 'browser_open_tab'
                    );
                    if (open.waitProgress?.attempt !== attempt || saved.status !== 'running') {
                      throw Error('Wait progress was not durably attached to the running tool');
                    }
                  }
                }
                return {
                  tabId: 42,
                  url: 'https://orders.example.com/search',
                  title: '',
                  businessEffect: 'applied',
                  code: 'TAB_OPENED',
                  readiness:
                    pendingOpenReceipt === 'timeout'
                      ? {
                          status: 'not_ready',
                          code: 'PAGE_READY_TIMEOUT',
                          wait: { waitSeconds: 15, timeouts: 3 },
                        }
                      : {
                          status: 'not_ready',
                          code: 'FORBIDDEN_PAGE',
                          access: { reason: 'permission', tabId: 42, origin: 'https://orders.example.com' },
                        },
                };
              }
              if (command.localRunId !== owner || 'connectionId' in command) {
                throw new Error('BAD_OWNER');
              }
              if (command.method === 'browser_tabs') {
                return { tabs: [{ tabId: 1, url: 'https://orders.example.com/search', title: '订单查询' }] };
              }
              if (command.method === 'browser_snapshot') {
                if (requirePermission && !permissionGranted) {
                  const error = new BuiltinAgentServiceProbe.PageAccessError(
                    accessReason,
                    1,
                    accessReason === 'permission'
                      ? 'https://orders.example.com/private?secret=value'
                      : undefined
                  );
                  if (reproduceUndefinedAccess) {
                    error.access.origin = undefined;
                  }
                  throw error;
                }
                observations++;
                lastSnapshot = {
                  documentId: 'document-' + observations,
                  controllerId: crypto.randomUUID(),
                  snapshotId: crypto.randomUUID(),
                  page: 0,
                  pages: 1,
                  totalBytes: 20,
                  text: '订单000123状态待处理',
                  title: '订单查询',
                  url: 'https://orders.example.com/search',
                  expiresAt: Date.now() + 60000,
                  digest: 'c'.repeat(64),
                };
                return { result: lastSnapshot };
              }
              actions++;
              await new Promise((resolve) => {
                releaseAction = resolve;
              });
              return { result: { businessEffect: 'applied', code: 'ACTION_COMPLETED' } };
            },
          };
          const service = new BuiltinAgentServiceProbe.BuiltinAgentService(router, files, {
            canSend: async () => true,
            resolve: async () => 'synthetic-key',
          });
          const popup = {
            id: 'fixture',
            url: 'chrome-extension://fixture/window-panel.html?instance=panel',
            documentId: 'panel-document',
          };
          let registered = false;
          service.connect({
            name: 'octopus-window-panel:1',
            onMessage: { addListener: () => {} },
            sender: popup,
            onDisconnect: { addListener: () => {} },
            postMessage: (message) => {
              if (message.type === 'panel.ready') {
                registered = true;
              }
            },
            disconnect: () => {
              throw Error('Panel rejected');
            },
          });
          while (!registered) {
            await new Promise((resolve) => setTimeout(resolve, 1));
          }
          const ask = {
            question: '请输入订单编号',
            fields: [{ id: 'orderNo', label: '编号', type: 'text', required: true, maxLength: 30 }],
          };
          let models = 0;
          /** Runs one inspectable SDK step with production execute callbacks; native multi-step is covered in window-panel. */
          async function turn(
            session,
            toolCalls,
            text = '',
            finishReason = toolCalls.length ? 'tool-calls' : 'stop'
          ) {
            const sender = { id: 'fixture', url: popup.url, frameId: 0, documentId: popup.documentId };
            async function rpc(type, fields = {}) {
              const result = await service.receive(
                { type, id: session.id, epoch: session.epoch, ...fields },
                sender
              );
              if (!result.ok) {
                throw Error(result.error);
              }
              return result.value;
            }
            let ready = session;
            if (!session.hostDelivered) {
              ready = await rpc('skill.host.ready');
            }
            if (
              toolCalls[0]?.[1] === 'validate-1' &&
              !JSON.stringify(ready.messages).includes('SKILL_METADATA_MISSING')
            ) {
              throw Error('Repair turn lost the previous specific diagnostic');
            }
            let recorded;
            const admitted = new Promise((resolve) => {
              recorded = resolve;
            });
            const runtime = {
              prepare: () => rpc('skill.host.prepare'),
              checkpoint: (messages) => rpc('skill.host.checkpoint', { messages }),
              record: async (messages, calls, reason) => {
                await rpc('skill.host.step', { messages, calls, finishReason: reason });
                recorded();
              },
              execute: async (toolCallId) => (await rpc('skill.host.tool', { toolCallId })).output,
              stopped: () => true,
            };
            const model = {
              specificationVersion: 'v4',
              provider: 'synthetic',
              modelId: 'fixture',
              supportedUrls: {},
              doGenerate: async (options) => {
                if (
                  ready.responseRecovery &&
                  session.mode === 'replay' &&
                  options.tools.some((tool) =>
                    [
                      'browser_click',
                      'browser_fill',
                      'browser_open_tab',
                      'browser_navigate',
                      'browser_close_tab',
                    ].includes(tool.name)
                  )
                ) {
                  throw Error('Correction offered mutation tools');
                }
                models++;
                return {
                  content: [
                    ...(text ? [{ type: 'text', text }] : []),
                    ...toolCalls.map(([toolName, toolCallId, input]) => ({
                      type: 'tool-call',
                      toolName,
                      toolCallId,
                      input: JSON.stringify(input),
                    })),
                  ],
                  finishReason: { unified: finishReason },
                  usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
                  warnings: [],
                };
              },
            };
            void BuiltinAgentServiceProbe.createBuiltinAgent(model, session.mode, undefined, runtime)
              .generate({ prompt: 'continue' })
              .then(async () => {
                const current = (await service.receive({ type: 'skill.get', id: session.id }, popup)).value;
                if (current.status !== 'running' || !toolCalls.length) {
                  await rpc('skill.host.end');
                }
              })
              .catch(async (error) => {
                recorded();
                await rpc('skill.host.failed', { error: error.message }).catch(() => {});
              });
            await admitted;
          }
          /** Waits for the owner to finish one asynchronous transition without invoking any model automatically. */
          async function settled(id, predicate) {
            for (let i = 0; i < 300; i++) {
              const result = await service.receive({ type: 'skill.get', id }, popup);
              if (predicate(result.value)) {
                return result.value;
              }
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            throw new Error(
              'transition did not settle:' +
                JSON.stringify((await service.receive({ type: 'skill.get', id }, popup)).value)
            );
          }
          const started = await service.receive(
            { type: 'skill.start', recordingId, mode: 'organize' },
            popup
          );
          if (!started.ok) {
            throw new Error('start:' + started.error);
          }
          let session = started.value;
          if (session.modelCallLimit !== 80) {
            throw new Error('Configured organizer budget was not captured');
          }
          values.skillExecutionLimits.organize = 90;
          await turn(session, [['read_recording', 'read-1', { offset: 0, limit: 20 }]]);
          session = await settled(
            session.id,
            (value) =>
              value.hostWindowId &&
              value.responses?.length > (session.responses?.length ?? 0) &&
              !Object.values(value.ledger).some((e) => e.state === 'pending' || e.state === 'dispatched')
          );
          if (session.modelCallLimit !== 80) {
            throw new Error('Settings changed an existing task budget');
          }
          await turn(session, [
            ['ask_user_question', 'invalid-ask', { ...ask, fields: [{ ...ask.fields[0], required: 'yes' }] }],
          ]);
          session = await settled(
            session.id,
            (value) => value.ledger['invalid-ask']?.state === 'completed' && !value.sdkStep
          );
          if (
            !session.ledger['invalid-ask'].inputIssues?.some(
              (issue) => issue.code === 'INVALID_TYPE' && issue.path.join('.') === 'fields.0.required'
            )
          ) {
            throw Error('Specific safe SDK input diagnostics were not persisted');
          }
          await turn(session, [['ask_user_question', 'ask-1', ask]]);
          session = await settled(
            session.id,
            (value) => value.status === 'waiting_user' && !value.hostWindowId
          );
          if (session.pendingQuestion.question.allowDefer !== false) {
            throw Error('Omitted question policy did not receive its safe default');
          }
          const answer = {
            type: 'skill.answer',
            id: session.id,
            epoch: session.epoch,
            revision: session.revision,
            submissionId: crypto.randomUUID(),
            toolCallId: 'ask-1',
            answer: { status: 'answered', values: { orderNo: '000123' } },
          };
          session = (await service.receive(answer, popup)).value;
          const duplicate = await service.receive(answer, popup);
          if (!duplicate.ok || duplicate.value.hostWindowId !== session.hostWindowId) {
            throw new Error('duplicate answer spawned another Host');
          }
          await turn(session, [
            ['validate_skill', 'invalid-metadata', { ...candidate, skillMarkdown: '查询 {{orderNo}}' }],
          ]);
          session = await settled(
            session.id,
            (value) =>
              value.hostWindowId &&
              value.responses?.length > (session.responses?.length ?? 0) &&
              !Object.values(value.ledger).some((e) => e.state === 'pending' || e.state === 'dispatched')
          );
          const diagnostic = session.ledger['invalid-metadata'].result.output.value.issues[0];
          if (
            diagnostic.code !== 'SKILL_METADATA_MISSING' ||
            !diagnostic.message.includes('不要删除元信息')
          ) {
            throw new Error('Agent did not receive actionable metadata feedback');
          }
          await turn(session, [['validate_skill', 'validate-1', candidate]]);
          session = await settled(
            session.id,
            (value) =>
              value.hostWindowId &&
              value.responses?.length > (session.responses?.length ?? 0) &&
              !Object.values(value.ledger).some((e) => e.state === 'pending' || e.state === 'dispatched')
          );
          await turn(session, [], '合成：技能已整理完成。');
          session = await settled(session.id, (value) => value.status === 'failed' && !value.hostWindowId);
          session = (
            await service.receive({ type: 'skill.continue', id: session.id, epoch: session.epoch }, popup)
          ).value;
          if (
            !session.responseRecovery ||
            session.responses.at(-1).classification !== 'text_only' ||
            !JSON.stringify(session.messages).includes('合成：技能已整理完成。')
          ) {
            throw Error('Organizer narration was lost');
          }
          const originalPut = IDBObjectStore.prototype.put;
          IDBObjectStore.prototype.put = function (value, ...rest) {
            if (this.name === 'bindings') {
              throw new DOMException('fixture quota', 'QuotaExceededError');
            }
            return originalPut.call(this, value, ...rest);
          };
          await turn(session, [['submit_skill', 'save-1', candidate]]);
          try {
            session = await settled(
              session.id,
              (value) => value.status === 'saving' && value.error === 'SKILL_STORAGE'
            );
          } finally {
            IDBObjectStore.prototype.put = originalPut;
          }
          const beforeLocalRetry = models;
          await service.receive({ type: 'skill.retry-save', id: session.id, epoch: session.epoch }, popup);
          session = await settled(session.id, (value) => value.status === 'completed');
          if (models !== beforeLocalRetry) {
            throw new Error('Browser storage retry requested another model turn');
          }

          const initial = (await service.receive({ type: 'skill.state', recordingId }, popup)).value;
          if (initial.binding.storage !== 'browser' || saves !== 0 || nativeReads !== 0) {
            throw new Error('Organization depends on Native');
          }
          const localReplay = (
            await service.receive(
              {
                type: 'skill.start',
                recordingId,
                mode: 'replay',
                consent: { baseUrl: settings.baseUrl, model: settings.model },
              },
              popup
            )
          ).value;
          const duplicateReplay = await service.receive(
            {
              type: 'skill.start',
              recordingId,
              mode: 'replay',
              consent: { baseUrl: settings.baseUrl, model: settings.model },
            },
            popup
          );
          if (
            !duplicateReplay.ok ||
            duplicateReplay.value.id !== localReplay.id ||
            duplicateReplay.value.epoch !== localReplay.epoch
          ) {
            throw Error('Duplicate replay created another execution');
          }
          if (localReplay.skillSource.storage !== 'browser' || nativeReads !== 0) {
            throw new Error('Browser skill tried to read Native');
          }
          await service.receive(
            { type: 'skill.cancel', id: localReplay.id, epoch: localReplay.epoch },
            popup
          );
          const beforeRetry = models;
          const publish = { type: 'skill.save-to-executor', recordingId, skillId: initial.binding.skillId };
          const offlineSave = await service.receive(publish, popup);
          if (offlineSave.ok || offlineSave.error !== 'SKILL_OFFLINE') {
            throw new Error('Expected explicit offline file failure');
          }
          failSave = false;
          const lost = await service.receive(publish, popup);
          if (lost.ok || lost.error !== 'SKILL_FILE_OUTCOME_UNKNOWN') {
            throw new Error('Expected lost receipt');
          }
          const recovered = await service.receive(publish, popup);
          if (
            !recovered.ok ||
            recovered.value.storage !== 'executor' ||
            saves !== 1 ||
            models !== beforeRetry
          ) {
            throw new Error('Receipt recovery regenerated or duplicated');
          }
          await service.receive(publish, popup);
          const afterSave = {
            models,
            beforeRetry,
            savedError: session.error,
            saves,
            savedResult: session.messages.some(
              (message) =>
                message.role === 'tool' &&
                message.content.some(
                  (part) =>
                    part.toolName === 'submit_skill' && part.output.type === 'json' && part.output.value.saved
                )
            ),
          };
          const replay = await service.receive(
            {
              type: 'skill.start',
              recordingId,
              mode: 'replay',
              consent: { baseUrl: settings.baseUrl, model: settings.model },
            },
            popup
          );
          if (!replay.ok) {
            throw new Error('replay:' + replay.error);
          }
          if (replay.value.id === localReplay.id) {
            throw Error('New replay reused a terminal conversation');
          }
          session = replay.value;
          const edited = session.context.skill.candidate.skillMarkdown.includes('User edited');
          await turn(session, [['read_skill', 'skill-1', {}]]);
          session = await settled(
            session.id,
            (value) =>
              value.hostWindowId &&
              value.responses?.length > (session.responses?.length ?? 0) &&
              !Object.values(value.ledger).some((e) => e.state === 'pending' || e.state === 'dispatched')
          );
          await turn(session, [['browser_snapshot', 'observe-1', { tabId: 1, screenshot: false }]]);
          session = await settled(
            session.id,
            (value) =>
              value.hostWindowId &&
              value.responses?.length > (session.responses?.length ?? 0) &&
              !Object.values(value.ledger).some((e) => e.state === 'pending' || e.state === 'dispatched')
          );
          await turn(session, [
            [
              'browser_click',
              'blocked-click',
              {
                tabId: 1,
                target: {
                  documentId: lastSnapshot.documentId,
                  controllerId: lastSnapshot.controllerId,
                  snapshotId: lastSnapshot.snapshotId,
                  elementIndex: 1,
                },
              },
            ],
            ['ask_user_question', 'runtime-question', ask],
          ]);
          session = await settled(
            session.id,
            (value) => value.status === 'waiting_user' && !value.hostWindowId
          );
          const beforeAnswerActions = actions;
          const replayAnswer = {
            type: 'skill.answer',
            id: session.id,
            epoch: session.epoch,
            revision: session.revision,
            submissionId: crypto.randomUUID(),
            toolCallId: 'runtime-question',
            answer: { status: 'answered', values: { orderNo: '000123' } },
          };
          session = (await service.receive(replayAnswer, popup)).value;
          await turn(session, [['browser_snapshot', 'observe-2', { tabId: 1, screenshot: false }]]);
          session = await settled(
            session.id,
            (value) =>
              value.hostWindowId &&
              value.responses?.length > (session.responses?.length ?? 0) &&
              !Object.values(value.ledger).some((e) => e.state === 'pending' || e.state === 'dispatched')
          );
          await turn(session, [
            [
              'browser_fill',
              'fill-1',
              {
                tabId: 1,
                target: {
                  documentId: lastSnapshot.documentId,
                  controllerId: lastSnapshot.controllerId,
                  snapshotId: lastSnapshot.snapshotId,
                  elementIndex: 1,
                },
                text: '000123',
              },
            ],
          ]);
          session = await settled(
            session.id,
            (value) => value.ledger['fill-1']?.state === 'dispatched' && Boolean(releaseAction)
          );
          const hostsBeforeDuplicate = nextTab;
          const duringAction = await service.receive(replayAnswer, popup);
          if (!duringAction.ok || nextTab !== hostsBeforeDuplicate || tabs.size !== 0) {
            throw new Error('duplicate answer created a Host while an effect was pending');
          }
          releaseAction();
          session = await settled(session.id, (value) => value.ledger['fill-1']?.state === 'completed');
          await turn(session, [['browser_snapshot', 'observe-3', { tabId: 1, screenshot: false }]]);
          session = await settled(
            session.id,
            (value) =>
              value.hostWindowId &&
              value.responses?.length > (session.responses?.length ?? 0) &&
              !Object.values(value.ledger).some((e) => e.state === 'pending' || e.state === 'dispatched')
          );
          const completedActions = actions;
          await turn(session, [], '合成：页面操作完成，需要报告结果。');
          session = await settled(session.id, (value) => value.status === 'failed' && !value.hostWindowId);
          session = (
            await service.receive({ type: 'skill.continue', id: session.id, epoch: session.epoch }, popup)
          ).value;
          if (!session.responseRecovery || actions !== completedActions) {
            throw Error('Narration replayed a page effect');
          }
          await turn(session, [['browser_snapshot', 'observe-recovery', { tabId: 1, screenshot: false }]]);
          session = await settled(
            session.id,
            (value) => value.ledger['observe-recovery']?.state === 'completed'
          );
          await turn(session, [
            [
              'finish_run',
              'finish-1',
              {
                summary: '页面显示订单000123待处理',
                outcome: 'completed',
              },
            ],
          ]);
          session = await settled(session.id, (value) => value.status === 'completed');
          if (actions !== completedActions || session.responseRecoveryCalls !== 2) {
            throw Error('Recovery changed completed action count');
          }
          const verification = session.result.verification;
          const failedReplay = (
            await service.receive(
              {
                type: 'skill.start',
                recordingId,
                mode: 'replay',
                consent: { baseUrl: settings.baseUrl, model: settings.model },
              },
              popup
            )
          ).value;
          const failedSender = {
            id: 'fixture',
            url: popup.url,
            frameId: 0,
            documentId: popup.documentId,
          };
          await service.receive(
            { type: 'skill.host.ready', id: failedReplay.id, epoch: failedReplay.epoch },
            failedSender
          );
          await service.receive(
            {
              type: 'skill.host.failed',
              id: failedReplay.id,
              epoch: failedReplay.epoch,
              error: 'MODEL_UNAVAILABLE',
            },
            failedSender
          );
          if (owner !== undefined || tabs.size !== 0) {
            throw new Error('Failed model left replay ownership held');
          }
          const emptyReplay = (
            await service.receive(
              {
                type: 'skill.start',
                recordingId,
                mode: 'replay',
                consent: { baseUrl: settings.baseUrl, model: settings.model },
              },
              popup
            )
          ).value;
          await turn(emptyReplay, []);
          const emptyFailure = await settled(
            emptyReplay.id,
            (value) => value.status === 'failed' && !value.hostWindowId
          );
          if (
            emptyFailure.error !== 'MODEL_EMPTY_RESPONSE' ||
            emptyFailure.responses.at(-1).classification !== 'empty'
          ) {
            throw Error('Missing empty response diagnostic');
          }
          if (owner !== undefined || tabs.size !== 0) {
            throw new Error('Empty model turn left replay ownership held');
          }
          const truncated = (
            await service.receive(
              {
                type: 'skill.start',
                recordingId,
                mode: 'replay',
                consent: { baseUrl: settings.baseUrl, model: settings.model },
              },
              popup
            )
          ).value;
          await turn(truncated, [], '合成：未完成的回复', 'length');
          const truncatedFailure = await settled(
            truncated.id,
            (value) => value.status === 'failed' && !value.hostWindowId
          );
          if (
            truncatedFailure.error !== 'MODEL_OUTPUT_TRUNCATED' ||
            !JSON.stringify(truncatedFailure.messages).includes('合成：未完成的回复')
          ) {
            throw Error('Truncated output was not preserved');
          }
          const sessionRepo = new BuiltinAgentServiceProbe.SkillSessionRepository();
          const legacy = await sessionRepo.update(
            emptyFailure.id,
            emptyFailure.revision,
            emptyFailure.epoch,
            (value) => {
              value.error = 'SKILL_NO_TOOL';
            }
          );
          const resumedLegacy = (
            await service.receive({ type: 'skill.continue', id: legacy.id, epoch: legacy.epoch }, popup)
          ).value;
          if (!resumedLegacy.responseRecovery || !resumedLegacy.observationRequired) {
            throw Error('Legacy replay did not resume with read-only correction');
          }
          await turn(resumedLegacy, [
            ['browser_snapshot', 'legacy-recheck', { tabId: 1, screenshot: false }],
          ]);
          const rechecked = await settled(
            legacy.id,
            (value) => value.ledger['legacy-recheck']?.state === 'completed'
          );
          await service.receive({ type: 'skill.cancel', id: rechecked.id, epoch: rechecked.epoch }, popup);
          nativeError = 'SKILL_OFFLINE';
          const replayRequest = {
            type: 'skill.start',
            recordingId,
            mode: 'replay',
            consent: { baseUrl: settings.baseUrl, model: settings.model },
          };
          const denied = await service.receive(replayRequest, popup);
          if (denied.ok || denied.error !== 'SKILL_CACHED_COPY_CONFIRMATION_REQUIRED' || owner) {
            throw new Error('Silent cache fallback');
          }
          const cached = (await service.receive({ type: 'skill.state', recordingId }, popup)).value.binding;
          const stale = await service.receive(
            { ...replayRequest, browserCopy: { skillId: cached.skillId, contentHash: '0'.repeat(64) } },
            popup
          );
          if (stale.ok || stale.error !== 'SKILL_SESSION_STALE') {
            throw new Error('Stale cache confirmation accepted');
          }
          const browserCopy = { skillId: cached.skillId, contentHash: cached.cache.contentHash };
          const fallback = await service.receive({ ...replayRequest, browserCopy }, popup);
          if (
            !fallback.ok ||
            fallback.value.skillSource.storage !== 'cached' ||
            !fallback.value.context.skill.candidate.skillMarkdown.includes('User edited')
          ) {
            throw new Error('Latest known copy was not retained');
          }
          await service.receive(
            { type: 'skill.cancel', id: fallback.value.id, epoch: fallback.value.epoch },
            popup
          );
          nativeError = 'SKILL_INVALID';
          const invalid = await service.receive({ ...replayRequest, browserCopy }, popup);
          if (invalid.ok || invalid.error !== 'SKILL_INVALID') {
            throw new Error('Corrupt file fell back silently');
          }
          nativeError = undefined;
          const originalSkillId = stored.receipt.skillId;
          failSave = true;
          session = (await service.receive({ type: 'skill.start', recordingId, mode: 'organize' }, popup))
            .value;
          await turn(session, [['submit_skill', 'save-new-copy', candidate]]);
          session = await settled(session.id, (value) => value.status === 'completed');
          const replacement = (await service.receive({ type: 'skill.state', recordingId }, popup)).value
            .binding;
          if (
            replacement.skillId === originalSkillId ||
            replacement.storage !== 'browser' ||
            saves !== 1 ||
            stored.receipt.skillId !== originalSkillId
          ) {
            throw new Error('Reorganization overwrote disk');
          }
          /** Runs the production Host, SDK and provider adapter against a finite synthetic transport. */
          async function nativeRun(task, plan) {
            const originalFetch = globalThis.fetch;
            const originalSend = globalThis.__skillBrowser.runtime.sendMessage;
            const commands = [];
            let requests = 0;
            let transportError;
            globalThis.__skillBrowser.runtime.sendMessage = async (command) => {
              commands.push(command.type);
              return service.receive(command, popup);
            };
            globalThis.fetch = async (url, options) => {
              try {
                if (String(url) !== settings.baseUrl + '/chat/completions') {
                  throw Error('Unexpected provider URL');
                }
                const body = JSON.parse(options.body);
                const preparingSession = await sessionRepo.get(task.id);
                if (preparingSession.pageAccess?.reason === 'permission') {
                  const names = body.tools.map((tool) => tool.function.name).sort();
                  if (JSON.stringify(names) !== JSON.stringify(['ask_user_question', 'finish_run'])) {
                    throw Error('SDK exposed page tools while permission recovery was pending');
                  }
                }
                if (
                  task.mode === 'replay' &&
                  requests &&
                  !JSON.stringify(body.messages).includes('skillMarkdown')
                ) {
                  throw Error('Skill content not in native context');
                }
                const item = plan[requests++];
                if (!item) {
                  throw Error('Unexpected model request');
                }
                return new Response(
                  JSON.stringify({
                    id: 'synthetic-' + requests,
                    object: 'chat.completion',
                    created: 1,
                    model: settings.model,
                    choices: [
                      {
                        index: 0,
                        message: {
                          role: 'assistant',
                          content: null,
                          tool_calls: [
                            {
                              id: 'native-' + (task.modelCalls + requests),
                              type: 'function',
                              function: { name: item[0], arguments: JSON.stringify(item[1]) },
                            },
                          ],
                        },
                        finish_reason: 'tool_calls',
                      },
                    ],
                    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
                  }),
                  { headers: { 'Content-Type': 'application/json' } }
                );
              } catch (error) {
                transportError = error.message;
                throw error;
              }
            };
            try {
              await BuiltinAgentServiceProbe.runBuiltinAgent(
                task.id,
                task.epoch,
                new AbortController().signal
              );
            } finally {
              globalThis.fetch = originalFetch;
              globalThis.__skillBrowser.runtime.sendMessage = originalSend;
            }
            if (transportError) {
              throw Error(transportError);
            }
            return {
              requests,
              preparations: commands.filter((type) => type === 'skill.host.prepare').length,
              failed: commands.includes('skill.host.failed'),
              ended: commands.includes('skill.host.end'),
              session: (await service.receive({ type: 'skill.get', id: task.id }, popup)).value,
            };
          }
          const baselineObservations = observations;
          const replayCommand = {
            type: 'skill.start',
            recordingId,
            mode: 'replay',
            consent: { baseUrl: settings.baseUrl, model: settings.model },
          };
          const native = await nativeRun((await service.receive(replayCommand, popup)).value, [
            ['read_skill', {}],
            ['browser_snapshot', { tabId: 1, screenshot: false }],
            // Completion no longer asks the model to supply an internal observation tool ID.
            ['finish_run', { summary: '已核对当前页面', outcome: 'completed' }],
          ]);
          if (
            native.requests !== 3 ||
            native.session.status !== 'completed' ||
            new Set(native.session.responses.map((r) => r.epoch)).size !== 1
          ) {
            throw Error('Production native loop did not complete within one Host generation');
          }
          const repeated = await nativeRun((await service.receive(replayCommand, popup)).value, [
            ['read_skill', {}],
            ...Array.from({ length: 3 }, () => ['finish_run', { summary: '无观察', outcome: 'completed' }]),
          ]);
          if (repeated.requests !== 4 || repeated.session.error !== 'SKILL_NO_PROGRESS') {
            throw Error('Repeated invalid finish was not bounded');
          }
          values.skillExecutionLimits.replay = 2;
          const budgeted = await nativeRun((await service.receive(replayCommand, popup)).value, [
            ['read_skill', {}],
            ['browser_tabs', {}],
            ['browser_tabs', {}],
          ]);
          if (
            budgeted.requests !== 2 ||
            budgeted.preparations !== 2 ||
            budgeted.failed ||
            !budgeted.ended ||
            budgeted.session.error !== 'SKILL_MODEL_BUDGET' ||
            !budgeted.session.messages.some(
              (message) =>
                message.role === 'tool' && message.content.some((part) => part.toolCallId === 'native-2')
            ) ||
            owner
          ) {
            throw Error('Native loop did not stop normally after checkpointing the final budgeted tool');
          }
          values.skillExecutionLimits.replay = 3;
          const finalCompletion = await nativeRun((await service.receive(replayCommand, popup)).value, [
            ['read_skill', {}],
            ['browser_snapshot', { tabId: 1, screenshot: false }],
            ['finish_run', { summary: '最后一轮完成', outcome: 'completed' }],
          ]);
          if (
            finalCompletion.failed ||
            finalCompletion.requests !== 3 ||
            finalCompletion.session.status !== 'completed'
          ) {
            throw Error('Budget exhaustion overrode successful completion on the final step');
          }
          const extended = await service.receive(
            {
              type: 'skill.extend-budget',
              id: budgeted.session.id,
              epoch: budgeted.session.epoch,
              revision: budgeted.session.revision,
              additional: 2,
            },
            popup
          );
          if (!extended.ok) {
            throw Error('Budget extension rejected: ' + extended.error);
          }
          const continued = await nativeRun(extended.value, [
            ['browser_snapshot', { tabId: 1, screenshot: false }],
            ['finish_run', { summary: '追加额度后完成', outcome: 'completed' }],
          ]);
          if (
            continued.failed ||
            !continued.ended ||
            continued.requests !== 2 ||
            continued.session.modelCalls !== 4 ||
            continued.session.status !== 'completed' ||
            !continued.session.ledger['native-1']?.result
          ) {
            throw Error('Budget extension reset history or did not resume the production Host');
          }
          values.skillExecutionLimits.replay = 2;
          const question = await nativeRun((await service.receive(replayCommand, popup)).value, [
            ['read_skill', {}],
            ['ask_user_question', ask],
          ]);
          if (
            question.failed ||
            !question.ended ||
            question.requests !== 2 ||
            question.session.status !== 'waiting_user' ||
            !question.session.pendingQuestion
          ) {
            throw Error('Final budgeted question did not preserve waiting state');
          }
          const answered = await service.receive(
            {
              type: 'skill.answer',
              id: question.session.id,
              epoch: question.session.epoch,
              revision: question.session.revision,
              submissionId: crypto.randomUUID(),
              toolCallId: question.session.pendingQuestion.toolCallId,
              answer: { status: 'answered', values: { orderNo: '000123' } },
            },
            popup
          );
          if (!answered.ok) {
            throw Error('Final budgeted question answer rejected: ' + answered.error);
          }
          const exhausted = await nativeRun(answered.value, []);
          if (
            exhausted.requests !== 0 ||
            exhausted.preparations !== 1 ||
            !exhausted.failed ||
            exhausted.session.modelCalls !== 2 ||
            exhausted.session.error !== 'SKILL_MODEL_BUDGET' ||
            exhausted.session.pendingQuestion ||
            !Object.values(exhausted.session.answers).some(
              (answer) => answer.toolCallId === question.session.pendingQuestion.toolCallId
            )
          ) {
            throw Error('Answer reset budget, lost the answer or dispatched an extra model request');
          }
          requirePermission = true;
          values.skillExecutionLimits.replay = 20;
          pendingOpenReceipt = true;
          const knownOpen = await nativeRun((await service.receive(replayCommand, popup)).value, [
            ['read_skill', {}],
            ['browser_open_tab', { url: 'https://orders.example.com/search', background: false }],
            [
              'ask_user_question',
              {
                question: '页面已打开，请恢复访问权限或结束任务。',
                fields: [{ id: 'ready', label: '处理结果', type: 'text', required: true, maxLength: 100 }],
                allowDefer: false,
              },
            ],
          ]);
          const knownEntry = Object.values(knownOpen.session.ledger).find(
            (entry) => entry.toolName === 'browser_open_tab'
          );
          if (
            knownOpen.session.status !== 'waiting_user' ||
            knownOpen.session.pageAccess?.reason !== 'permission' ||
            knownEntry.state !== 'completed' ||
            knownEntry.result.output.value.tabId !== 42
          ) {
            throw Error('Known tab receipt was lost or classified as an unknown effect');
          }
          await service.receive(
            { type: 'skill.cancel', id: knownOpen.session.id, epoch: knownOpen.session.epoch },
            popup
          );
          pendingOpenReceipt = 'timeout';
          const timedOut = await nativeRun((await service.receive(replayCommand, popup)).value, [
            ['read_skill', {}],
            ['browser_open_tab', { url: 'https://orders.example.com/search', background: false }],
          ]);
          if (
            timedOut.session.status !== 'failed' ||
            timedOut.session.error !== 'PAGE_READY_TIMEOUT' ||
            timedOut.requests !== 2 ||
            Object.values(timedOut.session.ledger).some((entry) => entry.state === 'unknown')
          ) {
            throw Error('Exhausted waits did not stop with a known tab receipt and no extra model request');
          }
          if (timedOut.session.pageWait.seconds !== 15 || timedOut.session.pageWait.attempts !== 3) {
            throw Error('Wait policy not captured on the session');
          }
          const completedRevision = timedOut.session.revision;
          await lastWaitObserver({ seconds: 15, attempts: 3, attempt: 1, tabId: 42, startedAt: Date.now() });
          if ((await sessionRepo.get(timedOut.session.id)).revision !== completedRevision) {
            throw Error('Late progress changed a completed tool/session');
          }
          pendingOpenReceipt = false;
          accessReason = 'scheme';
          for (const legacyPayload of [true, false]) {
            reproduceUndefinedAccess = legacyPayload;
            const transportTask = (await service.receive(replayCommand, popup)).value;
            const transportResult = await nativeRun(transportTask, [
              ['read_skill', {}],
              ['browser_snapshot', { tabId: 1, screenshot: false }],
              ['finish_run', { summary: '页面不可操作，结束本次任务。', outcome: 'incomplete' }],
            ]);
            if (legacyPayload) {
              if (
                transportResult.session.status !== 'interrupted' ||
                transportResult.session.error !== 'SKILL_OUTCOME_UNKNOWN' ||
                !Object.values(transportResult.session.ledger).some(
                  (entry) => entry.result?.output.value === 'SKILL_INTERRUPTED_READ'
                )
              ) {
                throw Error('Legacy undefined payload did not reproduce the reported failure chain');
              }
            } else {
              if (
                transportResult.session.status !== 'failed' ||
                transportResult.session.result?.outcome !== 'incomplete' ||
                transportResult.session.pageAccess?.reason !== 'scheme' ||
                Object.values(transportResult.session.ledger).some(
                  (entry) =>
                    entry.state === 'dispatched' || entry.result?.output.value === 'SKILL_INTERRUPTED_READ'
                )
              ) {
                throw Error('JSON-safe refusal did not settle and exit normally');
              }
            }
          }
          accessReason = 'permission';
          const accessTask = (await service.receive(replayCommand, popup)).value;
          const permissionQuestion = {
            question: '请恢复浏览器站点权限，或结束任务。',
            fields: [{ id: 'ready', label: '处理结果', type: 'text', required: true, maxLength: 100 }],
            allowDefer: false,
          };
          const deniedAccess = await nativeRun(accessTask, [
            ['read_skill', {}],
            ['browser_snapshot', { tabId: 1, screenshot: false }],
            ['ask_user_question', permissionQuestion],
          ]);
          if (
            deniedAccess.session.status !== 'waiting_user' ||
            deniedAccess.session.pageAccess?.reason !== 'permission'
          ) {
            throw Error('Access recovery was not persisted before asking');
          }
          const freshRepo = new BuiltinAgentServiceProbe.SkillSessionRepository();
          if ((await freshRepo.get(accessTask.id)).pageAccess.origin !== 'https://orders.example.com') {
            throw Error('Access metadata lost or contains private URL data');
          }
          let accessSession = deniedAccess.session;
          const claimRestored = async () => {
            const reply = await service.receive(
              {
                type: 'skill.answer',
                id: accessSession.id,
                epoch: accessSession.epoch,
                revision: accessSession.revision,
                submissionId: crypto.randomUUID(),
                toolCallId: accessSession.pendingQuestion.toolCallId,
                answer: { status: 'answered', values: { ready: '已恢复权限' } },
              },
              popup
            );
            if (!reply.ok) {
              throw Error('Permission answer was not committed: ' + reply.error);
            }
            return reply.value;
          };
          const beforeBlockedActions = actions;
          const stillDenied = await nativeRun(await claimRestored(), [
            ['browser_open_tab', { url: 'https://orders.example.com/search', background: false }],
            ['ask_user_question', permissionQuestion],
          ]);
          if (
            stillDenied.session.status !== 'waiting_user' ||
            stillDenied.session.pageAccess?.reason !== 'permission' ||
            actions !== beforeBlockedActions
          ) {
            throw Error('User text bypassed the actual browser permission');
          }
          accessSession = stillDenied.session;
          permissionGranted = true;
          const restoredAccess = await nativeRun(await claimRestored(), [
            ['browser_snapshot', { tabId: 1, screenshot: false }],
            ['finish_run', { summary: '根据新观察结束', outcome: 'completed' }],
          ]);
          if (
            restoredAccess.session.status !== 'completed' ||
            restoredAccess.session.pageAccess ||
            permissionChecks < 2
          ) {
            throw Error('Host restart did not recheck permission and require a fresh snapshot');
          }
          requirePermission = false;
          values.skillExecutionLimits.organize = 2;
          const organizing = await service.receive(
            {
              type: 'skill.start',
              recordingId,
              mode: 'organize',
            },
            popup
          );
          if (!organizing.ok) {
            throw Error('Final budgeted organization start rejected: ' + organizing.error);
          }
          const submitted = await nativeRun(organizing.value, [
            ['read_recording', { offset: 0, limit: 20 }],
            ['submit_skill', candidate],
          ]);
          if (
            submitted.failed ||
            !submitted.ended ||
            submitted.requests !== 2 ||
            submitted.session.status !== 'completed' ||
            submitted.session.modelCalls !== 2 ||
            !submitted.session.ledger['native-2']?.result ||
            (await sessionRepo.binding(recordingId)).sessionId !== submitted.session.id
          ) {
            throw Error('Final budgeted submit did not preserve its saved completion receipt');
          }
          const latest = submitted.session;
          const deleteCommand = (task) => ({
            type: 'skill.delete',
            id: task.id,
            epoch: task.epoch,
            revision: task.revision,
            deleteSkill: true,
          });
          const oldLocal = (await sessionRepo.list(recordingId)).find(
            (task) => task.mode === 'organize' && task.localSkillFiles && task.id !== latest.id
          );
          if (!oldLocal) {
            throw Error('Missing exported generation fixture');
          }
          const deletedFiles = [];
          files.request = async (command) => {
            if (command.type !== 'skills.delete') {
              throw Error('Unexpected file request during deletion');
            }
            deletedFiles.push(command.skillId);
            throw Error('SKILL_OFFLINE');
          };
          const staleDelete = await service.receive(
            { ...deleteCommand(oldLocal), revision: oldLocal.revision + 1 },
            popup
          );
          if (staleDelete.error !== 'SKILL_SESSION_STALE' || deletedFiles.length) {
            throw Error('Stale dialog dispatched file deletion');
          }
          const consumer = {
            ...latest,
            id: crypto.randomUUID(),
            mode: 'replay',
            status: 'waiting_user',
            context: {
              settings,
              skill: { skillId: oldLocal.operationId, definitionHash: 'a'.repeat(64), candidate },
            },
          };
          await sessionRepo.create(consumer);
          const inUse = await service.receive(deleteCommand(oldLocal), popup);
          if (inUse.error !== 'SKILL_IN_USE' || deletedFiles.length) {
            throw Error('Deletion ignored a waiting replay using the skill');
          }
          await sessionRepo.remove(consumer.id, consumer.revision, consumer.epoch);
          const failedDelete = await service.receive(deleteCommand(oldLocal), popup);
          if (
            failedDelete.ok ||
            failedDelete.error !== 'SKILL_DELETE_FILES_FAILED' ||
            !(await sessionRepo.get(oldLocal.id))
          ) {
            throw Error('Failed local deletion lost its conversation');
          }
          files.request = async (command) => {
            deletedFiles.push(command.skillId);
            return { deleted: true };
          };
          const removed = await service.receive(deleteCommand(oldLocal), popup);
          if (
            !removed.ok ||
            (await sessionRepo.get(oldLocal.id)) ||
            (await sessionRepo.binding(recordingId)).sessionId !== latest.id ||
            deletedFiles.some((id) => id !== oldLocal.operationId)
          ) {
            throw Error('Old conversation deletion damaged another generation');
          }
          files.request = async () => {
            throw Error('Browser-only deletion contacted Executor');
          };
          const localRemoved = await service.receive(deleteCommand(latest), popup);
          if (
            !localRemoved.ok ||
            (await sessionRepo.get(latest.id)) ||
            (await sessionRepo.binding(recordingId))
          ) {
            throw Error('Browser-only skill was not deleted offline');
          }
          return {
            ...afterSave,
            edited,
            beforeAnswerActions,
            actions,
            observations: baselineObservations,
            result: verification,
            remainingHosts: tabs.size,
            owner,
          };
        });
        assert.deepEqual(result, {
          models: 7,
          beforeRetry: 7,
          savedError: undefined,
          saves: 1,
          savedResult: true,
          edited: true,
          beforeAnswerActions: 0,
          actions: 1,
          observations: 5,
          result: 'unverified',
          remainingHosts: 0,
          owner: undefined,
        });
      } finally {
        await browser?.close();
        await new Promise((resolve) => server.close(resolve));
      }
    }
  );
}
