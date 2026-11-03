/**
 * @author Codex
 * @description Checks the real conversation deletion dialog with isolated browser state and no model requests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
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
import {AgentSessionPage} from './src/features/agent-session/AgentSessionPage';
const root=createRoot(document.getElementById('root'));
window.renderSession=(mode)=>{window.task={id:'session',recordingId:'recording',epoch:'epoch',revision:4,mode,status:'completed',operationId:'skill',messages:[],ledger:{},modelCalls:2};root.render(<AgentSessionPage key={mode} recordingId="recording" mode={mode} sessionId="session" autoStart={false} back={()=>{window.returned=true}} openSettings={()=>{}}/>)};
window.commands=[];window.renderSession('organize');`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'isolated-browser',
      setup(builder) {
        builder.onResolve({ filter: /^wxt\/browser$/ }, () => ({ path: 'browser', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `export const browser={storage:{onChanged:{addListener(){},removeListener(){}}},runtime:{async sendMessage(command){if(command.type==='skill.get')return {ok:true,value:window.task};window.commands.push(command);return window.fail?{ok:false,error:'SKILL_DELETE_FILES_FAILED'}:{ok:true,value:true}}}};`,
        }));
      },
    },
  ],
});

for (const flavor of ['chrome', 'edge']) {
  test(
    `${flavor}: optional skill deletion defaults off, preserves failed input and is absent for replay`,
    { timeout: 30000 },
    async () => {
      const assets = join(root, '.output', flavor + '-mv3', 'assets');
      const css = await readFile(
        join(
          assets,
          (await readdir(assets)).find((name) => /^(?:popup|style)-.*\.css$/.test(name))
        ),
        'utf8'
      );
      const server = createServer((_request, response) => {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end('<!doctype html><title>会话删除测试</title><div id="root"></div>');
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
        const page = await browser.newPage({ viewport: { width: 380, height: 650 } });
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.addStyleTag({ content: css });
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        await page.getByRole('button', { name: '删除会话', exact: true }).click();
        const checkbox = page.getByRole('checkbox', { name: '同时删除本次生成的技能' });
        await expect(checkbox).not.toBeChecked();
        await checkbox.check();
        await page.getByRole('button', { name: '取消', exact: true }).click();
        assert.equal((await page.evaluate(() => window.commands)).length, 0);
        await page.getByRole('button', { name: '删除会话', exact: true }).click();
        await expect(checkbox).not.toBeChecked();
        await checkbox.check();
        await page.evaluate(() => {
          window.fail = true;
        });
        await page.getByRole('button', { name: '确认删除', exact: true }).click();
        await expect(page.getByText(/本地技能文件未确认删除/)).toBeVisible();
        await expect(checkbox).toBeChecked();
        if (process.env.EXECUTOR_DELETION_EVIDENCE) {
          await page.screenshot({
            path: join(process.env.EXECUTOR_DELETION_EVIDENCE, flavor + '-delete-dialog.png'),
          });
        }
        assert.equal(await page.evaluate(() => Boolean(window.returned)), false);
        await page.evaluate(() => {
          window.fail = false;
        });
        await page.getByRole('button', { name: '确认删除', exact: true }).click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        assert.equal(await page.evaluate(() => window.commands.at(-1).deleteSkill), true);
        await page.evaluate(() => window.renderSession('replay'));
        await page.getByRole('button', { name: '删除会话', exact: true }).click();
        await expect(page.getByRole('checkbox')).toHaveCount(0);
        await page.getByRole('button', { name: '确认删除', exact: true }).click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        assert.equal(await page.evaluate(() => window.commands.at(-1).deleteSkill), false);
      } finally {
        await browser?.close();
        await new Promise((resolve) => server.close(resolve));
      }
    }
  );
}
