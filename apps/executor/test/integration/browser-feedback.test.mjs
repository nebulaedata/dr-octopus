/**
 * @author Codex
 * @description Tests the minimally patched controller through the production page adapter in isolated worlds of real Chrome/Edge engines without Host registration or user profiles.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const extensionRoot = fileURLToPath(new URL('../../../browser-extension/', import.meta.url));
const bundle = await build({
  stdin: {
    contents: `import { PageControllerAdapter } from './src/page-controller-adapter.ts';
      import { PageController } from '@page-agent/page-controller';
      globalThis.adapter = new PageControllerAdapter();
      globalThis.PageController = PageController;
      globalThis.connectionId = crypto.randomUUID();
      globalThis.taskId = crypto.randomUUID();
      adapter.bind(connectionId, crypto.randomUUID(), taskId);
      globalThis.command = (method, params) => adapter.execute({ type: 'request', method, params, connectionId, taskId, requestId: crypto.randomUUID() });`,
    resolveDir: extensionRoot,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  plugins: [
    {
      name: 'owned-browser-peer',
      /**
       * Replaces only the browser-owned document identity channel, never DOM/controller methods.
       */
      setup(builder) {
        builder.onResolve({ filter: /^wxt\/browser$/ }, () => ({ path: 'browser-peer', namespace: 'peer' }));
        builder.onLoad({ filter: /.*/, namespace: 'peer' }, () => ({
          contents: `export const browser = { runtime: { sendMessage: async () => ({ documentId: 'owned-document' }) } };`,
          loader: 'js',
        }));
      },
    },
  ],
});

