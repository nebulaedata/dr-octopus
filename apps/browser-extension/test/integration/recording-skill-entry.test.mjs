/**
 * @author Codex
 * @description Verifies recording entry labels reopen exact sessions and completed views never generate a new skill implicitly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
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
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {RecordingDetail} from './src/features/recording/RecordingDetail';import {AgentSessionPage} from './src/features/agent-session/AgentSessionPage';
const recordingId='10000000-0000-4000-8000-000000000001';const id='20000000-0000-4000-8000-000000000002';
const session={id,recordingId,mode:'organize',status:window.testStatus==='legacy-error'?'failed':window.testStatus,error:window.testStatus==='legacy-error'?'SKILL_NO_TOOL':undefined,epoch:'30000000-0000-4000-8000-000000000003',revision:1,createdAt:10,messages:[],name:'查询订单'};
window.commands=[];
window.testBrowser={runtime:{sendMessage:async command=>{
window.commands.push(command);
if(command.type==='skill.state')return {ok:true,value:{sessions:window.testStatus==='new'?[]:[session,{...session,id:'old-interrupted-session',createdAt:1,status:'running'}],binding:window.testStatus==='completed'?{skillId:'saved'}:undefined}};
if(command.type==='skill.get')return {ok:true,value:session};
if(command.type==='skill.history')return {ok:true,value:{items:[{id,name:'查询订单',status:session.status,createdAt:1}],total:1}};
if(command.type==='skill.continue')return {ok:true,value:{...session,status:'running',error:undefined}};
if(command.type==='skill.start')return {ok:true,value:{...session,status:'running'}};
throw new Error('Unexpected command');
}},storage:{onChanged:{addListener:()=>{},removeListener:()=>{}}}};
function Fixture(){const [route,setRoute]=useState();if(route)return <AgentSessionPage {...route} back={()=>setRoute(undefined)} openSettings={()=>{throw new Error('Unexpected settings navigation');}}/>;return <RecordingDetail session={{id:recordingId,name:'录制',count:1,actionCount:1,startedAt:1,elapsedMs:0,resumedAt:null,pages:[],gaps:[]}} events={[]} busy={false} back={()=>{}} more={()=>{}} rename={()=>{}} remove={()=>{}} openSkill={(mode,recordingId,sessionId)=>setRoute({mode,recordingId,sessionId})}/>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
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
      name: 'owned-browser',
      setup(builder) {
        builder.onResolve({ filter: /^wxt\/browser$/ }, () => ({ path: 'browser', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: 'export const browser=new Proxy({}, {get(_t,key){return globalThis.testBrowser[key]}});',
        }));
      },
    },
  ],
});
for (const flavor of ['chrome', 'edge']) {
  test(
    `${flavor}: continuation and completed viewing preserve session identity`,
    { timeout: 45000 },
    async () => {
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
        const page = await browser.newPage();
        for (const status of [
          'new',
          'running',
          'waiting_user',
          'saving',
          'interrupted',
          'failed',
          'cancelled',
          'completed',
          'legacy-error',
        ]) {
          await page.goto('http://127.0.0.1:' + server.address().port);
          await page.evaluate((value) => {
            window.testStatus = value;
          }, status);
          await page.addScriptTag({ content: bundle.outputFiles[0].text });
          let label = '查看整理';
          if (status === 'new') {
            label = '开始整理';
          } else if (status === 'completed') {
            label = '查看整理';
          }
          const button = page.getByRole('button', { name: label, exact: true });
          await expect(button).toBeEnabled();
          if (status === 'new') {
            continue;
          }
          await expect(button.locator('svg')).toHaveClass(/lucide-file-text/);
          await button.click();
          await expect
            .poll(() => page.evaluate(() => window.commands.filter((c) => c.type === 'skill.get').length))
            .toBeGreaterThan(0);
          assert.equal(
            await page.evaluate(() => window.commands.some((c) => c.type === 'skill.start')),
            false
          );
          assert.equal(
            await page.evaluate(() => window.commands.find((c) => c.type === 'skill.get').id),
            '20000000-0000-4000-8000-000000000002'
          );
          if (status === 'failed') {
            const detailBadge = page.locator('[data-slot="badge"]').filter({ hasText: '失败' });
            await expect(detailBadge).toHaveText('失败');
            await expect(detailBadge).toHaveClass(/text-destructive/);
            await expect(detailBadge.locator('svg')).toHaveCount(1);
            await page.getByRole('button', { name: '返回录制', exact: true }).click();
            await expect(page.getByRole('button', { name: '整理历史', exact: true })).toHaveCount(0);
          }
          if (status === 'legacy-error') {
            await page.getByRole('button', { name: '继续整理', exact: true }).click();
            await expect
              .poll(() =>
                page.evaluate(
                  () => window.commands.filter((command) => command.type === 'skill.continue').length
                )
              )
              .toBe(1);
            assert.equal(
              await page.evaluate(() => window.commands.some((command) => command.type === 'skill.start')),
              false
            );
          }
          if (status === 'completed') {
            await page.getByRole('button', { name: '重新整理', exact: true }).click();
            await expect
              .poll(() => page.evaluate(() => window.commands.filter((c) => c.type === 'skill.start').length))
              .toBe(1);
          }
        }
      } finally {
        await browser?.close();
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    }
  );
}
