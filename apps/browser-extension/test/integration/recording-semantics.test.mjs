/**
 * @author Codex
 * @description Exercises trusted browser events through production capture and assembly using an owned HTTPS fixture with no provider.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
/* global SemanticFixture */
const root = fileURLToPath(new URL('../../', import.meta.url));
const bundle = await build({
  stdin: {
    contents: `export {DOMRecorder} from './src/lib/recording/dom-recorder'; export {prepareRecordingEvidence,recordingToolPage} from './src/lib/recording/recording-evidence'; export {recordingChoices,hasConflictingChoicePhases} from './src/lib/recording/recording-choices';`,
    resolveDir: root,
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  globalName: 'SemanticFixture',
});
for (const flavor of ['chrome', 'edge']) {
  test(
    `${flavor}: nested targets and edit boundaries retain facts without capturing values`,
    { timeout: 30000 },
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
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('https://synthetic.test/**', (route) =>
          route.fulfill({
            contentType: 'text/html; charset=utf-8',
            body: '<!doctype html><meta charset="utf-8"><label for="a">订单号</label><input id="a"><label for="b">订单号</label><input id="b"><button id="button"><span id="inner">确认查询</span></button><div data-sensitive><button><span id="secret">敏感控件</span></button></div><input id="password" type="password"><label for="secret-choice" data-sensitive>PRIVATE-CHOICE</label><input id="secret-choice" type="checkbox"><fieldset><legend>配送</legend><label><input name="ship" type="radio"><span id="normal">普通</span></label><label><input name="ship" type="radio"><span id="preferred">优先</span></label></fieldset>',
          })
        );
        await page.goto('https://synthetic.test/');
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        await page.evaluate(() => {
          window.facts = [];
          window.recorder = new SemanticFixture.DOMRecorder(
            document.createElement('div'),
            (event) => window.facts.push(event),
            () => {}
          );
          window.recorder.start();
        });
        await page.locator('#inner').click();
        await page.locator('#a').fill('PRIVATE-FIRST');
        await page.waitForTimeout(450);
        await page.locator('#a').fill('PRIVATE-SECOND');
        await page.waitForTimeout(450);
        await page.locator('#b').focus();
        await page.locator('#a').fill('PRIVATE-THIRD');
        await page.locator('#b').fill('PRIVATE-FOURTH');
        await page.evaluate(() => {
          window.recorder.stop();
          window.recorder.start();
        });
        await page.locator('#b').fill('PRIVATE-FIFTH');
        await page.locator('#secret').click();
        await page.locator('#password').fill('PRIVATE-PASSWORD');
        await page.locator('#secret-choice').check();
        await page.locator('#normal').click();
        await page.locator('#preferred').click();
        await page.keyboard.press('Tab');
        const result = await page.evaluate(() => {
          window.recorder.stop();
          const events = window.facts.map((event, index) => ({
            ...event,
            sessionId: '10000000-0000-4000-8000-000000000001',
            seq: index + 1,
            tabRef: 'tab-1',
            documentId: 'PRIVATE-DOCUMENT',
            source: 'dom',
          }));
          const evidence = SemanticFixture.prepareRecordingEvidence(
            {
              id: events[0].sessionId,
              count: events.length,
              status: 'stopped',
              name: 'Fixture',
              gaps: [],
              origins: ['https://synthetic.test'],
              pages: [{ tabRef: 'tab-1', origin: 'https://synthetic.test' }],
            },
            events
          );
          return {
            facts: window.facts,
            actions: evidence.actions,
            modelInput: SemanticFixture.recordingToolPage(evidence, 0, 50),
            choices: SemanticFixture.recordingChoices(evidence),
            conflictingPhases: SemanticFixture.hasConflictingChoicePhases(evidence),
          };
        });
        assert.deepEqual(errors, []);
        assert.equal(result.facts[0].label, '确认查询');
        assert.equal(result.facts[0].role, 'button');
        assert.equal(result.choices.length, 1);
        assert.equal(result.choices[0].control.label, '优先');
        assert.equal(result.choices[0].control.state, true);
        assert.equal(result.conflictingPhases, false);
        const inputs = result.facts.filter((event) => event.action === 'input');
        assert.equal(inputs.length, 5);
        assert.equal(inputs[0].editRef, inputs[1].editRef);
        assert.equal(inputs[0].targetRef, inputs[2].targetRef);
        assert.notEqual(inputs[1].editRef, inputs[2].editRef);
        assert.notEqual(inputs[2].targetRef, inputs[3].targetRef);
        assert.equal(inputs[3].targetRef, inputs[4].targetRef);
        assert.notEqual(inputs[3].editRef, inputs[4].editRef);
        assert.equal(result.actions.filter((action) => action.action === 'fill').length, 4);
        assert.equal(JSON.stringify(result).includes('PRIVATE-'), false);
        assert.equal(
          result.facts.some((event) => event.label === '敏感控件'),
          false
        );
        assert.equal(JSON.stringify(result.modelInput).includes('editRef'), false);
        assert.deepEqual(
          new Set(result.actions.flatMap((step) => step.sourceEventIds)),
          new Set(result.facts.map((event) => event.id))
        );
      } finally {
        await browser.close();
      }
    }
  );
}