for (const flavor of ['chrome', 'edge']) {
  test(
    `real ${flavor}: native feedback spans observation and actions and releases with its task`,
    { timeout: 45000 },
    async () => {
      const site = createServer((_request, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end(`<title>Owned Browser feedback fixture</title>
        <body style="font-family:system-ui;padding:80px;min-height:2500px;background:#101827;color:white">
          <h1>Browser feedback regression</h1>
          <button id="click" style="margin:30px;padding:20px">Owned click</button>
          <button id="human">Human click</button>
          <input aria-label="Owned input"><select aria-label="Owned select"><option>One</option><option>Two</option></select>
          <button style="position:absolute;top:2200px">Below viewport</button>
          <div id="sensitive" data-executor-sensitive>Fixture private text</div><p id="effect">No action</p><div id="spoof" data-page-agent-ignore="true"></div>
          <script>globalThis.humanClicks=0;document.querySelector('#human').onclick=()=>globalThis.humanClicks++;globalThis.clicks=0;document.querySelector('#click').onclick=()=>{globalThis.clicks++;document.querySelector('#effect').textContent='Clicked '+clicks};</script>
        </body>`);
      });
      site.listen(0, '127.0.0.1');
      await once(site, 'listening');
      const executablePath =
        flavor === 'chrome'
          ? join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe')
          : join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe');
      let browser;
      try {
        browser = await chromium.launch({ executablePath, headless: true });
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${site.address().port}/`);
        const session = await context.newCDPSession(page);
        const { frameTree } = await session.send('Page.getFrameTree');
        const { executionContextId } = await session.send('Page.createIsolatedWorld', {
          frameId: frameTree.frame.id,
          worldName: 'owned-feedback-regression',
        });
        /**
         * Runs fixture assertions in the isolated test world; no general execution API is added to the product.
         */
        const evaluate = async (expression) => {
          const { result, exceptionDetails } = await session.send('Runtime.evaluate', {
            expression,
            contextId: executionContextId,
            awaitPromise: true,
            returnByValue: true,
            replMode: true,
          });
          assert.equal(exceptionDetails, undefined, JSON.stringify(exceptionDetails));
          return result.value;
        };
        await evaluate(bundle.outputFiles[0].text);
        await evaluate(`globalThis.snapshot = await command('browser_snapshot', { tabId: 1 });`);
        assert.equal(
          await evaluate(`snapshot.text.includes('Below viewport')`),
          true,
          'Use upstream full-page extraction by default'
        );
        const mask = page.locator('#page-agent-runtime_simulator-mask');
        await mask.waitFor({ state: 'visible' });
        assert.equal(await mask.locator('canvas').count(), 1);
        assert.equal(await evaluate(`snapshot.text.includes('simulator-mask')`), false);
        assert.ok(
          (await page.locator('#playwright-highlight-container > *').count()) > 0,
          'Preserve upstream element highlights'
        );
        await page.waitForTimeout(1000);
        assert.equal(await mask.isVisible(), true, 'Keep native feedback through model thinking gaps');
        await page.screenshot({
          path: join(extensionRoot, '../executor/build', `browser-native-feedback-${flavor}.png`),
        });
        const firstController = await evaluate('snapshot.controllerId');
        await evaluate(`snapshot = await command('browser_snapshot', { tabId: 1 });`);
        assert.equal(await evaluate('snapshot.controllerId'), firstController);
        await evaluate(String.raw`globalThis.target = (label) => ({ documentId: snapshot.documentId, controllerId: snapshot.controllerId, snapshotId: snapshot.snapshotId,
          ...(label ? { elementIndex: Number(snapshot.text.split('\n').find(line => line.includes(label) && /\[\d+\]/.test(line)).match(/\[(\d+)\]/)[1]) } : {}) });`);
        for (let attempt = 0; attempt < 2; attempt++) {
          await evaluate(`snapshot = await command('browser_snapshot', { tabId: 1 });`);
          await evaluate(
            `globalThis.pending = command('browser_click', { tabId: 1, target: target('Owned click') }); void pending;`
          );
          await page.waitForFunction(() => {
            const cursor = document.querySelector('#page-agent-runtime_simulator-mask > div:last-child');
            return cursor && cursor.className.includes('clicking');
          });
          const human = await page.locator('#human').boundingBox();
          await page.mouse.click(human.x + human.width / 2, human.y + human.height / 2);
          assert.equal((await evaluate('await pending')).businessEffect, 'applied');
          assert.equal(await page.evaluate(() => globalThis.humanClicks), 0);
          assert.equal(await mask.isVisible(), true, 'Do not dispose feedback after an action');
        }
        assert.equal(await page.evaluate(() => globalThis.clicks), 2);
        for (const [method, label, extra] of [
          ['browser_fill', 'Owned input', { text: 'Literal feedback input' }],
          ['browser_select', 'Owned select', { optionText: 'Two' }],
          ['browser_scroll', undefined, { direction: 'down', pixels: 250 }],
        ]) {
          const reply = await evaluate(`await (async () => {
            snapshot = await command('browser_snapshot', { tabId: 1 });
            return command(${JSON.stringify(method)}, { tabId: 1, target: target(${JSON.stringify(label ?? null)}), ...${JSON.stringify(extra)} });
          })()`);
          assert.equal(reply.businessEffect, 'applied', method + ': ' + JSON.stringify(reply));
          assert.equal(await mask.isVisible(), true);
        }
        assert.equal(await page.locator('input').inputValue(), 'Literal feedback input');
        assert.equal(await page.locator('select').inputValue(), 'Two');
        assert.ok(await page.evaluate(() => scrollY >= 250));
        await evaluate(`snapshot = await command('browser_snapshot', { tabId: 1 });`);
        assert.equal(
          await evaluate(
            `adapter.beginScreenshot(snapshot.snapshotId, snapshot.controllerId, snapshot.documentId)`
          ),
          true
        );
        assert.equal(await page.locator('#sensitive').evaluate((el) => getComputedStyle(el).opacity), '0');
        await evaluate('adapter.finishScreenshot()');
        assert.equal(await page.locator('#sensitive').getAttribute('style'), null);
        assert.equal(await mask.isVisible(), true, 'Capture must not hide native feedback');
        assert.equal(
          await evaluate(
            `adapter.snapshotCurrent(snapshot.snapshotId, snapshot.controllerId, snapshot.documentId)`
          ),
          true
        );
        await evaluate(`globalThis.oldTask = taskId; adapter.endTask(taskId, crypto.randomUUID());`);
        assert.equal(await mask.isVisible(), true, 'Ignore cleanup from an old connection');
        await evaluate('adapter.endTask(taskId)');
        assert.equal(await mask.count(), 0);
        assert.equal(await page.locator('#playwright-highlight-container > *').count(), 0);
        assert.equal(
          await evaluate(
            `adapter.snapshotCurrent(snapshot.snapshotId, snapshot.controllerId, snapshot.documentId)`
          ),
          false
        );
        await page.evaluate(async () => {
          scrollTo({ top: 0, behavior: 'instant' });
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
        await evaluate(
          `taskId = crypto.randomUUID(); adapter.bind(connectionId, crypto.randomUUID(), taskId); snapshot = await command('browser_snapshot', { tabId: 1 }); adapter.endTask(oldTask);`
        );
        assert.equal(await mask.isVisible(), true, 'Old task cleanup must not remove new feedback');
        await evaluate(
          `globalThis.pending = command('browser_click', { tabId: 1, target: target('Owned click') }); void pending;`
        );
        await page.waitForFunction(() =>
          document
            .querySelector('#page-agent-runtime_simulator-mask > div:last-child')
            ?.className.includes('clicking')
        );
        await evaluate('adapter.endTask(taskId)');
        assert.equal((await evaluate('await pending')).businessEffect, 'applied');
        assert.equal(await mask.count(), 0);
        assert.equal(await page.evaluate(() => globalThis.clicks), 3);
        await evaluate(
          `snapshot = await command('browser_snapshot', { tabId: 1 }); adapter.bind(crypto.randomUUID(), crypto.randomUUID(), taskId);`
        );
        assert.equal(
          await evaluate(
            `await command('browser_read_snapshot', { tabId: 1, documentId: snapshot.documentId, controllerId: snapshot.controllerId, snapshotId: snapshot.snapshotId, page: 0 }).then(() => 'unexpected', error => error.message)`
          ),
          'SNAPSHOT_EXPIRED'
        );
        assert.equal(
          await evaluate(`await (async () => {
          adapter.reset(true);
          const pending = command('browser_snapshot', { tabId: 1 }).then(() => 'unexpected', error => error.message);
          queueMicrotask(() => adapter.reset(false));
          return pending;
        })()`),
          'TARGET_CHANGED'
        );
        assert.equal(await mask.count(), 0);
        assert.equal(await evaluate('typeof PageController.prototype.executeJavascript'), 'undefined');
        await evaluate('adapter.dispose()');
        console.info('Feedback engine:', flavor, await browser.version());
      } finally {
        await browser?.close();
        await new Promise((resolve) => site.close(resolve));
      }
    }
  );
}
