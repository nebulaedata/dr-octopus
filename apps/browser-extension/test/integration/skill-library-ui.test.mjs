/**
 * @author Codex
 * @description Verifies offline export and explicit stale-copy consent through production UI with a controlled Worker peer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';
const root = fileURLToPath(new URL('../../', import.meta.url));
const bundle = await build({
  stdin: {
    resolveDir: root,
    loader: 'jsx',
    contents: String.raw`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {SkillFiles} from './src/features/skill-library/SkillFiles';import {AgentSessionPage} from './src/features/agent-session/AgentSessionPage';
import {cacheSkill,skillContentHash} from './src/lib/skill-library/skill-snapshot';
const recordingId='10000000-0000-4000-8000-000000000001';const skillId='20000000-0000-4000-8000-000000000002';
const candidate={skillMarkdown:'---\nname: 离线查询\ndescription: 查询订单\n---\n查询',workflow:{schemaVersion:1,inputs:[],allowedOrigins:['https://example.com'],pages:[{role:'main',startUrl:'https://example.com'}],execution:{maxModelCalls:12},evidence:[]}};
const cache=cacheSkill({skillId,definitionHash:skillContentHash(candidate),candidate},Date.parse('2026-11-02T00:00:00Z'));
const binding={recordingId,skillId,sessionId:skillId,definitionHash:cache.snapshot.definitionHash,savedAt:cache.cachedAt,cache,storage:'browser'};
window.commands=[];window.runs=0;
window.testBrowser={storage:{onChanged:{addListener:()=>{},removeListener:()=>{}}},runtime:{sendMessage:async command=>{
 window.commands.push(command);
 if(command.type==='skill.export')return {ok:true,value:cache};
 if(command.type==='skill.state')return {ok:true,value:{binding,sessions:[],fileConnected:false}};
 if(command.type==='skill.start'){
  if(!command.consent)return {ok:false,error:'SKILL_CONSENT_REQUIRED'};
  if(!command.browserCopy)return {ok:false,error:'SKILL_CACHED_COPY_CONFIRMATION_REQUIRED'};
  if(command.browserCopy.skillId!==skillId || command.browserCopy.contentHash!==cache.contentHash)throw new Error('Bad fallback identity');
  window.runs++;
  return {ok:true,value:{id:skillId,recordingId,mode:'replay',status:'running',epoch:skillId,revision:1,messages:[],skillSource:{storage:'cached',cachedAt:cache.cachedAt}}};
 }
 if(command.type==='skill.get')return {ok:true,value:{id:skillId,recordingId,mode:'replay',status:'running',epoch:skillId,revision:1,messages:[],skillSource:{storage:'cached',cachedAt:cache.cachedAt}}};
 throw new Error('Unexpected request');
}}};
function Fixture(){const [replay,setReplay]=useState(false);return <main style={{display:'flex',flexDirection:'column',height:'100dvh'}}>{replay?<AgentSessionPage recordingId={recordingId} mode="replay" back={()=>setReplay(false)} openSettings={()=>{}}/>:<><SkillFiles binding={binding} recordingId={recordingId} connected={false} status="已保存到浏览器"/><button onClick={()=>{binding.storage='executor';setReplay(true);}}>重放</button></>}</main>;}
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
      name: 'worker-fixture',
      setup(builder) {
        builder.onResolve({ filter: /^wxt\/browser$/ }, () => ({ path: 'browser', namespace: 'fixture' }));
        builder.onResolve({ filter: /model-settings-client$/ }, () => ({
          path: 'settings',
          namespace: 'fixture',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents:
            args.path === 'browser'
              ? 'export const browser=new Proxy({}, {get(_t,key){return globalThis.testBrowser[key]}});'
              : 'export const modelSettingsRequest=async()=>({provider:"openai-compatible",baseUrl:"https://model.example.com/v1",model:"synthetic"});',
        }));
      },
    },
  ],
});
for (const flavor of ['chrome', 'edge']) {
  test(
    `${flavor}: offline export is usable and cached replay requires explicit confirmation`,
    { timeout: 45000 },
    async () => {
      const assets = join(root, '.output', flavor + '-mv3', 'assets');
      const css = await readFile(
        join(
          assets,
          (await readdir(assets)).find((name) => /^(?:popup|style)-.*\.css$/.test(name))
        ),
        'utf8'
      );
      const server = createServer((_req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<!doctype html><html data-color-theme="shadcn"><div id="root"></div></html>');
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
        const page = await browser.newPage({ viewport: { width: 360, height: 460 } });
        await page.goto('http://127.0.0.1:' + server.address().port);
        await page.addStyleTag({ content: css });
        await page.evaluate(
          (dark) => document.documentElement.classList.toggle('dark', dark),
          flavor === 'edge'
        );
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        const evidence = join(root, 'build/validation-evidence/skill-offline-ui', String(Date.now()));
        await mkdir(evidence, { recursive: true });
        await page.getByRole('button', { name: '技能文件操作', exact: true }).click();
        await expect(page.getByRole('menuitem', { name: '保存到本地目录', exact: true })).toBeDisabled();
        await page.keyboard.press('Escape');
        const downloaded = page.waitForEvent('download');
        await page.getByRole('button', { name: '导出技能', exact: true }).click();
        const zip = unzipSync(await readFile(await (await downloaded).path()));
        assert.deepEqual(Object.keys(zip).sort(), ['SKILL.md', 'workflow.json']);
        assert.ok(strFromU8(zip['SKILL.md']).includes('离线查询'));
        await expect(page.getByRole('status')).toHaveText('已发起技能副本下载。');
        await page.screenshot({ path: join(evidence, flavor + '-export.png') });
        await page.getByRole('button', { name: '重放', exact: true }).click();
        await page.getByRole('button', { name: '允许并继续', exact: true }).click();
        await expect(page.getByRole('dialog')).toContainText('可能不包含后续手工修改');
        await expect(page.getByRole('button', { name: '使用副本继续', exact: true })).toBeInViewport();
        await page.screenshot({ path: join(evidence, flavor + '-cache-confirm.png') });
        assert.equal(await page.evaluate(() => window.runs), 0);
        await page.getByRole('button', { name: '取消', exact: true }).click();
        assert.equal(await page.evaluate(() => window.runs), 0);
        await page.getByRole('button', { name: '继续', exact: true }).click();
        await page.getByRole('button', { name: '允许并继续', exact: true }).click();
        await page.getByRole('button', { name: '使用副本继续', exact: true }).click();
        await expect.poll(() => page.evaluate(() => window.runs)).toBe(1);
        await expect(page.getByText(/本次使用浏览器副本/)).toBeVisible();
      } finally {
        await browser?.close();
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    }
  );
}
