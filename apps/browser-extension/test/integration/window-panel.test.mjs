/**
 * @author Codex
 * @description Validates native side-panel lifecycle, window ownership and real SDK/PageController execution with an isolated local model peer.
 */
import test from 'node:test';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
/* global chrome */

const root = fileURLToPath(new URL('../../', import.meta.url));

for (const flavor of ['chrome', 'edge']) {
  test(
    `installed ${flavor}: window-global panel coexists with the popup without an agent tab`,
    { timeout: 60000 },
    async () => {
      const temporary = await mkdtemp(join(tmpdir(), 'octopus-window-panel-'));
      let context;
      let modelRequests = 0;
      let explanationSeen = false;
      let slowResourceFinished = false;
      const provider = createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', '*');
        if (req.method === 'OPTIONS') {
          res.end();
          return;
        }
        if (req.url === '/fixture') {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(
            '<!doctype html><title>Loading fixture</title><body data-clicks="0"><button onclick="document.body.dataset.clicks=String(Number(document.body.dataset.clicks)+1)">合成测试按钮</button><img src="/slow-resource" alt=""><script defer src="/fixture-ready.js"></script></body>'
          );
          return;
        }
        if (req.url === '/slow-resource') {
          setTimeout(() => {
            slowResourceFinished = true;
            res.end();
          }, 14000);
          return;
        }
        if (req.url === '/fixture-ready.js') {
          res.setHeader('Content-Type', 'application/javascript');
          setTimeout(
            () =>
              res.end(`document.title='Panel replay ready';
            const same=document.createElement('iframe');same.srcdoc='<iframe srcdoc="<button>Nested fixture</button>"></iframe>';document.body.append(same);
            const foreign=document.createElement('iframe');foreign.src=location.origin.replace('127.0.0.1','localhost')+'/opaque-frame';document.body.append(foreign);`),
            400
          );
          return;
        }
        if (req.url === '/opaque-frame') {
          res.setHeader('Content-Type', 'text/html');
          res.end('<button>OPAQUE_PRIVATE_FIXTURE</button>');
          return;
        }
        if (req.url !== '/v1/chat/completions') {
          res.statusCode = 404;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          modelRequests++;
          if (modelRequests === 2) {
            explanationSeen = body.includes('explanation') && body.includes('不需要编号');
          }
          if (modelRequests === 2) {
            return;
          }
          let name = 'ask_user_question';
          let callId = 'ask-' + modelRequests;
          let input = {
            question: '请填写测试编号',
            fields: [{ id: 'number', label: '测试编号', type: 'text', required: true, maxLength: 30 }],
            allowDefer: true,
          };
          if (modelRequests === 4) {
            name = 'read_skill';
            callId = 'replay-skill';
            input = {};
          }
          if (modelRequests === 5) {
            assert.match(body, /skillMarkdown/);
            name = 'browser_open_tab';
            callId = 'replay-open';
            input = { url: 'http://127.0.0.1:' + provider.address().port + '/fixture', background: false };
          }
          if (modelRequests === 6 || modelRequests === 8) {
            const messages = JSON.parse(body).messages;
            const opened = messages.find(
              (message) => message.role === 'tool' && message.tool_call_id === 'replay-open'
            );
            assert.equal(
              JSON.parse(opened.content).title,
              'Panel replay ready',
              'Opening must wait for main-document receiver readiness'
            );
            if (modelRequests === 6) {
              assert.equal(
                slowResourceFinished,
                false,
                'Unrelated resources must not gate a ready main document'
              );
            }
            name = 'browser_snapshot';
            callId = modelRequests === 6 ? 'replay-snapshot' : 'replay-after-click';
            input = { tabId: JSON.parse(opened.content).tabId, screenshot: false };
          }
          if (modelRequests === 7) {
            const messages = JSON.parse(body).messages;
            const snapshot = JSON.parse(
              messages.find(
                (message) => message.role === 'tool' && message.tool_call_id === 'replay-snapshot'
              ).content
            );
            assert.equal(snapshot.text.includes('OPAQUE_PRIVATE_FIXTURE'), false);
            const opened = JSON.parse(
              messages.find((message) => message.role === 'tool' && message.tool_call_id === 'replay-open')
                .content
            );
            const line = snapshot.text
              .split('\n')
              .find((line) => line.includes('合成测试按钮') && /\[\d+\]/.test(line));
            assert.ok(line, 'Real Controller observation must include an indexed button');
            name = 'browser_click';
            callId = 'replay-click';
            input = {
              tabId: opened.tabId,
              target: {
                documentId: snapshot.documentId,
                controllerId: snapshot.controllerId,
                snapshotId: snapshot.snapshotId,
                elementIndex: Number(line.match(/\[(\d+)\]/)[1]),
              },
            };
          }
          if (modelRequests >= 9) {
            name = 'finish_run';
            callId = 'replay-finish';
            input = {
              summary: '已观察合成测试页面',
              outcome: 'completed',
            };
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              id: 'fixture-' + modelRequests,
              object: 'chat.completion',
              created: 1,
              model: 'synthetic',
              choices: [
                {
                  index: 0,
                  finish_reason: 'tool_calls',
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                      { id: callId, type: 'function', function: { name, arguments: JSON.stringify(input) } },
                    ],
                  },
                },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
            })
          );
        });
      });
      await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
      try {
        const extension = join(temporary, 'extension');
        await cp(join(root, '.output', flavor + '-mv3'), extension, { recursive: true });
        const { identity, profile } = JSON.parse(
          await readFile(join(extension, 'browser-identity.json'), 'utf8')
        );
        if (profile === 'store') {
          // This owned UI-only copy uses the development key; it is not store/Native Host acceptance.
          const manifestPath = join(extension, 'manifest.json');
          const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
          await writeFile(manifestPath, JSON.stringify({ ...manifest, key: identity.sideloadPublicKey }));
        }
        // Only the owned copy points to an unregistered test Host; all popup and worker logic remains production code.
        const background = join(extension, 'background.js');
        const source = await readFile(background, 'utf8');
        assert.equal(source.split('com.octopus.executor.browser').length, 2);
        await writeFile(
          background,
          source.replace('com.octopus.executor.browser', 'com.octopus.test.popup_unregistered')
        );
        const executablePath =
          flavor === 'chrome'
            ? join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe')
            : join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe');
        context = await chromium.launchPersistentContext(join(temporary, 'profile'), {
          executablePath,
          headless: false,
          ignoreDefaultArgs: ['--disable-extensions'],
          args: ['--enable-unsafe-extension-debugging', '--window-position=-2000,-2000', '--no-first-run'],
        });
        const cdp = await context.browser().newBrowserCDPSession();
        const { id } = await cdp.send('Extensions.loadUnpacked', { path: extension });
        assert.equal(id, identity.sideloadExtensionId);
        let worker = context.serviceWorkers().find((entry) => entry.url().includes(id));
        if (!worker) {
          worker = await context.waitForEvent('serviceworker');
        }
        const popup = await context.newPage();
        await popup.goto(`chrome-extension://${id}/popup.html`);
        await popup.evaluate(async () => {
          const current = await chrome.windows.getCurrent();
          const button = document.createElement('button');
          button.id = 'open-panel';
          button.style.cssText = 'position:fixed;top:0;right:0;z-index:99999';
          button.textContent = 'Open panel';
          button.onclick = () => {
            window.openResult = 'pending';
            chrome.sidePanel.open({ windowId: current.id }).then(
              () => (window.openResult = 'ok'),
              (error) => (window.openResult = error.message)
            );
          };
          document.body.append(button);
        });
        await popup.locator('#open-panel').click({ force: true });
        await expect.poll(() => popup.evaluate(() => window.openResult)).toBe('ok');
        await expect
          .poll(() =>
            worker.evaluate(
              async () => (await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).length
            )
          )
          .toBe(1);
        const panelContexts = await worker.evaluate(() =>
          chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })
        );
        assert.ok(panelContexts[0].documentId);
        await expect
          .poll(async () =>
            (await cdp.send('Target.getTargets')).targetInfos.some((target) =>
              target.url.includes('/window-panel.html?instance=')
            )
          )
          .toBe(true);
        const normalTabs = await worker.evaluate(() => chrome.tabs.query({}));
        assert.equal(
          normalTabs.some(
            (tab) => tab.url?.includes('skill-host.html') || tab.url?.includes('window-panel.html')
          ),
          false
        );
        assert.equal(
          await worker.evaluate(() => chrome.runtime.getManifest().action.default_popup),
          'popup.html'
        );
        await worker.evaluate(async (port) => {
          const db = await new Promise((resolve, reject) => {
            const r = indexedDB.open('octopus-skill-sessions', 4);
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          });
          const session = {
            id: '20000000-0000-4000-8000-000000000002',
            recordingId: '10000000-0000-4000-8000-000000000001',
            name: '侧边栏合成验收',
            mode: 'organize',
            revision: 0,
            epoch: '30000000-0000-4000-8000-000000000003',
            status: 'interrupted',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            modelCalls: 0,
            modelCallLimit: 50,
            toolCalls: 0,
            questions: 0,
            messages: [{ role: 'user', content: '合成测试，请询问编号。' }],
            ledger: {},
            answers: {},
            observationRequired: false,
            context: {
              settings: {
                provider: 'openai-compatible',
                baseUrl: 'http://127.0.0.1:' + port + '/v1',
                model: 'synthetic',
              },
            },
          };
          await new Promise((resolve, reject) => {
            const tx = db.transaction('sessions', 'readwrite');
            tx.objectStore('sessions').put(session);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
          });
          db.close();
          const recordings = await new Promise((resolve) => {
            const r = indexedDB.open('octopus-recordings', 2);
            r.onsuccess = () => resolve(r.result);
          });
          await new Promise((resolve, reject) => {
            const tx = recordings.transaction('sessions', 'readwrite');
            tx.objectStore('sessions').put({
              id: session.recordingId,
              name: session.name,
              status: 'stopped',
              startedAt: Date.now(),
              updatedAt: Date.now(),
              elapsedMs: 1000,
              resumedAt: null,
              windowId: 1,
              origins: ['https://example.com'],
              includeRelated: false,
              pages: [],
              gaps: [],
              count: 1,
              actionCount: 1,
            });
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
          });
          recordings.close();
          await chrome.storage.local.set({
            recordingRevision: crypto.randomUUID(),
            skillRevision: crypto.randomUUID(),
          });
        }, provider.address().port);
        await popup.getByRole('tab', { name: '录制重放', exact: true }).click();
        await popup.getByText('侧边栏合成验收', { exact: true }).click();
        await popup.getByRole('button', { name: '查看整理', exact: true }).click();
        let target = (await cdp.send('Target.getTargets')).targetInfos.find((target) =>
          target.url.includes('/window-panel.html?instance=')
        );
        let attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
        let sequence = 0;
        async function panelCommand(method, params = {}) {
          const messageId = ++sequence;
          const response = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              cdp.off('Target.receivedMessageFromTarget', receive);
              reject(Error('Panel CDP timeout'));
            }, 10000);
            const receive = (event) => {
              if (event.sessionId !== attached.sessionId) {
                return;
              }
              const value = JSON.parse(event.message);
              if (value.id !== messageId) {
                return;
              }
              clearTimeout(timer);
              cdp.off('Target.receivedMessageFromTarget', receive);
              if (value.error) {
                reject(Error(JSON.stringify(value.error)));
              } else {
                resolve(value.result);
              }
            };
            cdp.on('Target.receivedMessageFromTarget', receive);
          });
          await cdp.send('Target.sendMessageToTarget', {
            sessionId: attached.sessionId,
            message: JSON.stringify({ id: messageId, method, params }),
          });
          return response;
        }
        await expect
          .poll(
            async () =>
              (
                await panelCommand('Runtime.evaluate', {
                  expression: 'document.body.innerText',
                  returnByValue: true,
                })
              ).result.value
          )
          .toContain('整理技能');
        const panelWindow = await panelCommand('Runtime.evaluate', {
          expression: 'chrome.windows.getCurrent().then(w=>w.id)',
          awaitPromise: true,
          returnByValue: true,
        });
        assert.equal(
          panelWindow.result.value,
          normalTabs.find((tab) => tab.url?.endsWith('/popup.html')).windowId
        );
        const evidence = join(root, 'build/validation-evidence/window-panel');
        await mkdir(evidence, { recursive: true });
        const capture = await panelCommand('Page.captureScreenshot');
        await writeFile(join(evidence, flavor + '-panel.png'), Buffer.from(capture.data, 'base64'));
        await context.newPage();
        assert.equal(
          (await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }))).length,
          1
        );
        async function readSession(id = '20000000-0000-4000-8000-000000000002') {
          return worker.evaluate(async (id) => {
            const db = await new Promise((resolve) => {
              const r = indexedDB.open('octopus-skill-sessions', 4);
              r.onsuccess = () => resolve(r.result);
            });
            const result = await new Promise((resolve) => {
              const r = db.transaction('sessions').objectStore('sessions').get(id);
              r.onsuccess = () => resolve(r.result);
            });
            db.close();
            return result;
          }, id);
        }
        const continueExpression =
          "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='继续').click()";
        await panelCommand('Runtime.evaluate', { expression: continueExpression, returnByValue: true });
        await expect.poll(async () => (await readSession()).status).toBe('waiting_user');
        assert.equal(modelRequests, 1);
        const waitingCapture = await panelCommand('Page.captureScreenshot');
        await writeFile(join(evidence, flavor + '-waiting.png'), Buffer.from(waitingCapture.data, 'base64'));
        await panelCommand('Emulation.setDeviceMetricsOverride', {
          width: 360,
          height: 460,
          deviceScaleFactor: 1,
          mobile: false,
        });
        const shortCapture = await panelCommand('Page.captureScreenshot');
        await writeFile(join(evidence, flavor + '-short.png'), Buffer.from(shortCapture.data, 'base64'));
        await panelCommand('Emulation.clearDeviceMetricsOverride');
        const answerSession = await readSession();
        const answerReply = await panelCommand('Runtime.evaluate', {
          expression: `chrome.runtime.sendMessage(${JSON.stringify({ type: 'skill.answer', id: answerSession.id, epoch: answerSession.epoch, revision: answerSession.revision, submissionId: '40000000-0000-4000-8000-000000000004', toolCallId: 'ask-1', answer: { status: 'answered', values: { number: { kind: 'explanation', text: '不需要编号，请忽略此参数。' } } } })})`,
          awaitPromise: true,
          returnByValue: true,
        });
        assert.equal(answerReply.result.value.ok, true, JSON.stringify(answerReply));
        await expect.poll(() => modelRequests).toBe(2);
        assert.equal(explanationSeen, true);
        await panelCommand('Runtime.evaluate', {
          expression: "document.querySelector('button[aria-label=会话历史]').click()",
        });
        await expect
          .poll(
            async () =>
              (
                await panelCommand('Runtime.evaluate', {
                  expression: 'document.body.innerText',
                  returnByValue: true,
                })
              ).result.value
          )
          .toContain('返回进行中会话');
        assert.equal((await readSession()).status, 'running');
        assert.equal(modelRequests, 2);
        const listDuringRun = await panelCommand('Page.captureScreenshot');
        await writeFile(
          join(evidence, flavor + '-history-running.png'),
          Buffer.from(listDuringRun.data, 'base64')
        );
        await panelCommand('Runtime.evaluate', {
          expression:
            "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('返回进行中会话')).click()",
        });

        await panelCommand('Runtime.evaluate', {
          expression: "document.querySelector('button[aria-label=模型设置]').click()",
        });
        await expect
          .poll(
            async () =>
              (
                await panelCommand('Runtime.evaluate', {
                  expression: 'document.body.innerText',
                  returnByValue: true,
                })
              ).result.value
          )
          .toContain('执行限制');
        assert.equal(modelRequests, 2);
        await expect
          .poll(
            async () =>
              (
                await panelCommand('Runtime.evaluate', {
                  expression: "document.getElementById('limit-organize')?.value",
                  returnByValue: true,
                })
              ).result.value
          )
          .toBe('50');
        assert.equal((await readSession()).status, 'running');
        const windowId = panelWindow.result.value;
        await worker.evaluate((windowId) => chrome.sidePanel.close({ windowId }), windowId);
        await expect.poll(async () => (await readSession()).status).toBe('interrupted');
        await popup.bringToFront();
        await popup.locator('#open-panel').click({ force: true });
        await expect
          .poll(async () =>
            (await cdp.send('Target.getTargets')).targetInfos.some((t) =>
              t.url.includes('/window-panel.html?instance=')
            )
          )
          .toBe(true);
        target = (await cdp.send('Target.getTargets')).targetInfos.find((t) =>
          t.url.includes('/window-panel.html?instance=')
        );
        attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
        await expect
          .poll(
            async () =>
              (
                await panelCommand('Runtime.evaluate', {
                  expression: 'document.body.innerText',
                  returnByValue: true,
                })
              ).result.value
          )
          .toContain('合成测试，请询问编号。');
        assert.equal(modelRequests, 2);
        await panelCommand('Runtime.evaluate', { expression: continueExpression, returnByValue: true });
        await expect.poll(async () => (await readSession()).status).toBe('waiting_user');
        assert.equal(modelRequests, 3);
        assert.equal((await readSession()).messages.filter((m) => m.role === 'tool').length, 1);
        const originalAttachment = attached;
        const secondWindow = await worker.evaluate(
          (url) => chrome.windows.create({ url, type: 'normal', focused: false }),
          `chrome-extension://${id}/popup.html`
        );
        await expect
          .poll(() => context.pages().filter((page) => page.url().endsWith('/popup.html')).length)
          .toBe(2);
        const secondPopup = context
          .pages()
          .find((page) => page !== popup && page.url().endsWith('/popup.html'));
        await secondPopup.evaluate(async () => {
          const current = await chrome.windows.getCurrent();
          const button = document.createElement('button');
          button.id = 'second-panel';
          button.style.cssText = 'position:fixed;top:0;right:0;z-index:99999';
          button.textContent = 'Open';
          button.onclick = () => chrome.sidePanel.open({ windowId: current.id });
          document.body.append(button);
        });
        await secondPopup.locator('#second-panel').click({ force: true });
        await expect
          .poll(() =>
            worker.evaluate(
              async () => (await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).length
            )
          )
          .toBe(2);
        await secondPopup.evaluate(async () => {
          const current = await chrome.windows.getCurrent();
          await chrome.runtime.sendMessage({
            type: 'skill.panel.open',
            windowId: current.id,
            route: {
              mode: 'organize',
              recordingId: '10000000-0000-4000-8000-000000000001',
              sessionId: '20000000-0000-4000-8000-000000000002',
            },
          });
        });
        await expect
          .poll(
            async () =>
              (await cdp.send('Target.getTargets')).targetInfos.filter((t) =>
                t.url.includes('/window-panel.html?instance=')
              ).length
          )
          .toBe(2);
        const secondTarget = (await cdp.send('Target.getTargets')).targetInfos.find(
          (t) => t.url.includes('/window-panel.html?instance=') && t.targetId !== target.targetId
        );
        attached = await cdp.send('Target.attachToTarget', {
          targetId: secondTarget.targetId,
          flatten: false,
        });
        await expect
          .poll(
            async () =>
              (
                await panelCommand('Runtime.evaluate', {
                  expression: 'document.body.innerText',
                  returnByValue: true,
                })
              ).result.value
          )
          .toContain('请填写测试编号');
        const ownerSession = await readSession();
        const wrongWindow = await panelCommand('Runtime.evaluate', {
          expression: `chrome.runtime.sendMessage(${JSON.stringify({ type: 'skill.answer', id: ownerSession.id, epoch: ownerSession.epoch, revision: ownerSession.revision, submissionId: '50000000-0000-4000-8000-000000000005', toolCallId: 'ask-3', answer: { status: 'answered', values: { number: '456' } } })})`,
          awaitPromise: true,
          returnByValue: true,
        });
        assert.equal(wrongWindow.result.value.error, 'SKILL_PANEL_OWNER');
        assert.equal(modelRequests, 3);
        await expect(popup.getByRole('button', { name: '模型设置', exact: true })).toHaveCount(0);
        const secondAttachment = attached;
        for (const connection of [originalAttachment, secondAttachment]) {
          attached = connection;
          await panelCommand('Runtime.evaluate', {
            expression: "document.querySelector('button[aria-label=模型设置]').click()",
          });
          await expect
            .poll(
              async () =>
                (
                  await panelCommand('Runtime.evaluate', {
                    expression: "document.getElementById('limit-organize')?.value",
                    returnByValue: true,
                  })
                ).result.value
            )
            .toBe('50');
        }
        await worker.evaluate(
          async (port) =>
            chrome.storage.local.set({
              workflowSettings: {
                provider: 'openai-compatible',
                baseUrl: 'http://127.0.0.1:' + port + '/v1',
                model: 'sync-first',
              },
              workflowSettingsRevision: 'sync-1',
              skillExecutionLimits: { organize: 55, replay: 100 },
            }),
          provider.address().port
        );
        for (const connection of [originalAttachment, secondAttachment]) {
          attached = connection;
          await expect
            .poll(
              async () =>
                (
                  await panelCommand('Runtime.evaluate', {
                    expression: "document.getElementById('model-name')?.value",
                    returnByValue: true,
                  })
                ).result.value
            )
            .toBe('sync-first');
          await expect
            .poll(
              async () =>
                (
                  await panelCommand('Runtime.evaluate', {
                    expression: "document.getElementById('limit-organize')?.value",
                    returnByValue: true,
                  })
                ).result.value
            )
            .toBe('55');
        }
        attached = secondAttachment;
        await panelCommand('Runtime.evaluate', {
          expression:
            "for(const [id,value] of [['model-name','local-edit'],['limit-organize','77']]){const input=document.getElementById(id);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}",
        });
        await worker.evaluate(
          async (port) =>
            chrome.storage.local.set({
              workflowSettings: {
                provider: 'openai-compatible',
                baseUrl: 'http://127.0.0.1:' + port + '/v1',
                model: 'sync-second',
              },
              workflowSettingsRevision: 'sync-2',
              skillExecutionLimits: { organize: 60, replay: 100 },
            }),
          provider.address().port
        );
        await expect
          .poll(
            async () =>
              (
                await panelCommand('Runtime.evaluate', {
                  expression: 'document.body.innerText',
                  returnByValue: true,
                })
              ).result.value
          )
          .toContain('配置已在其他窗口更新，当前输入已保留。');
        const draft = await panelCommand('Runtime.evaluate', {
          expression:
            "[document.getElementById('model-name').value,document.getElementById('limit-organize').value]",
          returnByValue: true,
        });
        assert.deepEqual(draft.result.value, ['local-edit', '77']);
        const conflictImage = await panelCommand('Page.captureScreenshot');
        await writeFile(
          join(evidence, flavor + '-settings-conflict.png'),
          Buffer.from(conflictImage.data, 'base64')
        );
        await panelCommand('Runtime.evaluate', {
          expression:
            "Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='加载最新配置').click();",
        });
        await expect
          .poll(
            async () =>
              (
                await panelCommand('Runtime.evaluate', {
                  expression: "document.getElementById('model-name').value",
                  returnByValue: true,
                })
              ).result.value
          )
          .toBe('sync-second');
        await expect
          .poll(
            async () =>
              (
                await panelCommand('Runtime.evaluate', {
                  expression: "document.getElementById('limit-organize').value",
                  returnByValue: true,
                })
              ).result.value
          )
          .toBe('60');
        attached = originalAttachment;
        await expect
          .poll(
            async () =>
              (
                await panelCommand('Runtime.evaluate', {
                  expression: "document.getElementById('model-name').value",
                  returnByValue: true,
                })
              ).result.value
          )
          .toBe('sync-second');
        await panelCommand('Runtime.evaluate', {
          expression: "document.querySelector('button[aria-label=会话历史]').click()",
        });
        await worker.evaluate((windowId) => chrome.windows.remove(windowId), secondWindow.id);
        attached = originalAttachment;
        assert.equal((await readSession()).status, 'waiting_user');
        const spoof = await context.newPage();
        await spoof.goto(target.url);
        const rejected = await spoof.evaluate(
          (session) =>
            chrome.runtime.sendMessage({ type: 'skill.cancel', id: session.id, epoch: session.epoch }),
          ownerSession
        );
        assert.equal(rejected.ok, false);
        assert.equal((await readSession()).status, 'waiting_user');
        assert.equal(modelRequests, 3);
        await spoof.close();
        await panelCommand('Runtime.evaluate', {
          expression: `chrome.runtime.sendMessage(${JSON.stringify({ type: 'skill.cancel', id: ownerSession.id, epoch: ownerSession.epoch })})`,
          awaitPromise: true,
          returnByValue: true,
        });
        const replayId = '60000000-0000-4000-8000-000000000006';
        await worker.evaluate(
          async ({ port, replayId }) => {
            const origin = 'http://127.0.0.1:' + port;
            const db = await new Promise((resolve) => {
              const r = indexedDB.open('octopus-skill-sessions', 4);
              r.onsuccess = () => resolve(r.result);
            });
            const value = {
              id: replayId,
              recordingId: '10000000-0000-4000-8000-000000000001',
              name: '侧边栏重放合成验收',
              mode: 'replay',
              revision: 0,
              epoch: crypto.randomUUID(),
              status: 'interrupted',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              modelCalls: 0,
              modelCallLimit: 100,
              toolCalls: 0,
              questions: 0,
              messages: [{ role: 'user', content: '打开并观察合成测试页。' }],
              ledger: {},
              answers: {},
              observationRequired: true,
              context: {
                settings: { provider: 'openai-compatible', baseUrl: origin + '/v1', model: 'synthetic' },
                skill: {
                  skillId: crypto.randomUUID(),
                  definitionHash: 'a'.repeat(64),
                  candidate: {
                    skillMarkdown: '---\nname: 测试\ndescription: 测试\n---\n观察页面',
                    workflow: {
                      schemaVersion: 1,
                      inputs: [],
                      allowedOrigins: [origin],
                      pages: [{ role: 'main', startUrl: origin + '/fixture' }],
                      execution: { maxModelCalls: 20 },
                      evidence: [],
                    },
                  },
                },
              },
            };
            await new Promise((resolve) => {
              const tx = db.transaction('sessions', 'readwrite');
              tx.objectStore('sessions').put(value);
              tx.oncomplete = resolve;
            });
            db.close();
          },
          { port: provider.address().port, replayId }
        );
        await popup.evaluate(async (replayId) => {
          const current = await chrome.windows.getCurrent();
          await chrome.runtime.sendMessage({
            type: 'skill.panel.open',
            windowId: current.id,
            route: {
              mode: 'replay',
              recordingId: '10000000-0000-4000-8000-000000000001',
              sessionId: replayId,
            },
          });
        }, replayId);
        await expect
          .poll(
            async () =>
              (
                await panelCommand('Runtime.evaluate', {
                  expression: 'document.body.innerText',
                  returnByValue: true,
                })
              ).result.value
          )
          .toContain('运行技能');
        await expect
          .poll(
            async () =>
              (
                await panelCommand('Runtime.evaluate', {
                  expression:
                    "Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='继续')",
                  returnByValue: true,
                })
              ).result.value
          )
          .toBe(true);
        const replayClick = await panelCommand('Runtime.evaluate', {
          expression: continueExpression,
          returnByValue: true,
        });
        assert.equal(replayClick.exceptionDetails, undefined);
        await expect
          .poll(async () => (await readSession(replayId)).status, { timeout: 15000 })
          .toBe('completed');
        assert.equal(modelRequests, 9);
        const replay = await readSession(replayId);
        assert.equal(replay.ledger['replay-snapshot'].state, 'completed');
        assert.equal(replay.ledger['replay-click'].state, 'completed');
        assert.equal(replay.ledger['replay-after-click'].state, 'completed');
        assert.equal(replay.responseRecoveryCalls ?? 0, 0);
        assert.equal(
          replay.responses.every((response) => response.classification === 'tools'),
          true
        );
        const business = await worker.evaluate(() => chrome.tabs.query({}));
        const businessTab = business.find((tab) => tab.url?.endsWith('/fixture'));
        assert.ok(businessTab);
        assert.equal(businessTab.windowId, windowId);
        assert.equal(businessTab.active, true);
        const businessPage = context.pages().find((page) => page.url().endsWith('/fixture'));
        assert.ok(businessPage);
        await expect(businessPage.locator('body')).toHaveAttribute('data-clicks', '1');
        const replayCapture = await panelCommand('Page.captureScreenshot');
        await writeFile(join(evidence, flavor + '-replay.png'), Buffer.from(replayCapture.data, 'base64'));

        await expect(popup.getByRole('button', { name: '整理历史', exact: true })).toHaveCount(0);
        await panelCommand('Runtime.evaluate', {
          expression: "document.querySelector('button[aria-label=会话历史]').click()",
        });
        await expect
          .poll(
            async () =>
              (
                await panelCommand('Runtime.evaluate', {
                  expression: 'document.body.innerText',
                  returnByValue: true,
                })
              ).result.value
          )
          .toContain('共 2 条');
        await panelCommand('Runtime.evaluate', {
          expression:
            "Array.from(document.querySelectorAll('[role=tab]')).find(b=>b.textContent.trim()==='重放').click()",
        });
        await expect
          .poll(
            async () =>
              (
                await panelCommand('Runtime.evaluate', {
                  expression: 'document.body.innerText',
                  returnByValue: true,
                })
              ).result.value
          )
          .toContain('共 1 条');
        await panelCommand('Runtime.evaluate', {
          expression:
            "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('侧边栏重放合成验收')).click()",
        });
        await expect
          .poll(
            async () =>
              (
                await panelCommand('Runtime.evaluate', {
                  expression: 'document.body.innerText',
                  returnByValue: true,
                })
              ).result.value
          )
          .toContain('已观察合成测试页面');
        assert.equal(modelRequests, 9);
        await panelCommand('Runtime.evaluate', {
          expression: "document.querySelector('button[aria-label=会话历史]').click()",
        });
        const listCapture = await panelCommand('Page.captureScreenshot');
        await writeFile(
          join(evidence, flavor + '-conversation-history.png'),
          Buffer.from(listCapture.data, 'base64')
        );
        await worker.evaluate((windowId) => chrome.sidePanel.close({ windowId }), windowId);
        await popup.bringToFront();
        await popup.locator('#open-panel').click({ force: true });
        await expect
          .poll(async () =>
            (await cdp.send('Target.getTargets')).targetInfos.some((t) =>
              t.url.includes('/window-panel.html?instance=')
            )
          )
          .toBe(true);
        target = (await cdp.send('Target.getTargets')).targetInfos.find((t) =>
          t.url.includes('/window-panel.html?instance=')
        );
        attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
        await expect
          .poll(
            async () =>
              (
                await panelCommand('Runtime.evaluate', {
                  expression: 'document.body.innerText',
                  returnByValue: true,
                })
              ).result.value
          )
          .toContain('会话历史');
        assert.equal(modelRequests, 9);
        const pagination = await popup.evaluate(async () => {
          const db = await new Promise((resolve) => {
            const r = indexedDB.open('octopus-skill-sessions', 4);
            r.onsuccess = () => resolve(r.result);
          });
          await new Promise((resolve) => {
            const tx = db.transaction('sessions', 'readwrite');
            for (let i = 0; i < 45; i++) {
              tx.objectStore('sessions').put({
                id: crypto.randomUUID(),
                recordingId: '70000000-0000-4000-8000-000000000007',
                mode: i % 2 ? 'organize' : 'replay',
                name: '分页合成会话' + i,
                status: 'completed',
                createdAt: 1000 + i,
                updatedAt: 2000 + i,
                revision: 0,
                epoch: crypto.randomUUID(),
                messages: [],
                ledger: {},
                modelCalls: 0,
                toolCalls: 0,
                questions: 0,
                answers: {},
                observationRequired: false,
              });
            }
            tx.oncomplete = resolve;
          });
          db.close();
          const read = async (command) => {
            const result = await chrome.runtime.sendMessage(command);
            if (!result.ok) {
              throw Error(result.error);
            }
            return result.value;
          };
          const first = await read({ type: 'skill.history' });
          const second = await read({ type: 'skill.history', cursor: first.cursor });
          const third = await read({ type: 'skill.history', cursor: second.cursor });
          const mixed = await chrome.runtime.sendMessage({
            type: 'skill.history',
            mode: 'replay',
            cursor: first.cursor,
          });
          const filtered = await read({ type: 'skill.history', mode: 'replay' });
          return {
            lengths: [first.items.length, second.items.length, third.items.length],
            total: first.total,
            unique: new Set([...first.items, ...second.items, ...third.items].map((item) => item.id)).size,
            mixed: mixed.error,
            filtered: filtered.items.every((item) => item.mode === 'replay'),
            first: first.items[0].id,
          };
        });
        assert.deepEqual(pagination.lengths, [20, 20, 7]);
        assert.equal(pagination.total, 47);
        assert.equal(pagination.unique, 47);
        assert.equal(pagination.mixed, 'SKILL_INVALID');
        assert.equal(pagination.filtered, true);
        assert.equal(pagination.first, replayId);
        for (const selected of [replayId, '20000000-0000-4000-8000-000000000002']) {
          await popup.evaluate(async (id) => {
            const current = await chrome.windows.getCurrent();
            await chrome.runtime.sendMessage({
              type: 'skill.panel.open',
              windowId: current.id,
              route: {
                mode: id.startsWith('600') ? 'replay' : 'organize',
                recordingId: '10000000-0000-4000-8000-000000000001',
                sessionId: id,
              },
            });
          }, selected);
          await expect
            .poll(
              async () =>
                (
                  await panelCommand('Runtime.evaluate', {
                    expression:
                      !!selected + " && Boolean(document.querySelector('button[aria-label=删除会话]'))",
                    returnByValue: true,
                  })
                ).result.value
            )
            .toBe(true);
          const control = await panelCommand('Runtime.evaluate', {
            expression:
              "(()=>{const button=document.querySelector('button[aria-label=删除会话]');return {size:getComputedStyle(button).width,variant:button.classList.contains('text-destructive'),previous:button.previousElementSibling?.dataset.slot};})()",
            returnByValue: true,
          });
          assert.deepEqual(control.result.value, {
            size: '28px',
            variant: true,
            previous: 'badge',
          });
          await panelCommand('Runtime.evaluate', {
            expression: "document.querySelector('button[aria-label=删除会话]').click()",
          });
          await expect
            .poll(
              async () =>
                (
                  await panelCommand('Runtime.evaluate', {
                    expression: 'document.body.innerText',
                    returnByValue: true,
                  })
                ).result.value
            )
            .toContain('确认删除');
          await panelCommand('Runtime.evaluate', {
            expression:
              "Array.from(document.querySelectorAll('[role=dialog] button')).find(b=>b.textContent==='取消').click()",
          });
          assert.ok(await readSession(selected));
          await panelCommand('Runtime.evaluate', {
            expression: "document.querySelector('button[aria-label=删除会话]').click()",
          });
          await panelCommand('Runtime.evaluate', {
            expression:
              "Array.from(document.querySelectorAll('[role=dialog] button')).find(b=>b.textContent==='确认删除').click()",
          });
          await expect.poll(async () => Boolean(await readSession(selected))).toBe(false);
          await expect
            .poll(
              async () =>
                (
                  await panelCommand('Runtime.evaluate', {
                    expression: 'document.body.innerText',
                    returnByValue: true,
                  })
                ).result.value
            )
            .toContain('会话历史');
        }
        assert.equal(modelRequests, 9);

        await writeFile(
          join(evidence, flavor + '-result.json'),
          JSON.stringify(
            {
              browser: context.browser().version(),
              provider: 'isolated localhost',
              modelRequests,
              organizer: 'close/reopen preserved answer',
              replay:
                'native SDK read Skill, real Controller click exactly once, fresh observation and finish',
              windowIsolation: true,
              normalTabRejected: true,
            },
            null,
            2
          )
        );
      } finally {
        await context?.close();
        provider.closeAllConnections();
        await new Promise((resolve) => provider.close(resolve));
        await rm(temporary, { recursive: true, force: true });
      }
    }
  );
}
