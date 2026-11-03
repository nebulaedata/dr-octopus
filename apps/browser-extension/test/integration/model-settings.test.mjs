/**
 * @author Codex
 * @description Isolates model-settings UI acceptance from the longer recording/editor lifecycle regression.
 */
import { verifyPopupContentBounds, verifyFieldFocusSpace } from './popup-layout.mjs';
import test from 'node:test';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { verifyKeyVisibility, verifyModelSettingsFeedback } from './model-settings-feedback.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
// Exercise settings/probe lifecycle independently; native panel authority and multi-window sync have their own acceptance test.
const fixtureBundle = await build({
  stdin: {
    resolveDir: root,
    loader: 'jsx',
    contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {GlobalModelSettings} from './src/features/model-settings/GlobalModelSettings';function Fixture(){const [open,setOpen]=useState(false);const [visited,setVisited]=useState(false);return <main className="fixed inset-0 flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground"><header className="shrink-0 p-4"><button onClick={()=>{setVisited(true);setOpen(true);}}>模型设置</button></header>{visited&&<div className={open?'flex min-h-0 flex-1 flex-col overflow-hidden':'hidden'}><GlobalModelSettings visible={open} back={()=>setOpen(false)}/></div>}</main>;}document.documentElement.dataset.colorTheme='shadcn';document.documentElement.classList.toggle('dark',matchMedia('(prefers-color-scheme: dark)').matches);createRoot(document.getElementById('root')).render(<Fixture/>);`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'extension-browser',
      setup(builder) {
        builder.onResolve({ filter: /^wxt\/browser$/ }, () => ({ path: 'browser', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: 'export const browser=chrome;',
        }));
      },
    },
  ],
});

for (const flavor of ['chrome', 'edge']) {
  test(
    `${flavor}: model settings preserve credentials and keep connection feedback in place`,
    { timeout: 120000 },
    async () => {
      const temporary = await mkdtemp(join(tmpdir(), 'octopus-model-settings-'));
      const evidenceDir = join(temporary, 'evidence');
      await mkdir(evidenceDir);
      const requests = [];
      const discovery = { calls: [] };
      let mode = 'success';
      const server = createServer(async (request, response) => {
        response.setHeader('Content-Type', 'application/json');
        if (request.url.endsWith('/models')) {
          discovery.calls.push({ authorization: request.headers.authorization });
          response.end(
            JSON.stringify({ data: ['qwen3.5-flash', 'qwen3.5-plus', 'other-model'].map((id) => ({ id })) })
          );
          return;
        }
        let raw = '';
        for await (const chunk of request) {
          raw += chunk;
        }
        const input = JSON.parse(raw);
        const capture = { input, authorization: request.headers.authorization, closed: false };
        requests.push(capture);
        response.on('close', () => {
          capture.closed = true;
        });
        if (mode === 'hold') {
          return;
        }
        if (mode === 'error') {
          response.writeHead(401);
          response.end(JSON.stringify({ error: { message: 'Synthetic provider error' } }));
          return;
        }
        response.end(
          JSON.stringify({
            id: 'synthetic-probe',
            model: input.model,
            choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'OK' } }],
            usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
          })
        );
      });
      await new Promise((accept) => server.listen(0, '127.0.0.1', accept));
      let context;
      const pageErrors = [];
      const consoleErrors = [];
      try {
        const extension = join(temporary, 'extension');
        await cp(join(root, '.output', flavor + '-mv3'), extension, { recursive: true });
        const originalHtml = await readFile(join(extension, 'window-panel.html'), 'utf8');
        const styles = [...originalHtml.matchAll(/<link[^>]*rel="stylesheet"[^>]*>/g)]
          .map((match) => match[0])
          .join('');
        await writeFile(join(extension, 'settings-fixture.js'), fixtureBundle.outputFiles[0].text);
        await writeFile(
          join(extension, 'window-panel.html'),
          '<!doctype html><html data-color-theme="shadcn"><head>' +
            styles +
            '</head><body><div id="root"></div><script src="settings-fixture.js"></script></body></html>'
        );

        const background = join(extension, 'background.js');
        await writeFile(
          background,
          (await readFile(background, 'utf8')).replace(
            'com.octopus.executor.browser',
            'com.octopus.test.model_settings_unregistered'
          )
        );
        const executablePath =
          flavor === 'chrome'
            ? join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe')
            : join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe');
        const launchOptions = {
          executablePath,
          headless: false,
          ignoreDefaultArgs: ['--disable-extensions'],
          args: ['--enable-unsafe-extension-debugging', '--window-position=-2000,-2000', '--no-first-run'],
        };
        context = await chromium.launchPersistentContext(join(temporary, 'profile'), launchOptions);
        const observePage = (page) => {
          page.on('pageerror', (error) => pageErrors.push(error.message));
          page.on('console', (message) => {
            if (message.type() === 'error' && !/401|ERR_ABORTED/.test(message.text())) {
              consoleErrors.push(message.text());
            }
          });
        };
        context.on('page', observePage);
        const cdp = await context.browser().newBrowserCDPSession();
        const { id } = await cdp.send('Extensions.loadUnpacked', { path: extension });
        const siteUrl = `http://127.0.0.1:${server.address().port}`;
        let popup = await context.newPage();
        await popup.setViewportSize({ width: 360, height: 600 });
        await popup.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
        await popup.goto(
          `chrome-extension://${id}/window-panel.html?instance=10000000-0000-4000-8000-000000000001`
        );
        await popup.getByRole('button', { name: '模型设置', exact: true }).click();
        await popup.getByLabel('接口地址', { exact: true }).fill(siteUrl + '/v1');
        await popup.getByLabel('API Key', { exact: true }).fill('synthetic-key-only');
        await popup.getByLabel('模型', { exact: true }).fill('qwen3.5-flash');
        await popup.getByLabel('模型', { exact: true }).press('Escape');
        await verifyPopupContentBounds(popup, '模型设置内容');
        await verifyFieldFocusSpace(popup, '模型设置内容', popup.getByLabel('提供商', { exact: true }));
        await popup.screenshot({
          path: join(evidenceDir, 'model-settings-focus-outline.png'),
          animations: 'disabled',
        });
        await verifyKeyVisibility(popup, siteUrl, evidenceDir, requests);
        await expect(popup.getByRole('button', { name: '保存执行限制', exact: true })).toHaveCount(0);
        await popup.getByLabel(/^整理最大轮数/).fill('75');
        await popup.getByLabel(/^重放最大轮数/).fill('150');
        await popup.getByRole('button', { name: '保存配置', exact: true }).click();
        await expect(popup.getByRole('group', { name: 'API Key 已保存' })).toBeVisible();
        await expect(popup.getByLabel(/^整理最大轮数/)).toHaveValue('75');
        await expect(popup.getByLabel(/^重放最大轮数/)).toHaveValue('150');
        await popup.getByRole('button', { name: '关闭提示' }).click();
        popup = await verifyModelSettingsFeedback(popup, context, siteUrl, evidenceDir, {
          requests,
          discovery,
          setMode: (value) => {
            mode = value;
          },
        });
        await popup.getByLabel('API Key', { exact: true }).fill('synthetic-restart-key');
        await popup.getByRole('button', { name: '保存配置', exact: true }).click();
        await expect(popup.getByRole('group', { name: 'API Key 已保存' })).toBeVisible();
        await context.close();
        context = await chromium.launchPersistentContext(join(temporary, 'profile'), launchOptions);
        context.on('page', observePage);
        const restartedCdp = await context.browser().newBrowserCDPSession();
        const restarted = await restartedCdp.send('Extensions.loadUnpacked', { path: extension });
        assert.equal(restarted.id, id);
        popup = await context.newPage();
        await popup.setViewportSize({ width: 360, height: 420 });
        await popup.goto(
          `chrome-extension://${id}/window-panel.html?instance=10000000-0000-4000-8000-000000000001`
        );
        await popup.getByRole('button', { name: '模型设置', exact: true }).click();
        await expect(popup.getByRole('group', { name: 'API Key 已保存' })).toBeVisible();
        await expect(popup.getByLabel(/^整理最大轮数/)).toHaveValue('75');
        await expect(popup.getByLabel(/^重放最大轮数/)).toHaveValue('150');
        mode = 'success';
        await popup.getByRole('button', { name: '测试连接', exact: true }).click();
        await expect(popup.getByRole('status').filter({ hasText: '连接成功' })).toBeVisible();
        assert.equal(requests.at(-1).authorization, 'Bearer synthetic-restart-key');
        await popup.screenshot({
          path: join(evidenceDir, 'model-test-restarted-short.png'),
          animations: 'disabled',
        });
        await popup.getByRole('button', { name: '清除', exact: true }).click();
        await expect(popup.getByRole('status').filter({ hasText: '密钥已清除' })).toBeVisible();
        assert.deepEqual(pageErrors, []);
        assert.deepEqual(consoleErrors, []);
        await writeFile(
          join(evidenceDir, 'result.json'),
          JSON.stringify({
            flavor,
            requests: requests.length,
            stayedInSettings: true,
            topToast: true,
            explicitCredentialSaveAndClear: true,
            cancelledOnClose: true,
            browserRestartCredentialReuse: true,
            pageErrors,
            consoleErrors,
          })
        );
        console.info('Model settings evidence:', evidenceDir);
      } finally {
        await context?.close();
        server.closeAllConnections();
        await new Promise((accept) => server.close(accept));
        for (const name of ['profile', 'extension']) {
          const path = resolve(temporary, name);
          assert.ok(path.startsWith(resolve(temporary) + '\\'));
          await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        }
      }
    }
  );
}
