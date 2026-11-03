/**
 * @author Codex
 * @description Exercises real Questionnaire and TanStack forms with multiple fields, validation and failed submissions in isolated browsers.
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
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {AgentQuestionForm} from './src/features/agent-session/AgentQuestionForm';
      const question = {
        question: '确认查询范围', allowDefer: false, fields: [
          {id:'types',label:'查询类型',type:'multiple',required:true,min:1,max:2,options:[{id:'order',label:'订单'},{id:'customer',label:'客户'}]},
          {id:'email',label:'邮箱',type:'email',required:true,maxLength:100},
          {id:'count',label:'数量',type:'number',required:true,min:1,max:5},
          {id:'date',label:'日期',type:'date',required:false}
        ]
      };
      window.answers=[]; window.failSubmission=true;
      const root=createRoot(document.getElementById('root'));window.renderQuestion=question=>root.render(<>
        <AgentQuestionForm key={question.question} id="question" question={question} busy={false} submit={async(id,answer)=>{
          if(window.failSubmission) throw new Error('SKILL_STORAGE');
          window.answers.push({id,answer});
        }}/>
        <button type="submit" form="question">确认并继续</button>
      </>);window.renderQuestion(question);
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
    `${flavor}: multi-field questions retain values and show field errors before submission`,
    { timeout: 30000 },
    async () => {
      const server = createServer((_request, response) => {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end('<!doctype html><title>Question fixture</title><div id="root"></div>');
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
          timezoneId: flavor === 'chrome' ? 'Asia/Shanghai' : 'America/Los_Angeles',
        });
        await page.clock.setFixedTime(new Date('2026-09-10T12:00:00Z'));
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        const assets = join(root, '.output', flavor + '-mv3', 'assets');
        const cssName = (await readdir(assets)).find((name) => /^(?:popup|style)-.*\.css$/.test(name));
        await page.addStyleTag({ content: await readFile(join(assets, cssName), 'utf8') });
        await page.evaluate((dark) => {
          document.documentElement.dataset.colorTheme = 'shadcn';
          document.documentElement.classList.toggle('dark', dark);
        }, flavor === 'edge');
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        await expect(page.locator('form')).toHaveCount(1);
        await page.getByRole('button', { name: '确认并继续' }).click();
        await expect(page.getByText('请填写必填内容。', { exact: true })).toHaveCount(3);
        await page.getByRole('checkbox', { name: '订单', exact: true }).check();
        await page.getByRole('checkbox', { name: '客户', exact: true }).check();
        await page.getByRole('textbox', { name: '邮箱', exact: true }).fill('bad');
        await page.getByRole('spinbutton', { name: '数量', exact: true }).fill('6');
        await page.getByRole('button', { name: '确认并继续' }).click();
        assert.equal(await page.evaluate(() => window.answers.length), 0);
        await expect(page.getByText('请检查填写内容。', { exact: true })).toHaveCount(2);
        await page.getByRole('textbox', { name: '邮箱', exact: true }).fill('demo@example.com');
        await page.getByRole('spinbutton', { name: '数量', exact: true }).fill('2');
        await page.getByRole('button', { name: '确认并继续' }).click();
        await expect(page.getByRole('alert').filter({ hasText: '任务未能保存' })).toBeVisible();
        await expect(page.getByRole('textbox', { name: '邮箱', exact: true })).toHaveValue(
          'demo@example.com'
        );
        await expect(page.getByRole('checkbox', { name: '订单', exact: true })).toBeChecked();
        await page.evaluate(() => {
          window.failSubmission = false;
        });
        const date = page.getByRole('button', { name: '日期', exact: true });
        await date.click();
        const calendar = page.locator('[data-slot="popover-content"]');
        await expect(calendar).toBeInViewport();
        const bounds = await calendar.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 360);
        const evidence = join(root, 'build/validation-evidence/skill-date-picker', String(Date.now()));
        await mkdir(evidence, { recursive: true });
        await page.screenshot({ path: join(evidence, flavor + '-calendar.png') });
        await calendar.getByRole('button', { name: /2026.*9.*25/ }).click();
        await expect(date).toHaveText('2026-09-25');
        await expect(calendar).toHaveCount(0);
        await date.click();
        await page.getByRole('button', { name: '清除日期', exact: true }).click();
        await expect(date).toHaveText('选择日期');
        await date.focus();
        await page.keyboard.press('Enter');
        await expect(calendar).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(date).toBeFocused();
        await date.click();
        await calendar.getByRole('button', { name: /2026.*9.*25/ }).click();
        await page.getByRole('button', { name: '确认并继续' }).focus();
        await page.keyboard.press('Enter');
        await expect.poll(() => page.evaluate(() => window.answers.length)).toBe(1);
        assert.deepEqual(await page.evaluate(() => window.answers[0].answer), {
          status: 'answered',
          values: { types: ['order', 'customer'], email: 'demo@example.com', count: 2, date: '2026-09-25' },
        });
        await page.getByRole('checkbox', { name: '其他，自行说明', exact: true }).check();
        await page
          .getByRole('textbox', { name: '查询类型：自行说明', exact: true })
          .fill('不查询订单，只查看说明');
        await page.getByRole('button', { name: '不适用／自行说明', exact: true }).last().click();
        await page.getByRole('textbox', { name: '日期：自行说明', exact: true }).fill('不需要有效时间');
        await page.getByRole('button', { name: '确认并继续' }).click();
        await expect.poll(() => page.evaluate(() => window.answers.length)).toBe(2);
        const custom = await page.evaluate(() => window.answers[1].answer);
        assert.deepEqual(custom.values.types, { kind: 'explanation', text: '不查询订单，只查看说明' });
        assert.deepEqual(custom.values.date, { kind: 'explanation', text: '不需要有效时间' });
        await page.evaluate(() =>
          window.renderQuestion({
            question: '是否需要有效时间？',
            allowDefer: false,
            fields: [
              {
                id: 'type',
                label: '输入参数类型',
                type: 'single',
                required: true,
                options: [
                  { id: 'date', label: '日期类型' },
                  { id: 'text', label: '文本类型' },
                ],
              },
            ],
          })
        );
        await page.getByRole('radio', { name: '其他，自行说明', exact: true }).check();
        await page.getByRole('button', { name: '确认并继续' }).click();
        assert.equal(await page.evaluate(() => window.answers.length), 2);
        await page
          .getByRole('textbox', { name: '输入参数类型：自行说明', exact: true })
          .fill('不需要这个参数，请移除。');
        await page.getByRole('button', { name: '确认并继续' }).click();
        await expect.poll(() => page.evaluate(() => window.answers.length)).toBe(3);
        assert.deepEqual((await page.evaluate(() => window.answers[2].answer)).values.type, {
          kind: 'explanation',
          text: '不需要这个参数，请移除。',
        });
        await expect(
          page.getByRole('textbox', { name: '输入参数类型：自行说明', exact: true })
        ).toHaveAttribute('data-slot', 'questionnaire-input');
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: join(evidence, flavor + '-other-answer.png') });
        assert.deepEqual(errors, []);
      } finally {
        await browser?.close();
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    }
  );
}
