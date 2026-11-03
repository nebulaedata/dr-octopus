/**
 * @author Codex
 * @description Verifies one shared ScrollArea viewport, connected timeline nodes and anchored questions in real browsers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
const root = fileURLToPath(new URL('../../', import.meta.url));
const bundle = await build({
  stdin: {
    resolveDir: root,
    loader: 'jsx',
    contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import {AgentConversation} from './src/features/agent-session/AgentConversation';
import {PopupPage} from './src/components/PopupPage';
const messages=Array.from({length:18},(_,i)=>({role:'assistant',content:[{type:'tool-call',toolName:'read_recording',toolCallId:'read-'+i,input:{offset:i,limit:20}}]}));
const question={question:'这次查询哪个订单？',fields:[{id:'orderNo',label:'订单编号',type:'text',required:true,maxLength:100}],allowDefer:false};
messages.push({role:'assistant',content:[{type:'tool-call',toolName:'ask_user_question',toolCallId:'ask',input:question}]});
const session={id:'timeline',status:'waiting_user',messages,pendingQuestion:{toolCallId:'ask',question}};
const root=createRoot(document.getElementById('root'));window.renderSession=(session)=>root.render(<main style={{height:'100dvh',display:'flex',flexDirection:'column'}}><header style={{padding:16}}>Dr.Octopus</header><PopupPage scrollLabel="正文" header={<h2>整理技能</h2>} footer={<button type="submit" form="skill-answer-form">确认并继续</button>} scrollViewport={<AgentConversation session={session} busy={false} answer={async()=>{window.answered=true;}}/>}/></main>);window.renderSession(session);
`,
  },
  bundle: true,
  write: false,
  jsx: 'automatic',
  platform: 'browser',
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
});
for (const flavor of ['chrome', 'edge']) {
  test(
    `${flavor}: connected timeline uses one themed ScrollArea and keeps footer fixed`,
    { timeout: 45000 },
    async () => {
      const assets = join(root, '.output', flavor + '-mv3', 'assets');
      const cssFiles = (await readdir(assets))
        .filter((name) => /^(?:popup|style|window-panel)-.*\.css$/.test(name))
        .sort();
      const css = (await Promise.all(cssFiles.map((name) => readFile(join(assets, name), 'utf8')))).join(
        '\n'
      );
      const server = createServer((_req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<!doctype html><title>Timeline test</title><div id="root"></div>');
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      let browser;
      try {
        browser = await chromium.launch({
          headless: true,
          executablePath:
            flavor === 'chrome'
              ? join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe')
              : join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
        });
        const page = await browser.newPage({
          viewport: { width: 360, height: 460 },
          colorScheme: 'dark',
          reducedMotion: 'reduce',
        });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto('http://127.0.0.1:' + server.address().port);
        await page.addStyleTag({ content: css });
        await page.evaluate(() => {
          document.documentElement.dataset.colorTheme = 'shadcn';
          document.documentElement.classList.add('dark');
        });
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        const viewport = page.getByLabel('智能体会话', { exact: true });
        await expect(viewport).toHaveCount(1);
        await expect(
          page.locator('[data-slot="scroll-area"] > [data-slot="scroll-area-scrollbar"]')
        ).toBeVisible();
        await expect(page.getByRole('textbox', { name: '订单编号', exact: true })).toBeInViewport();
        const footer = page.getByRole('button', { name: '确认并继续', exact: true });
        const before = await footer.boundingBox();
        const lines = await page.locator('[data-slot="skill-timeline-entry"]').evaluateAll((nodes) =>
          nodes.map((node) => ({
            width: getComputedStyle(node, '::before').width,
            color: getComputedStyle(node, '::before').backgroundColor,
          }))
        );
        assert.equal(lines.length, 19);
        const dots = await page
          .locator('[data-slot=avatar]')
          .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width));
        assert.ok(dots.every((width) => width === 20));
        assert.ok(lines.every((line) => line.width === '1px' && line.color !== 'rgba(0, 0, 0, 0)'));
        await page.getByRole('textbox', { name: '订单编号', exact: true }).fill('000123');
        await footer.click();
        await expect.poll(() => page.evaluate(() => window.answered)).toBe(true);
        await viewport.evaluate((node) => {
          node.scrollTop = 0;
        });
        await expect(page.getByRole('button', { name: '回到最新', exact: true })).toBeVisible();
        assert.equal((await footer.boundingBox()).y, before.y);
        await page.getByRole('button', { name: '回到最新', exact: true }).click();
        await expect(page.getByRole('textbox', { name: '订单编号', exact: true })).toBeInViewport();
        const evidence = join(root, 'build/validation-evidence/skill-timeline');
        await mkdir(evidence, { recursive: true });
        await page.screenshot({ path: join(evidence, flavor + '-dark-short.png') });
        await page.emulateMedia({ colorScheme: 'light' });
        await page.evaluate(() => document.documentElement.classList.remove('dark'));
        await page.setViewportSize({ width: 360, height: 600 });
        await viewport.evaluate((node) => {
          node.scrollTop = 0;
        });
        const firstEntry = page.locator('[data-slot="skill-timeline-entry"]').first();
        const summary = firstEntry.locator('summary').first();
        await summary.focus();
        await page.keyboard.press('Enter');
        await expect(firstEntry.locator('details')).toHaveAttribute('open', '');
        await expect(firstEntry.locator('[data-slot="card"] pre')).toContainText('"offset": 0');
        const alignment = await firstEntry.evaluate((node) => {
          const dot = node.querySelector('[data-slot="avatar"]').getBoundingClientRect();
          const title = node.querySelector('summary').getBoundingClientRect();
          const icon = node.querySelector('summary svg').getBoundingClientRect();
          return {
            dot: dot.y + dot.height / 2,
            title: title.y + 10,
            icon: icon.y + icon.height / 2,
            overflow: node.scrollWidth > node.clientWidth,
          };
        });
        assert.ok(Math.abs(alignment.dot - alignment.title) <= 1, JSON.stringify(alignment));
        assert.ok(Math.abs(alignment.dot - alignment.icon) <= 1, JSON.stringify(alignment));
        assert.equal(alignment.overflow, false);
        await page.screenshot({ path: join(evidence, flavor + '-light-timeline.png') });
        await page.evaluate(() => document.documentElement.classList.add('dark'));
        await page.setViewportSize({ width: 360, height: 460 });
        await page.screenshot({ path: join(evidence, flavor + '-dark-expanded.png') });
        await summary.focus();
        await page.keyboard.press('Space');
        await expect(firstEntry.locator('details')).not.toHaveAttribute('open', '');
        await page.evaluate(() =>
          window.renderSession({
            id: 'execution',
            mode: 'organize',
            status: 'running',
            messages: [
              {
                role: 'tool',
                content: [
                  {
                    type: 'tool-result',
                    toolName: 'read_recording',
                    toolCallId: 'done',
                    output: { type: 'json', value: { done: true } },
                  },
                ],
              },
            ],
            ledger: { done: { state: 'completed' } },
          })
        );
        const marker = page.locator('[data-slot="skill-execution-marker"]');
        await expect(marker).toHaveCount(1);
        await expect(marker).toHaveText('正在整理…');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await expect
          .poll(() =>
            marker
              .locator('[data-slot="marker-content"]')
              .evaluate((node) => getComputedStyle(node).animationName)
          )
          .toContain('shimmer');
        await page.screenshot({ path: join(evidence, flavor + '-shimmer.png') });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        assert.equal(
          await marker
            .locator('[data-slot="marker-content"]')
            .evaluate((node) => getComputedStyle(node).animationName),
          'none'
        );
        assert.notEqual(
          await marker
            .locator('[data-slot="marker-content"]')
            .evaluate((node) => getComputedStyle(node).webkitTextFillColor),
          'rgba(0, 0, 0, 0)'
        );
        await page.evaluate(() =>
          window.renderSession({
            id: 'execution',
            status: 'running',
            messages: [
              {
                role: 'assistant',
                content: [
                  { type: 'tool-call', toolName: 'read_recording', toolCallId: 'current', input: {} },
                ],
              },
            ],
            ledger: { current: { state: 'dispatched' } },
          })
        );
        await expect(marker).toHaveCount(1);
        await expect(marker).toHaveText('读取录制');
        await expect(page.locator('[data-slot="skill-timeline-entry"]')).toHaveCount(1);
        for (const status of [
          'completed',
          'failed',
          'waiting_user',
          'interrupted',
          'cancelled',
          'outcome_unknown',
        ]) {
          await page.evaluate(
            (status) => window.renderSession({ id: 'execution', status, messages: [], ledger: {} }),
            status
          );
          await expect(marker).toHaveCount(0);
        }
        await page.evaluate(() =>
          window.renderSession({
            id: 'execution',
            status: 'saving',
            error: 'SKILL_STORAGE',
            messages: [],
            ledger: {},
          })
        );
        await expect(marker).toHaveCount(0);
        await page.evaluate(() => {
          window.renderWait = (attempt, status = 'running', attempts = 3) =>
            window.renderSession({
              id: 'wait-fixture',
              mode: 'replay',
              status,
              error: status === 'failed' ? 'PAGE_READY_TIMEOUT' : undefined,
              messages: [
                {
                  role: 'assistant',
                  content: [
                    {
                      type: 'tool-call',
                      toolName: 'browser_open_tab',
                      toolCallId: 'wait',
                      input: { url: 'https://fixture.test' },
                    },
                  ],
                },
              ],
              ledger: {
                wait: {
                  state: 'dispatched',
                  waitProgress: { seconds: 15, attempts, attempt, tabId: 7, startedAt: 1 },
                },
              },
            });
          window.renderWait(1);
        });
        const waiting = page.locator('[data-slot="page-wait-progress"]');
        await expect(waiting).toHaveText('等待页面就绪… 1/3');
        await expect(marker).toHaveCount(1);
        await page.evaluate(() => window.renderWait(3, 'running', 5));
        await expect(waiting).toHaveText('页面尚未就绪，重试中… 3/5');
        await page.evaluate(() => window.renderWait(2));
        await expect(waiting).toHaveText('页面尚未就绪，重试中… 2/3');
        await page.setViewportSize({ width: 360, height: 460 });
        await page.evaluate(() => document.documentElement.classList.add('dark'));
        await page.screenshot({ path: join(evidence, flavor + '-wait-retry-dark.png') });
        await page.evaluate(() => document.documentElement.classList.remove('dark'));
        await page.screenshot({ path: join(evidence, flavor + '-wait-retry-light.png') });
        await page.evaluate(() => {
          document.documentElement.style.zoom = '2';
        });
        await expect(waiting).toBeVisible();
        await page.screenshot({ path: join(evidence, flavor + '-wait-retry-zoom.png') });
        const zoomSize = await waiting.evaluate((node) => ({
          rootScroll: document.documentElement.scrollWidth,
          rootClient: document.documentElement.clientWidth,
          inner: innerWidth,
          left: node.getBoundingClientRect().left,
          right: node.getBoundingClientRect().right,
          scroll: node.scrollWidth,
          client: node.clientWidth,
        }));
        assert.ok(zoomSize.rootScroll <= zoomSize.inner + 1, JSON.stringify(zoomSize));
        await page.evaluate(() => {
          document.documentElement.style.zoom = '';
        });
        for (const status of ['completed', 'cancelled', 'failed']) {
          await page.evaluate((status) => window.renderWait(3, status), status);
          await expect(waiting).toHaveCount(0);
        }
        await page.evaluate(() => {
          window.renderSession({
            id: 'no-arguments',
            mode: 'replay',
            status: 'completed',
            messages: [
              {
                role: 'assistant',
                content: [
                  { type: 'tool-call', toolName: 'read_skill', toolCallId: 'read', input: {} },
                  { type: 'tool-call', toolName: 'browser_tabs', toolCallId: 'tabs', input: {} },
                ],
              },
            ],
            ledger: {},
          });
        });
        await page.getByText('读取技能', { exact: true }).click();
        await expect(page.getByText('读取当前会话绑定的技能，无需额外参数。', { exact: true })).toBeVisible();
        await page.getByText('查看标签页', { exact: true }).click();
        await expect(
          page.getByText('列出本次任务允许访问的标签页，无需额外参数。', { exact: true })
        ).toBeVisible();
        await page.evaluate(() => {
          Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
              writeText: async (text) => {
                if (window.rejectCopy) {
                  throw Error('Denied');
                }
                window.copiedDiagnostic = text;
                window.copyCount = (window.copyCount ?? 0) + 1;
              },
            },
          });
          window.renderSession({
            id: '10000000-0000-4000-8000-000000000001',
            recordingId: '20000000-0000-4000-8000-000000000002',
            epoch: '30000000-0000-4000-8000-000000000003',
            revision: 12,
            mode: 'replay',
            status: 'failed',
            error: 'SKILL_NO_TOOL',
            modelCalls: 5,
            name: 'PRIVATE_RECORDING',
            context: { settings: { apiKey: 'SECRET_KEY', baseUrl: 'https://private.example' } },
            messages: [],
            ledger: { private: { input: 'PRIVATE_INPUT' } },
          });
        });
        const copy = page.getByRole('button', { name: '复制诊断', exact: true });
        await expect(copy).toHaveCount(1);
        await expect(copy).toBeInViewport();
        await page.screenshot({ path: join(evidence, flavor + '-error-copy.png') });
        await page.evaluate(() => (window.rejectCopy = true));
        await copy.click();
        await expect(page.getByText('复制失败，请重试。', { exact: true })).toBeVisible();
        await expect(copy).toHaveText('复制诊断');
        await page.evaluate(() => (window.rejectCopy = false));
        await copy.click();
        await expect(page.getByText('诊断信息已复制。', { exact: true })).toBeVisible();
        await expect(copy).toHaveText('复制诊断', { timeout: 4000 });
        await copy.click();
        await expect(copy).toHaveText('已复制');
        assert.equal(await page.evaluate(() => window.copyCount), 2);
        const diagnostic = await page.evaluate(() => JSON.parse(window.copiedDiagnostic));
        assert.equal(diagnostic.sessionId, '10000000-0000-4000-8000-000000000001');
        assert.equal(diagnostic.mode, 'replay');
        assert.equal(diagnostic.revision, 12);
        assert.equal(diagnostic.error.code, 'SKILL_NO_TOOL');
        assert.equal(diagnostic.error.message, '模型未返回可执行的工具请求。');
        assert.equal(
          /SECRET_KEY|private.example|PRIVATE_INPUT|PRIVATE_RECORDING/.test(JSON.stringify(diagnostic)),
          false
        );
        await page.evaluate(() =>
          window.renderSession({
            id: 'second',
            mode: 'organize',
            status: 'failed',
            messages: [
              {
                role: 'tool',
                content: [
                  {
                    type: 'tool-result',
                    toolName: 'browser_click',
                    toolCallId: 'call-one',
                    output: { type: 'json', value: { error: 'TARGET_CHANGED', raw: 'PRIVATE_RESULT' } },
                  },
                  {
                    type: 'tool-result',
                    toolName: 'validate_skill',
                    toolCallId: 'call-two',
                    output: {
                      type: 'json',
                      value: {
                        valid: false,
                        issues: [
                          {
                            code: 'SKILL_SCHEMA_CUSTOM',
                            path: ['workflow', 'inputs', 0, 'PRIVATE_FIELD'],
                            message: 'PRIVATE_VALIDATION_VALUE',
                          },
                        ],
                      },
                    },
                  },
                ],
              },
            ],
            ledger: {},
          })
        );
        await expect(copy).toHaveCount(2);
        await copy.first().click();
        const toolDiagnostic = await page.evaluate(() => JSON.parse(window.copiedDiagnostic));
        assert.equal(toolDiagnostic.sessionId, 'second');
        assert.equal(toolDiagnostic.error.source, 'tool');
        assert.equal(toolDiagnostic.error.toolCallId, 'call-one');
        assert.equal(toolDiagnostic.error.messageIndex, 0);
        assert.equal(toolDiagnostic.error.partIndex, 0);
        assert.equal(JSON.stringify(toolDiagnostic).includes('PRIVATE_RESULT'), false);
        await copy.nth(1).click();
        const validation = await page.evaluate(() => JSON.parse(window.copiedDiagnostic));
        assert.equal(validation.error.source, 'validation');
        assert.equal(validation.error.toolCallId, 'call-two');
        assert.deepEqual(validation.error.issues[0].path, ['workflow', 'inputs', 0, '[field]']);
        assert.equal(JSON.stringify(validation).includes('PRIVATE_'), false);
        await page.evaluate(() => {
          const question = {
            question: '请填写本次查询编号',
            fields: [{ id: 'order', label: '编号', type: 'text', required: true, maxLength: 30 }],
            allowDefer: false,
          };
          window.correctedSession = {
            id: 'corrected',
            mode: 'organize',
            status: 'waiting_user',
            pendingQuestion: { toolCallId: 'new-question', question },
            messages: [
              {
                role: 'assistant',
                content: [
                  { type: 'tool-call', toolName: 'ask_user_question', toolCallId: 'old-question', input: {} },
                ],
              },
              {
                role: 'tool',
                content: [
                  {
                    type: 'tool-result',
                    toolName: 'ask_user_question',
                    toolCallId: 'old-question',
                    output: {
                      type: 'error-text',
                      value: 'Invalid input for tool ask_user_question: PRIVATE_SDK_VALUE',
                    },
                  },
                ],
              },
              {
                role: 'assistant',
                content: [
                  {
                    type: 'tool-call',
                    toolName: 'ask_user_question',
                    toolCallId: 'new-question',
                    input: question,
                  },
                ],
              },
            ],
            ledger: {
              'old-question': {
                toolName: 'ask_user_question',
                invalid: true,
                state: 'completed',
                inputIssues: [{ code: 'INVALID_TYPE', path: ['fields', 0, 'required'] }],
                result: { output: { type: 'error-text', value: 'SKILL_TOOL_INPUT_INVALID' } },
              },
              'new-question': { toolName: 'ask_user_question', invalid: false, state: 'pending' },
            },
          };
          window.renderSession(window.correctedSession);
        });
        await expect(page.getByText('询问用户 · 参数已纠正', { exact: true })).toBeVisible();
        await expect(page.getByRole('alert')).toHaveCount(0);
        await expect(page.getByText('请填写本次查询编号', { exact: true })).toBeVisible();
        await page.getByText('询问用户 · 参数已纠正', { exact: true }).click();
        await copy.click();
        const corrected = await page.evaluate(() => JSON.parse(window.copiedDiagnostic));
        assert.equal(corrected.error.code, 'SKILL_TOOL_INPUT_INVALID');
        assert.equal(corrected.error.recovered, true);
        assert.deepEqual(corrected.error.issues[0].path, ['fields', 0, 'required']);
        assert.equal(JSON.stringify(corrected).includes('PRIVATE'), false);
        assert.equal(
          await page
            .locator('body')
            .innerText()
            .then((text) => text.includes('PRIVATE_SDK_VALUE')),
          false
        );
        await viewport.evaluate((viewport) => {
          viewport.scrollTop = 0;
        });
        await expect(page.getByText('询问用户 · 参数已纠正', { exact: true })).toBeInViewport();
        await page.screenshot({ path: join(evidence, flavor + '-question-corrected.png') });
        await page.evaluate(() => {
          const session = structuredClone(window.correctedSession);
          delete session.pendingQuestion;
          session.status = 'failed';
          session.ledger['new-question'] = {
            toolName: 'ask_user_question',
            invalid: true,
            state: 'completed',
            result: { output: { type: 'error-text', value: 'SKILL_TOOL_INPUT_INVALID' } },
          };
          window.renderSession(session);
        });
        await expect(page.getByText('询问用户 · 参数已纠正', { exact: true })).toHaveCount(0);
        await expect(page.getByRole('alert')).toHaveCount(1);
        await page.evaluate(() =>
          window.renderSession({
            id: 'bounded-payload',
            mode: 'replay',
            status: 'completed',
            ledger: {},
            messages: [
              {
                role: 'tool',
                content: [
                  {
                    type: 'tool-result',
                    toolName: 'browser_snapshot',
                    toolCallId: 'long',
                    output: {
                      type: 'json',
                      value: {
                        text: Array.from(
                          { length: 150 },
                          (_, index) => `合成内容 ${index}：${'页面示例'.repeat(12)}`
                        ).join('\n'),
                      },
                    },
                  },
                ],
              },
              {
                role: 'tool',
                content: [
                  {
                    type: 'tool-result',
                    toolName: 'browser_tabs',
                    toolCallId: 'short',
                    output: { type: 'json', value: { tabs: [] } },
                  },
                ],
              },
              ...Array.from({ length: 10 }, () => ({ role: 'assistant', content: '后续会话内容。' })),
            ],
          })
        );
        await page.getByText('观察页面 · 已返回', { exact: true }).click();
        const payload = page
          .locator('[data-slot="tool-payload-scroll"] [data-slot="scroll-area-viewport"]')
          .first();
        for (const size of [
          { width: 360, height: 460 },
          { width: 420, height: 900 },
        ]) {
          await page.setViewportSize(size);
          await payload.scrollIntoViewIfNeeded();
          const geometry = await payload.evaluate((node) => ({
            height: node.getBoundingClientRect().height,
            client: node.clientHeight,
            scroll: node.scrollHeight,
            width: node.clientWidth,
            scrollWidth: node.scrollWidth,
          }));
          assert.ok(geometry.height <= Math.min(320, size.height * 0.4) + 1, JSON.stringify(geometry));
          assert.ok(geometry.scroll > geometry.client);
          assert.ok(geometry.scrollWidth <= geometry.width + 1);
          await page.evaluate(
            (dark) => document.documentElement.classList.toggle('dark', dark),
            size.height === 460
          );
          await page.screenshot({
            path: join(evidence, flavor + '-bounded-payload-' + size.height + '.png'),
          });
        }
        await page.setViewportSize({ width: 360, height: 460 });
        await payload.scrollIntoViewIfNeeded();
        await payload.hover();
        const timelineTop = await viewport.evaluate((node) => node.scrollTop);
        await page.mouse.wheel(0, 150);
        await expect.poll(() => payload.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
        assert.equal(await viewport.evaluate((node) => node.scrollTop), timelineTop);
        await payload.evaluate((node) => {
          node.scrollTop = 0;
        });
        await payload.focus();
        await page.keyboard.press('PageDown');
        await expect.poll(() => payload.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
        await payload.evaluate((node) => {
          node.scrollTop = node.scrollHeight;
        });
        const beforeChain = await viewport.evaluate((node) => node.scrollTop);
        await payload.hover();
        await page.mouse.wheel(0, 250);
        await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBeGreaterThan(beforeChain);
        await page.getByText('查看标签页 · 已返回', { exact: true }).click();
        const smallPayload = page
          .locator('[data-slot="tool-payload-scroll"] [data-slot="scroll-area-viewport"]')
          .nth(1);
        const small = await smallPayload.evaluate((node) => ({
          height: node.clientHeight,
          scroll: node.scrollHeight,
        }));
        assert.ok(small.height < 100, JSON.stringify(small));
        assert.equal(small.height, small.scroll);
        assert.deepEqual(errors, []);
      } finally {
        await browser?.close();
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    }
  );
}
