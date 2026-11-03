/**
 * @author Codex
 * @description Verifies user-visible execution limit editing, validation and persistence without provider calls.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
const root = fileURLToPath(new URL('../../', import.meta.url));
const bundle = await build({
  stdin: {
    resolveDir: root,
    loader: 'jsx',
    contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {ModelSettings} from './src/features/model-settings/ModelSettings';
createRoot(document.getElementById('root')).render(<main className="fixed inset-0 flex min-h-0 flex-col bg-background text-foreground"><ModelSettings settings={null} busy={false} back={()=>{}}/></main>);
`,
  },
  bundle: true,
  write: false,
  jsx: 'automatic',
  platform: 'browser',
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'settings-peer',
      setup(builder) {
        builder.onResolve({ filter: /model-settings-client$/ }, () => ({
          path: 'settings',
          namespace: 'peer',
        }));
        builder.onResolve({ filter: /^wxt\/browser$/ }, () => ({ path: 'browser', namespace: 'peer' }));
        builder.onLoad({ filter: /.*/, namespace: 'peer' }, (args) => ({
          contents:
            args.path === 'browser'
              ? `const listeners=new Set();window.syncLimits=()=>{for(const fn of listeners)fn({workflowSettingsRevision:{}},'local');};export const browser={storage:{onChanged:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)}}};`
              : `const initial={settings:{provider:'openai-compatible',baseUrl:'https://example.test/v1',model:'synthetic'},limits:{organize:50,replay:100},revision:'initial',canSend:false,hasKey:true};export async function modelSettingsRequest(request){const snapshot=JSON.parse(localStorage.getItem('configuration')??JSON.stringify(initial));if(request.type==='settings-snapshot')return snapshot;if(request.type==='credential-status')return {hasKey:true,canSend:false};if(request.type==='settings-save'){if(window.failSave)throw Error('WORKFLOW_STORAGE');if(request.expectedRevision!==snapshot.revision)throw Error('SETTINGS_CONFLICT');localStorage.setItem('configuration',JSON.stringify({...snapshot,settings:request.settings,limits:request.limits,revision:crypto.randomUUID(),canSend:request.consent}));return true;}throw Error('Unexpected provider request');}`,
        }));
      },
    },
  ],
});
for (const flavor of ['chrome', 'edge']) {
  test(`${flavor}: one save commits model settings and execution limits`, { timeout: 30000 }, async () => {
    const server = createServer((_req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<!doctype html><div id="root"></div>');
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
      const page = await browser.newPage({ viewport: { width: 360, height: 600 } });
      await page.goto('http://127.0.0.1:' + server.address().port);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await expect(page.getByLabel(/^整理最大轮数/)).toHaveValue('50');
      await expect(page.getByLabel(/^重放最大轮数/)).toHaveValue('100');
      await expect(page.getByRole('button', { name: '保存执行限制', exact: true })).toHaveCount(0);
      await expect(page.locator('form')).toHaveCount(1);
      await page.getByLabel(/^重放最大轮数/).fill('501');
      await expect(page.getByRole('button', { name: '保存配置', exact: true })).toBeDisabled();
      assert.equal(await page.evaluate(() => localStorage.getItem('configuration')), null);
      await page.getByLabel(/^整理最大轮数/).fill('80');
      await page.getByLabel(/^重放最大轮数/).fill('200');
      await expect(page.getByLabel(/^每次等待时长/)).toHaveValue('15');
      await expect(page.getByLabel(/^连续超时次数/)).toHaveValue('3');
      await page.getByLabel(/^每次等待时长/).fill('0');
      await expect(page.getByRole('button', { name: '保存配置', exact: true })).toBeDisabled();
      await page.getByLabel(/^每次等待时长/).fill('20');
      await page.getByLabel(/^连续超时次数/).fill('6');
      await expect(page.getByRole('button', { name: '保存配置', exact: true })).toBeDisabled();
      await page.getByLabel(/^连续超时次数/).fill('4');
      await page.getByLabel('模型', { exact: true }).fill('updated-model');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '保存配置', exact: true }).click();
      await expect(page.getByText('配置已保存', { exact: true })).toBeVisible();
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('configuration')));
      assert.equal(saved.settings.model, 'updated-model');
      assert.deepEqual(saved.limits, { organize: 80, replay: 200, pageWaitSeconds: 20, pageWaitAttempts: 4 });
      await page.reload();
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await expect(page.getByLabel(/^整理最大轮数/)).toHaveValue('80');
      await expect(page.getByLabel(/^重放最大轮数/)).toHaveValue('200');
      await expect(page.getByLabel(/^每次等待时长/)).toHaveValue('20');
      await expect(page.getByLabel(/^连续超时次数/)).toHaveValue('4');
      const assets = join(root, '.output', flavor + '-mv3', 'assets');
      const css = await readFile(
        join(
          assets,
          (await readdir(assets)).find((name) => /^(?:popup|style)-.*\.css$/.test(name))
        ),
        'utf8'
      );
      await page.addStyleTag({ content: css });
      await page.evaluate((dark) => {
        document.documentElement.dataset.colorTheme = 'shadcn';
        document.documentElement.classList.toggle('dark', dark);
        document.body.style.padding = '16px';
      }, flavor === 'edge');
      const evidence = join(root, 'build/validation-evidence/execution-limits');
      await mkdir(evidence, { recursive: true });
      await page.locator('[data-slot=scroll-area-viewport]').evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
      await expect(page.getByRole('button', { name: '保存配置', exact: true })).toBeInViewport();
      await page.screenshot({ path: join(evidence, flavor + '-unified-save.png') });
      await page.evaluate(() => {
        const snapshot = JSON.parse(localStorage.getItem('configuration'));
        snapshot.limits.organize = 90;
        snapshot.revision = 'remote-1';
        localStorage.setItem('configuration', JSON.stringify(snapshot));
        window.syncLimits();
      });
      await expect(page.getByLabel(/^整理最大轮数/)).toHaveValue('90');
      await page.getByLabel(/^整理最大轮数/).fill('95');
      await page.evaluate(() => {
        const snapshot = JSON.parse(localStorage.getItem('configuration'));
        snapshot.limits.organize = 100;
        snapshot.settings.model = 'remote-model';
        snapshot.revision = 'remote-2';
        localStorage.setItem('configuration', JSON.stringify(snapshot));
        window.syncLimits();
      });
      await expect(page.getByText('配置已在其他窗口更新，当前输入已保留。')).toBeVisible();
      await expect(page.getByLabel(/^整理最大轮数/)).toHaveValue('95');
      await expect(page.getByRole('button', { name: '保存配置', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: '加载最新配置', exact: true }).click();
      await expect(page.getByLabel(/^整理最大轮数/)).toHaveValue('100');
      await expect(page.getByLabel('模型', { exact: true })).toHaveValue('remote-model');
      await page.getByLabel(/^整理最大轮数/).fill('105');
      await page.evaluate(() => (window.failSave = true));
      await page.getByRole('button', { name: '保存配置', exact: true }).click();
      await expect(page.getByText('配置未能保存或读取，请重试。')).toBeVisible();
      await expect(page.getByLabel(/^整理最大轮数/)).toHaveValue('105');
      assert.equal(
        await page.evaluate(() => JSON.parse(localStorage.getItem('configuration')).limits.organize),
        100
      );
    } finally {
      await browser?.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
}
