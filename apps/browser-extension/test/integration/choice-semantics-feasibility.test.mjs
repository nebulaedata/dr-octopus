/**
 * @author Codex
 * @description Probes recording and replay evidence on synthetic pages before admitting the proposed intent-preservation design; no production changes or provider calls.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { ToolLoopAgent, tool, isStepCount } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';
/* global ChoiceProbe */

const root = fileURLToPath(new URL('../../', import.meta.url));
const bundle = await build({
  stdin: {
    contents: `export { DOMRecorder } from './src/lib/recording/dom-recorder';
      export { normalizeRecordingActions } from './src/lib/recording/recording-actions';
      export { validateSkillCandidate } from './src/lib/skill-organization/skill-validator';
      export { PageController } from '@page-agent/page-controller';`,
    resolveDir: root,
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  globalName: 'ChoiceProbe',
});
const fixture = `<!doctype html><meta charset="utf-8"><title>Choice evidence probe</title>
<style>body{padding:24px}label,button,select{display:block;margin:12px}input{display:inline-block}</style>
<fieldset><legend>配送方式</legend>
<label><input id="ordinary" type="radio" name="delivery" checked>普通配送</label>
<label><input id="priority" type="radio" name="delivery">优先配送 <small>有效期 2026/09/25 至 2026/12/25</small></label></fieldset>
<label><input id="receipt" type="checkbox">需要收据</label>
<label><input id="cancelled" type="checkbox">被页面拒绝的选择</label>
<button id="sync" role="switch" aria-checked="false">同步开关</button>
<button id="async" role="switch" aria-checked="false">异步开关</button>
<button id="opaque">无语义开关</button>
<label for="region">处理区域</label><select id="region"><option>区域甲</option><option>区域乙</option></select>
<label for="multi">通知方式</label><select id="multi" multiple><option>站内</option><option>短信</option></select>
<label for="date">开始日期</label><input id="date" type="date">
<label for="text">备注</label><input id="text">
<button id="generic" type="button">继续</button><form><button id="submit" type="submit">继续</button></form>
<script>
document.querySelector('#cancelled').onclick=e=>e.preventDefault();
document.querySelector('#sync').onclick=e=>e.currentTarget.setAttribute('aria-checked','true');
document.querySelector('#async').onclick=()=>setTimeout(()=>document.querySelector('#async').setAttribute('aria-checked','true'),80);
document.querySelector('#opaque').onclick=e=>e.currentTarget.style.background='green';
window.submissions=0;
document.querySelector('#generic').onclick=()=>window.submissions++;
document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submissions++};
</script>`;

for (const flavor of ['chrome', 'edge']) {
  test(
    `${flavor}: establish semantic feasibility and counterexamples without business actions`,
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
        const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } });
        await page.route('https://synthetic.test/**', (route) =>
          route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture })
        );
        await page.goto('https://synthetic.test/');
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        await page.evaluate(() => {
          window.facts = [];
          window.timing = [];
          window.recorder = new ChoiceProbe.DOMRecorder(
            document.createElement('div'),
            (fact) => window.facts.push(fact),
            () => {}
          );
          window.recorder.start();
          document.addEventListener(
            'click',
            (event) => {
              const target = event.target;
              if (!['sync', 'async', 'cancelled'].includes(target.id)) {
                return;
              }
              const read = (phase) =>
                window.timing.push({
                  id: target.id,
                  phase,
                  checked:
                    target instanceof HTMLInputElement ? target.checked : target.getAttribute('aria-checked'),
                });
              read('capture');
              setTimeout(() => read('next-task'), 0);
            },
            true
          );
        });
        await page.locator('#priority').check();
        await page.locator('#receipt').check();
        await page.locator('#receipt').uncheck();
        await page.locator('#cancelled').click();
        await page.locator('#sync').click();
        await page.locator('#async').click();
        await page.waitForFunction(
          () => document.querySelector('#async').getAttribute('aria-checked') === 'true'
        );
        await page.locator('#region').selectOption({ label: '区域乙' });
        await page.locator('#multi').selectOption([{ label: '站内' }, { label: '短信' }]);
        await page.locator('#date').fill('2026-11-03');
        await page.locator('#text').fill('PRIVATE-INPUT-SENTINEL');
        const captured = await page.evaluate(() => {
          window.recorder.stop();
          const events = window.facts.map((fact, index) => ({
            ...fact,
            seq: index + 1,
            source: 'dom',
            tabRef: 'tab-1',
            documentRef: 'document-1',
          }));
          return {
            facts: window.facts,
            actions: ChoiceProbe.normalizeRecordingActions(events),
            timing: window.timing,
          };
        });
        const choiceInput = captured.actions.find(
          (action) =>
            action.label.includes('优先配送') && action.action === 'choice' && action.control.state === true
        );
        assert.ok(choiceInput, 'A radio change retains its observed choice state');
        assert.equal(choiceInput.parameterId, undefined, 'A choice is not a text parameter');
        assert.equal(JSON.stringify(captured).includes('PRIVATE-INPUT-SENTINEL'), false);
        assert.equal(
          captured.facts.some((fact) => fact.control?.state === true && fact.inputType === 'radio'),
          true
        );
        assert.equal(
          captured.timing.find((item) => item.id === 'sync' && item.phase === 'capture').checked,
          'false'
        );
        assert.equal(
          captured.timing.find((item) => item.id === 'sync' && item.phase === 'next-task').checked,
          'true'
        );
        assert.equal(
          captured.timing.find((item) => item.id === 'async' && item.phase === 'next-task').checked,
          'false'
        );
        assert.equal(
          captured.timing.find((item) => item.id === 'cancelled' && item.phase === 'capture').checked,
          true
        );
        assert.equal(
          captured.timing.find((item) => item.id === 'cancelled' && item.phase === 'next-task').checked,
          false
        );

        // The actual public controller API is the replay observation source, not a test-built DOM extractor.
        const observations = await page.evaluate(async () => {
          document.querySelector('#text').value = '';
          window.controller = new ChoiceProbe.PageController({ enableMask: false });
          const before = await window.controller.getBrowserState();
          document.querySelector('#priority').checked = false;
          document.querySelector('#ordinary').checked = true;
          const after = await window.controller.getBrowserState();
          document.querySelector('#region').selectedIndex = 0;
          document.querySelector('#multi').options[1].selected = false;
          const changedSelections = await window.controller.getBrowserState();
          window.controller.dispose();
          return {
            before: before.content,
            after: after.content,
            changedSelections: changedSelections.content,
          };
        });
        assert.match(observations.before, /checked=true[^\n]*id=priority|id=priority[^\n]*checked=true/);
        assert.match(observations.after, /checked=false[^\n]*id=priority|id=priority[^\n]*checked=false/);
        assert.match(observations.before, /aria-checked=true/);

        // A real runtime state change can invalidate an earlier correct observation without navigation.
        assert.notEqual(observations.before, observations.after);
        const selectLines = (text) => text.split('\n').filter((line) => /<(select|option)\b/.test(line));
        assert.deepEqual(
          selectLines(observations.after),
          selectLines(observations.changedSelections),
          'Default snapshot text cannot distinguish the changed native select values in this fixture'
        );
        const publicApiProbe = await page.evaluate(async () => {
          const controller = new ChoiceProbe.PageController({
            enableMask: false,
            includeAttributes: ['selected', 'aria-selected', 'disabled', 'value'],
          });
          try {
            const first = await controller.getBrowserState();
            document.querySelector('#region').selectedIndex = 1;
            const second = await controller.getBrowserState();
            const multi = /\[(\d+)\]<select[^\n]*id=multi/.exec(second.content);
            if (!multi) {
              throw Error('Fixture select index missing');
            }
            const firstSelection = await controller.selectOption(Number(multi[1]), '站内');
            const third = await controller.getBrowserState();
            const next = /\[(\d+)\]<select[^\n]*id=multi/.exec(third.content);
            if (!next) {
              throw Error('Fixture refreshed select index missing');
            }
            const secondSelection = await controller.selectOption(Number(next[1]), '短信');
            return {
              first: first.content,
              second: second.content,
              firstSelection,
              secondSelection,
              selected: [...document.querySelector('#multi').selectedOptions].map(
                (option) => option.textContent
              ),
            };
          } finally {
            controller.dispose();
          }
        });
        assert.deepEqual(
          selectLines(publicApiProbe.first).map((line) => line.replace(/^\*/, '')),
          selectLines(publicApiProbe.second).map((line) => line.replace(/^\*/, '')),
          'Adding public attribute configuration cannot materialize native selected properties'
        );
        assert.equal(publicApiProbe.firstSelection.success, true);
        assert.equal(publicApiProbe.secondSelection.success, true);
        assert.deepEqual(
          publicApiProbe.selected,
          ['短信'],
          'Sequential selectOption replaces rather than accumulates multiselect choices'
        );
        const candidate = {
          skillMarkdown: '---\nname: 配送测试\ndescription: 合成验证\n---\n填写数量并提交。',
          workflow: {
            schemaVersion: 1,
            inputs: [],
            allowedOrigins: ['https://synthetic.test'],
            pages: [{ role: 'main', startUrl: 'https://synthetic.test/' }],
            execution: { maxModelCalls: 10 },
            evidence: [],
          },
        };
        const validations = [];
        for (const includeReference of [false, true]) {
          const proposal = structuredClone(candidate);
          if (includeReference) {
            proposal.skillMarkdown += '\n保持普通配送，不要选择优先配送。';
            proposal.workflow.evidence = [{ ref: 'action-1', kind: 'click', targetHint: '优先配送' }];
          }
          const model = new MockLanguageModelV4({
            doGenerate: {
              content: [
                {
                  type: 'tool-call',
                  toolName: 'validate_skill',
                  toolCallId: 'validation',
                  input: JSON.stringify(proposal),
                },
              ],
              usage: { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, text: 1 } },
              warnings: [],
              finishReason: { unified: 'tool-calls' },
            },
          });
          const agent = new ToolLoopAgent({
            model,
            maxRetries: 0,
            stopWhen: isStepCount(1),
            tools: {
              validate_skill: tool({
                inputSchema: z.object({ skillMarkdown: z.string(), workflow: z.object({}).passthrough() }),
                execute: async (input) => {
                  const result = await page.evaluate(
                    (raw) =>
                      ChoiceProbe.validateSkillCandidate(raw, {
                        siteScopes: ['https://synthetic.test'],
                        events: [{ action: 'click' }],
                        actions: [{ id: 'action-1', action: 'click', label: '优先配送' }],
                      }),
                    input
                  );
                  validations.push({ includeReference, valid: result.valid });
                  return result;
                },
              }),
            },
          });
          await agent.generate({ prompt: '合成方案验证：保留录制中的优先配送选择。' });
          assert.equal(model.doGenerateCalls.length, 1);
        }
        assert.deepEqual(
          validations,
          [
            { includeReference: false, valid: true },
            { includeReference: true, valid: true },
          ],
          'Unstructured click-only evidence cannot prove a choice requirement; typed source coverage is tested separately'
        );
        await page.locator('#generic').click();
        assert.equal(
          await page.evaluate(() => window.submissions),
          1,
          'A normal button can commit without form submit semantics'
        );

        const directory = join(root, 'build/validation-evidence/choice-semantics-implementation');
        await mkdir(directory, { recursive: true });
        await writeFile(
          join(directory, `${flavor}.json`),
          JSON.stringify(
            {
              flavor,
              providerCalls: 0,
              productionChanged: true,
              validationFixture: 'untyped click-only evidence; not a typed choice candidate',
              captured,
              observations,
              publicApiProbe,
              validations,
              controlledModelCalls: 2,
              findings: {
                nativeChoiceObservable: true,
                capturePhaseCanPrecedeAriaUpdate: true,
                cancelledClickRollsBackNativeState: true,
                nextTaskDoesNotGuaranteeAsyncSettlement: true,
                snapshotIsNotAtomicWithLaterAction: true,
                arbitraryCommitCannotBeInferredFromButtonType: true,
                defaultSnapshotLosesSelectStateInFixture: true,
              },
              verdict: 'source-choice-semantics-fixed; public upstream select limitations still reproduced',
            },
            null,
            2
          )
        );
      } finally {
        await browser.close();
      }
    }
  );
}
