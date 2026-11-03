/**
 * @author Codex
 * @description Verifies permissions, BFCache, discard and abnormal exit with website debugging detached at lifecycle boundaries.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// Reuse test-only process ownership; this helper never imports Executor product implementations.
import { launchDetachedBrowser } from '../../../executor/test/integration/detached-browser.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Polls a specific browser condition with a finite deadline and retains the last observed value on failure.
 */
async function until(read, accept, label) {
  const deadline = Date.now() + 10000;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (accept(last)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`${label}: ${JSON.stringify(last)}`);
}

for (const flavor of ['chrome', 'edge']) {
  test(
    `detached ${flavor}: permissions, BFCache, discard and browser crash preserve capture boundaries`,
    { timeout: 120000 },
    async () => {
      const temporary = await mkdtemp(join(tmpdir(), 'octopus-recorder-lifecycle-'));
      const extension = join(temporary, 'extension');
      const profile = join(temporary, 'profile');
      let browser;
      let loads = 0;
      const result = { flavor, websiteDebuggerAttachedDuringLifecycle: false };
      const server = createServer((_request, response) => {
        loads++;
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(
          '<!doctype html><title>录制生命周期夹具</title><h1>仅测试页面</h1><label>订单号<input id="order"></label><button>查询</button>'
        );
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        await cp(join(root, '.output', `${flavor}-mv3`), extension, { recursive: true });
        const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
        const { identity } = JSON.parse(await readFile(join(extension, 'browser-identity.json'), 'utf8'));
        await writeFile(
          join(extension, 'manifest.json'),
          JSON.stringify({ ...manifest, key: identity.sideloadPublicKey })
        );
        const background = await readFile(join(extension, 'background.js'), 'utf8');
        assert.equal(background.split('com.octopus.executor.browser').length, 2);
        await writeFile(
          join(extension, 'background.js'),
          background.replace('com.octopus.executor.browser', 'com.octopus.test.lifecycle_unregistered')
        );
        browser = await launchDetachedBrowser(profile, extension, flavor, { flavor: 'installed' });
        const popupUrl = `chrome-extension://${identity.sideloadExtensionId}/popup.html`;
        let control = (await browser.send('Target.createTarget', { url: popupUrl })).targetId;
        await until(
          () => browser.evaluate(control, 'typeof globalThis.chrome?.runtime?.sendMessage'),
          (value) => value === 'function',
          'manager ready'
        );
        /**
         * Calls the production message boundary from the owned manager document.
         */
        const command = (request) =>
          browser.evaluate(control, `chrome.runtime.sendMessage(${JSON.stringify(request)})`);
        const url = `http://127.0.0.1:${server.address().port}/record`;
        let tab = await browser.evaluate(
          control,
          `chrome.tabs.create({url:${JSON.stringify(url)},active:false})`
        );
        await until(
          () => browser.evaluate(control, `chrome.tabs.get(${tab.id})`),
          (value) => value.status === 'complete',
          'page loaded'
        );
        const start = await command({ type: 'recorder.start', tabId: tab.id, includeRelated: false });
        assert.equal(start.ok, true);
        await until(
          () => command({ type: 'recorder.status' }),
          (reply) => !!reply.value?.active?.pages[0].documentId,
          'producer registered'
        );
        const targets = (await browser.send('Target.getTargets')).targetInfos;
        const website = targets.find((target) => target.url === url);
        assert.ok(website);
        assert.equal(website.attached, false);
        const previousLoads = loads;
        /**
         * Sends genuine input with a temporary session, detached before history and lifecycle checks.
         */
        async function inputText(text) {
          await browser.evaluate(
            control,
            `chrome.scripting.executeScript({target:{tabId:${tab.id}},func:() => document.querySelector('#order').focus()})`
          );
          const target = (await browser.send('Target.getTargets')).targetInfos.find(
            (entry) => entry.url === url
          );
          const { sessionId } = await browser.send('Target.attachToTarget', {
            targetId: target.targetId,
            flatten: true,
          });
          try {
            await browser.send('Input.insertText', { text }, sessionId);
          } finally {
            await browser.send('Target.detachFromTarget', { sessionId });
          }
        }
        await inputText('first-private');
        await until(
          () => command({ type: 'recorder.detail', sessionId: start.value.id, after: 0 }),
          (reply) => reply.value.events.some((event) => event.action === 'input'),
          'first document batch committed'
        );
        const firstDocument = (await command({ type: 'recorder.status' })).value.active.pages[0].documentId;
        await browser.evaluate(
          control,
          `chrome.scripting.executeScript({target:{tabId:${tab.id}},func:() => {
          document.documentElement.dataset.fixtureRestore = 'initial';
          window.addEventListener('pageshow', (event) => { document.documentElement.dataset.fixtureRestore = String(event.persisted); });
        }})`
        );
        await browser.evaluate(
          control,
          `chrome.tabs.update(${tab.id},{url:${JSON.stringify(url + '-next')}})`
        );
        await until(
          () => command({ type: 'recorder.status' }),
          (reply) =>
            reply.value?.active?.pages[0].documentId &&
            reply.value.active.pages[0].documentId !== firstDocument,
          'navigate to a different document'
        );
        await browser.evaluate(
          control,
          `chrome.scripting.executeScript({target:{tabId:${tab.id}},func:() => history.back()})`
        );
        await until(
          () => browser.evaluate(control, `chrome.tabs.get(${tab.id})`),
          (value) => value.url === url && value.status === 'complete',
          'history return'
        );
        const historyState = await browser.evaluate(
          control,
          `chrome.scripting.executeScript({target:{tabId:${tab.id}},func:() => ({ restored:document.documentElement.dataset.fixtureRestore, toolbar:!!document.querySelector('[data-octopus-recorder]'), reasons:performance.getEntriesByType('navigation')[0]?.notRestoredReasons?.toJSON?.() })})`
        );
        result.history = historyState[0].result;
        await until(
          () => command({ type: 'recorder.status' }),
          (reply) => !!reply.value?.active?.pages[0].documentId,
          'history recording remains available'
        );
        result.history.documentRestored =
          (await command({ type: 'recorder.status' })).value.active.pages[0].documentId === firstDocument;
        assert.equal(result.history.restored, 'true', 'history test requires an actual BFCache hit');
        assert.equal(result.history.documentRestored, true);
        assert.equal(result.history.toolbar, true);
        const inputCount = (
          await command({ type: 'recorder.detail', sessionId: start.value.id, after: 0 })
        ).value.events.filter((event) => event.action === 'input').length;
        await inputText('restored-private');
        await until(
          () => command({ type: 'recorder.detail', sessionId: start.value.id, after: 0 }),
          (reply) => reply.value.events.filter((event) => event.action === 'input').length > inputCount,
          'restored document commits new input'
        );
        assert.equal(
          (await browser.send('Target.getTargets')).targetInfos.find((target) => target.url === url).attached,
          false
        );
        result.history.newInputCommitted = true;
        const beforeDiscardLoads = loads;
        tab = await browser.evaluate(control, `chrome.tabs.discard(${tab.id})`);
        assert.equal(tab.discarded, true);
        const discarded = await until(
          () => command({ type: 'recorder.detail', sessionId: start.value.id, after: 0 }),
          (reply) => reply.value?.session.status === 'interrupted',
          'discard interrupts recording'
        );
        assert.equal(discarded.value.session.pages[0].included, false);
        assert.ok(loads >= previousLoads);
        assert.equal(loads, beforeDiscardLoads, 'recorder must not reload the discarded page');
        assert.equal((await command({ type: 'recorder.status' })).value.active, null);
        result.discard = { interrupted: true, noReload: true, gaps: discarded.value.session.gaps };

        await browser.evaluate(control, `chrome.tabs.reload(${tab.id})`);
        await until(
          () => browser.evaluate(control, `chrome.tabs.get(${tab.id})`),
          (value) => !value.discarded && value.status === 'complete',
          'explicit reload'
        );
        assert.equal((await command({ type: 'recorder.status' })).value.active, null);
        const freezeSession = await command({ type: 'recorder.start', tabId: tab.id, includeRelated: false });
        assert.equal(freezeSession.ok, true);
        await until(
          () => command({ type: 'recorder.status' }),
          (reply) => !!reply.value?.active?.pages[0].documentId,
          'freeze producer registered'
        );
        const internal = (await browser.send('Target.createTarget', { url: 'chrome://discards' })).targetId;
        const freezeAction = await until(
          () =>
            browser.evaluate(
              internal,
              `(() => {
          const elements = [];
          const scan = (root) => { for (const element of root.querySelectorAll('*')) { elements.push(element); if (element.shadowRoot) scan(element.shadowRoot); } };
          scan(document);
          const row = elements.find(element => element.tagName === 'TR' && [...element.querySelectorAll('td')].some(cell => cell.textContent.trim() === ${JSON.stringify(url)}));
          const action = row && [...row.querySelectorAll('[is="action-link"]')].find(element => element.textContent.trim() === '[Freeze]');
          if (action) { action.click(); return {clicked:true}; }
          return {clicked:false, page:location.href, rows:elements.filter(element => element.tagName === 'TR').map(element => element.innerText).slice(0,12)};
        })()`
            ),
          (value) => value.clicked || value.page?.startsWith('chrome://debug-webuis-disabled/'),
          'freeze owned website from browser diagnostics'
        );
        if (freezeAction.clicked) {
          await until(
            () => browser.evaluate(control, `chrome.tabs.get(${tab.id})`),
            (value) => value.frozen === true,
            'real frozen tab'
          );
          assert.equal(
            (await browser.send('Target.getTargets')).targetInfos.find((target) => target.url === url)
              .attached,
            false
          );
          const frozen = await until(
            () => command({ type: 'recorder.detail', sessionId: freezeSession.value.id, after: 0 }),
            (reply) => reply.value?.session.status === 'interrupted',
            'freeze interrupts recorder'
          );
          assert.equal(frozen.value.session.pages[0].included, false);
          result.freeze = {
            mechanism: 'browser diagnostics Freeze action',
            websiteDebuggerAttached: false,
            interrupted: true,
          };
        } else {
          result.freeze = { status: 'blocked', reason: freezeAction.page, websiteDebuggerAttached: false };
          const stopped = await command({
            type: 'recorder.control',
            sessionId: freezeSession.value.id,
            action: 'stop',
          });
          assert.equal(stopped.ok, true);
        }
        // Close the frozen fixture instead of using a debugger to thaw it or claiming natural recovery.
        await browser.evaluate(control, `chrome.tabs.remove(${tab.id})`);
        tab = await browser.evaluate(
          control,
          `chrome.tabs.create({url:${JSON.stringify(url)},active:false})`
        );
        await until(
          () => browser.evaluate(control, `chrome.tabs.get(${tab.id})`),
          (value) => value.status === 'complete',
          'new tab after freeze'
        );
        const next = await command({ type: 'recorder.start', tabId: tab.id, includeRelated: false });
        assert.equal(next.ok, true);
        await until(
          () => command({ type: 'recorder.status' }),
          (reply) => !!reply.value?.active?.pages[0].documentId,
          'second producer registered'
        );
        // Browser-level activation produces a real recorded browser fact without a page debugger.
        await browser.evaluate(control, `chrome.tabs.update(${tab.id},{active:true})`);
        await until(
          () => command({ type: 'recorder.detail', sessionId: next.value.id, after: 0 }),
          (reply) => reply.value?.events.length > 0,
          'committed browser fact'
        );
        assert.equal(
          (await browser.send('Target.getTargets')).targetInfos.find((target) => target.url === url).attached,
          false
        );
        let crashDisconnected = false;
        try {
          await browser.send('Browser.crash');
        } catch (error) {
          crashDisconnected = /channel closed/i.test(error.message);
        }
        assert.equal(crashDisconnected, true, 'Browser.crash must close the owned browser channel');
        await browser.close();
        browser = undefined;
        // The old port belongs only to the now-exited fixture process, never to a running profile.
        await rm(join(profile, 'DevToolsActivePort'), { force: true });
        browser = await launchDetachedBrowser(profile, extension, flavor, { flavor: 'installed' });
        control = (await browser.send('Target.createTarget', { url: popupUrl })).targetId;
        await until(
          () => browser.evaluate(control, 'typeof globalThis.chrome?.runtime?.sendMessage'),
          (value) => value === 'function',
          'restarted manager ready'
        );
        const restored = await command({ type: 'recorder.detail', sessionId: next.value.id, after: 0 });
        assert.equal(restored.ok, true);
        assert.equal(restored.value.session.status, 'interrupted');
        assert.ok(restored.value.events.length > 0);
        assert.equal((await command({ type: 'recorder.status' })).value.active, null);
        result.crash = {
          mechanism: 'Browser.crash on isolated owned browser process',
          interrupted: true,
          committedEvents: restored.value.events.length,
          gaps: restored.value.session.gaps,
        };
        const permissionUrl = url + '-permissions';
        const permissionTab = await browser.evaluate(
          control,
          `chrome.tabs.create({url:${JSON.stringify(permissionUrl)},active:false})`
        );
        await until(
          () => browser.evaluate(control, `chrome.tabs.get(${permissionTab.id})`),
          (value) => value.status === 'complete',
          'permission fixture loaded'
        );
        const permissionSession = await command({
          type: 'recorder.start',
          tabId: permissionTab.id,
          includeRelated: false,
        });
        assert.equal(permissionSession.ok, true);
        await until(
          () => command({ type: 'recorder.status' }),
          (reply) => !!reply.value?.active?.pages[0].documentId,
          'permission fixture producer'
        );
        const settings = (
          await browser.send('Target.createTarget', {
            url: `chrome://extensions/?id=${identity.sideloadExtensionId}`,
          })
        ).targetId;
        await until(
          () =>
            browser.evaluate(
              settings,
              `(async () => {
          const elements = [];
          const scan = (root) => { for (const element of root.querySelectorAll('*')) { elements.push(element); if (element.shadowRoot) scan(element.shadowRoot); } };
          scan(document);
          const select = elements.find(element => element.tagName === 'SELECT' && ['hostAccess','newHostAccess'].includes(element.id));
          const combo = elements.find(element => element.getAttribute('role') === 'combobox');
          if (!select && combo) { combo.click(); await new Promise(resolve => setTimeout(resolve,100)); elements.length=0; scan(document); }
          const edgeOption = elements.find(element => element.tagName === 'FLUENT-OPTION' && element.getAttribute('value') === 'ON_CLICK');
          if (!select && edgeOption) { edgeOption.click(); return {changed:true}; }
          if (!select) return {changed:false, page:location.href, options:elements.filter(element => element.getAttribute('role') === 'option' || /option/i.test(element.tagName)).map(element => element.outerHTML.slice(0,1000)), controls:elements.filter(element => ['SELECT','BUTTON'].includes(element.tagName) || element.getAttribute('role') === 'combobox').map(element => element.outerHTML.slice(0,600)).slice(-15), text:document.body?.innerText.slice(-2000)};
          select.value = chrome.developerPrivate.HostAccess.ON_CLICK;
          select.dispatchEvent(new Event('change',{bubbles:true}));
          return {changed:true};
        })()`
            ),
          (value) => value.changed,
          'change only owned extension site access through settings UI'
        );
        await until(
          () =>
            browser.evaluate(
              control,
              `chrome.permissions.contains({origins:[${JSON.stringify(new URL(url).origin + '/*')}]})`
            ),
          (value) => value === false,
          'real host permission withheld'
        );
        const revoked = await until(
          () => command({ type: 'recorder.detail', sessionId: permissionSession.value.id, after: 0 }),
          (reply) => reply.value?.session.status === 'interrupted',
          'real permission revocation interrupts capture'
        );
        assert.equal(revoked.value.session.pages[0].included, false);
        result.permission = {
          mechanism: 'owned extension settings site-access select -> ON_CLICK',
          realPermissionDenied: true,
          interrupted: true,
        };
        await writeFile(join(temporary, 'result.json'), JSON.stringify(result, null, 2));
        console.log(`Lifecycle evidence: ${temporary}`);
      } catch (error) {
        await writeFile(
          join(temporary, 'failure.json'),
          JSON.stringify({ ...result, error: String(error) }, null, 2)
        );
        console.log(`Lifecycle failure evidence: ${temporary}`);
        throw error;
      } finally {
        await browser?.close();
        await new Promise((resolve) => server.close(resolve));
        for (const path of [profile, extension]) {
          assert.ok(resolve(path).startsWith(resolve(temporary) + '\\'));
          await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        }
      }
    }
  );
}