for (const flavor of ['chrome', 'edge']) {
  test(
    `${flavor}: labels exclude embedded editable and sensitive text through model evidence projection`,
    { timeout: 30000 },
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
        await page.route('https://synthetic.test/**', (route) =>
          route.fulfill({
            contentType: 'text/html; charset=utf-8',
            body: `<!doctype html><meta charset="utf-8">
          <label>备注<textarea id="prefilled">PRIVATE-PREFILL</textarea></label>
          <label for="external">金额 20 元<span hidden data-sensitive>PRIVATE-NEST</span><span hidden contenteditable="true">PRIVATE-EDITABLE</span></label><input id="external">
          <label>辅助说明<textarea id="named" aria-label="指定名称">PRIVATE-NAMED</textarea></label>
          <label>辅助说明<textarea id="placeholder" placeholder="占位名称">PRIVATE-PLACEHOLDER</textarea></label>
          <label><textarea id="only">PRIVATE-ONLY</textarea></label>
          <button id="action">继续<span hidden data-executor-sensitive>PRIVATE-BUTTON</span><span hidden contenteditable="true">PRIVATE-CHILD</span></button>`,
          })
        );
        await page.goto('https://synthetic.test/');
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        await page.evaluate(() => {
          window.facts = [];
          window.recorder = new SemanticFixture.DOMRecorder(
            document.createElement('div'),
            (fact) => window.facts.push(fact),
            () => {}
          );
          window.recorder.start();
        });
        await page.locator('#prefilled').click();
        for (const id of ['prefilled', 'external', 'named', 'placeholder', 'only']) {
          await page.locator('#' + id).fill('PRIVATE-LIVE');
        }
        await page.locator('#action').click();
        const result = await page.evaluate(() => {
          window.recorder.stop();
          const id = crypto.randomUUID();
          const events = window.facts.map((fact, index) => ({
            ...fact,
            sessionId: id,
            seq: index + 1,
            tabRef: 'tab-1',
            documentId: 'document',
            source: 'dom',
          }));
          const evidence = SemanticFixture.prepareRecordingEvidence(
            {
              id,
              count: events.length,
              status: 'stopped',
              name: 'Label fixture',
              gaps: [],
              origins: ['https://synthetic.test'],
              pages: [{ tabRef: 'tab-1', origin: 'https://synthetic.test' }],
            },
            events
          );
          return { facts: window.facts, modelInput: SemanticFixture.recordingToolPage(evidence, 0, 50) };
        });
        assert.equal(JSON.stringify(result).includes('PRIVATE-'), false);
        assert.equal(result.facts[0].label, '备注');
        assert.deepEqual(
          result.facts.filter((fact) => fact.action === 'input').map((fact) => fact.label),
          ['备注', '金额 20 元', '指定名称', '占位名称', '填写字段']
        );
        assert.ok(result.facts.some((fact) => fact.role === 'button' && fact.label === '继续'));
      } finally {
        await browser.close();
      }
    }
  );
}
