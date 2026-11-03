/**
 * @author Codex
 * @description Exercises production requirement resolution and public singleton PageController indexing on isolated pages, without fixture-only semantic adapters.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
/* global ChoiceAdapter */
const root = fileURLToPath(new URL('../../', import.meta.url));
const bundle = await build({
  stdin: {
    resolveDir: root,
    contents: "export {PageControllerAdapter} from './src/page-controller-adapter';",
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  globalName: 'ChoiceAdapter',
  plugins: [
    {
      name: 'page-identity',
      setup(builder) {
        builder.onResolve({ filter: /^wxt\/browser$/ }, () => ({ path: 'browser', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents:
            'export const browser = {runtime:{sendMessage:async()=>({documentId:"owned-document"})}};',
        }));
      },
    },
  ],
});

for (const flavor of ['chrome', 'edge']) {
  test(
    `${flavor}: production choices preserve exact targets and raw-action guards`,
    { timeout: 60000 },
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
        await page.route('https://choice.test/**', (route) =>
          route.fulfill({
            contentType: 'text/html; charset=utf-8',
            body: `<!doctype html><meta charset="utf-8"><style>body{padding:30px}label{display:block;margin:12px}</style>
        <fieldset><legend>通知</legend><label><input type="checkbox" style="display:none" checked>接收通知</label></fieldset>
        <fieldset><legend>配送</legend><label><input name="ship" type="radio" checked>普通</label><label><input name="ship" type="radio" style="position:absolute;opacity:0">优先</label></fieldset>
        <fieldset><legend>其他</legend><label><input name="other" type="radio">优先</label></fieldset>
        <label>区域<select><option>甲</option><option label="乙">选项乙文本</option></select></label>
        <button id="submit">提交</button><script>window.commits=0;window.inputs=0;document.querySelector('#submit').onclick=()=>window.commits++;document.addEventListener('input',()=>window.inputs++);</script>`,
          })
        );
        await page.goto('https://choice.test/');
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        const result = await page.evaluate(async () => {
          const run = crypto.randomUUID();
          const adapter = new ChoiceAdapter.PageControllerAdapter();
          adapter.bind({ localRunId: run }, 'revision', run);
          const choices = [
            {
              id: 'choice-action-1',
              ref: 'action-1',
              url: location.href,
              control: { role: 'checkbox', group: '通知', label: '接收通知', state: false },
            },
            {
              id: 'choice-action-2',
              ref: 'action-2',
              url: location.href,
              control: { role: 'radio', group: '配送', label: '优先', state: true },
            },
            {
              id: 'choice-action-3',
              ref: 'action-3',
              url: location.href,
              control: { role: 'select', group: '', label: '区域', state: ['乙'] },
            },
          ];
          const command = (method, params) =>
            adapter.execute({
              type: 'request',
              requestId: crypto.randomUUID(),
              localRunId: run,
              taskId: run,
              method,
              params,
              choiceRequirements: choices,
            });
          const snapshot = () => command('browser_snapshot', { tabId: 1, screenshot: false });
          const apply = async (id) => {
            const seen = await snapshot();
            return command('apply_choice', {
              tabId: 1,
              requirementId: id,
              documentId: seen.documentId,
              controllerId: seen.controllerId,
              snapshotId: seen.snapshotId,
            });
          };
          try {
            const first = await snapshot();
            const submitIndex = /\[(\d+)\]<button[^\n]*id=submit/.exec(first.text);
            if (!submitIndex) {
              throw Error('No submit index');
            }
            const raw = await command('browser_click', {
              tabId: 1,
              target: {
                documentId: first.documentId,
                controllerId: first.controllerId,
                snapshotId: first.snapshotId,
                elementIndex: Number(submitIndex[1]),
              },
            });
            const checkbox = await apply('choice-action-1');
            const repeated = await apply('choice-action-1');
            const radio = await apply('choice-action-2');
            const select = await apply('choice-action-3');
            const state = {
              checked: document.querySelector('input[type=checkbox]').checked,
              selected: document.querySelector('input[name=ship]:checked').closest('label').textContent,
              other: document.querySelector('input[name=other]').checked,
              option: document.querySelector('select').selectedOptions[0].label,
            };
            const latest = await snapshot();
            const submit = /\[(\d+)\]<button[^\n]*id=submit/.exec(latest.text);
            const receipt = await command('browser_click', {
              tabId: 1,
              target: {
                documentId: latest.documentId,
                controllerId: latest.controllerId,
                snapshotId: latest.snapshotId,
                elementIndex: Number(submit[1]),
              },
            });
            // Identical labels within the same group must not silently choose the first match.
            const wanted = document.querySelectorAll('input[name=ship]')[1];
            wanted.closest('label').after(wanted.closest('label').cloneNode(true));
            const ambiguous = await apply('choice-action-2');
            const missing = await apply('choice-action-99');
            return {
              raw,
              checkbox,
              repeated,
              radio,
              select,
              state,
              receipt,
              ambiguous,
              missing,
              commits: window.commits,
              inputs: window.inputs,
            };
          } finally {
            adapter.dispose();
          }
        });
        assert.equal(result.raw.status, 'choice_required');
        for (const name of ['checkbox', 'radio', 'select']) {
          assert.equal(result[name].status, 'satisfied', JSON.stringify(result));
        }
        assert.equal(result.repeated.businessEffect, 'none');
        assert.deepEqual(result.state, { checked: false, selected: '优先', other: false, option: '乙' });
        assert.equal(result.receipt.businessEffect, 'applied');
        assert.equal(result.commits, 1);
        assert.equal(result.ambiguous.status, 'ambiguous');
        assert.equal(result.missing.status, 'invalid_requirement');
      } finally {
        await browser.close();
      }
    }
  );
}
