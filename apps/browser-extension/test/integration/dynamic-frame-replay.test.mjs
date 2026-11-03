/**
 * @author Codex
 * @description Replays a synthetic compose form with dynamic same-origin and inaccessible frames through the real PageController.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
const bundle = await build({
  stdin: {
    contents:
      "export {PageControllerAdapter} from './src/page-controller-adapter'; export {PageController} from '@page-agent/page-controller';",
    resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
  },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'FrameProbe',
  platform: 'browser',
  plugins: [
    {
      name: 'fixture-document',
      setup(builder) {
        builder.onResolve({ filter: /^wxt\/browser$/ }, () => ({ path: 'browser', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents:
            'export const browser={runtime:{sendMessage:async()=>({documentId:"fixture-document"})}};',
        }));
      },
    },
  ],
});
/* global FrameProbe */
for (const flavor of ['chrome', 'edge']) {
  test(
    `${flavor}: added scopes and changing titles preserve main-page actions while replaced frame documents reject stale targets`,
    { timeout: 45000 },
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
        await page.route('https://fixture.test/**', (route) =>
          route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><title>Compose fixture</title><button id="compose" onclick="document.querySelector(\'form\').hidden=false">Compose</button><form hidden onsubmit="event.preventDefault();window.sends=(window.sends||0)+1"><label>Recipient<input id="recipient"></label><label>Subject<input id="subject"></label><label>Body<textarea id="body"></textarea></label><button id="send">Send fixture</button></form>',
          })
        );
        await page.route('https://foreign.test/**', (route) =>
          route.fulfill({ contentType: 'text/html', body: '<button>FOREIGN_PRIVATE_CONTROL</button>' })
        );
        await page.goto('https://fixture.test/');
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        const result = await page.evaluate(async () => {
          const run = crypto.randomUUID();
          const adapter = new FrameProbe.PageControllerAdapter();
          adapter.bind({ localRunId: run }, 'revision', run);
          const command = (method, params) =>
            adapter.execute({
              type: 'request',
              requestId: crypto.randomUUID(),
              taskId: run,
              localRunId: run,
              method,
              params,
            });
          const snapshot = () => command('browser_snapshot', { tabId: 1, screenshot: false });
          const target = (seen, id) => {
            const found = new RegExp('\\[(\\d+)\\]<[^\\n]*id=' + id + '(?:\\s|>)').exec(seen.text);
            if (!found) {
              throw Error('Missing fixture element: ' + id);
            }
            return {
              documentId: seen.documentId,
              controllerId: seen.controllerId,
              snapshotId: seen.snapshotId,
              elementIndex: Number(found[1]),
            };
          };
          const addFrame = (parent, source, inline = false) =>
            new Promise((resolve) => {
              const frame = parent.createElement('iframe');
              frame.onload = () => resolve(frame);
              if (inline) {
                frame.srcdoc = source;
              } else {
                frame.src = source;
              }
              parent.body.append(frame);
            });
          try {
            const originalState = FrameProbe.PageController.prototype.getBrowserState;
            FrameProbe.PageController.prototype.getBrowserState = async function (...args) {
              const state = await originalState.apply(this, args);
              document.title = 'Background unread count changed';
              return state;
            };
            let before;
            try {
              before = await snapshot();
            } finally {
              FrameProbe.PageController.prototype.getBrowserState = originalState;
            }
            const same = await addFrame(document, '<button id="frame-control">Frame control</button>', true);
            const addition = await command('browser_click', { tabId: 1, target: target(before, 'compose') });
            if (addition.businessEffect !== 'applied') {
              throw Error('An unrelated added root blocked the existing main-page target');
            }
            await addFrame(document, 'https://foreign.test/');
            const nested = await addFrame(
              same.contentDocument,
              '<button id="nested" onclick="top.nestedClicks=(top.nestedClicks||0)+1">Nested same-origin control</button>',
              true
            );
            const fresh = await snapshot();
            if (fresh.text.includes('FOREIGN_PRIVATE_CONTROL')) {
              throw Error('Cross-origin content leaked');
            }
            if (adapter.beginScreenshot(fresh.snapshotId, fresh.controllerId, fresh.documentId)) {
              throw Error('Unredactable cross-origin screenshot was accepted');
            }
            await command('browser_click', { tabId: 1, target: target(fresh, 'nested') });
            const oldFrame = await snapshot();
            await new Promise((resolve) => {
              nested.onload = resolve;
              nested.srcdoc = '<button id="nested">Replacement document</button>';
            });
            let staleFrame;
            try {
              await command('browser_click', { tabId: 1, target: target(oldFrame, 'nested') });
            } catch (error) {
              staleFrame = error.message;
            }
            if (staleFrame !== 'TARGET_CHANGED' || window.nestedClicks !== 1) {
              throw Error('Nested document identity was not enforced');
            }
            let deep = document;
            for (let depth = 0; depth < 9; depth++) {
              deep = (await addFrame(deep, '<span>Deep same-origin fixture</span>', true)).contentDocument;
            }
            await snapshot();
            for (const [id, text] of [
              ['recipient', 'recipient@example.test'],
              ['subject', 'synthetic'],
              ['body', 'local fixture only'],
            ]) {
              const seen = await snapshot();
              await command('browser_fill', { tabId: 1, target: target(seen, id), text });
            }
            const ready = await snapshot();
            await command('browser_click', { tabId: 1, target: target(ready, 'send') });
            await snapshot();
            return { sends: window.sends, recipient: document.querySelector('#recipient').value };
          } finally {
            adapter.dispose();
          }
        });
        assert.deepEqual(result, { sends: 1, recipient: 'recipient@example.test' });
      } finally {
        await browser.close();
      }
    }
  );
}
