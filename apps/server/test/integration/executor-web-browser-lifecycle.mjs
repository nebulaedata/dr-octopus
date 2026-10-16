/**
 * @author Codex
 * @description Verifies actual Web calls against detached frozen/discarded tabs and ordinary tab/window activation, refusing explicit unfreeze or reload substitutes.
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { launchDetachedBrowser } from '../../../executor/test/integration/detached-browser.mjs';

const deepElements = `const all=[];function visit(root){for(const item of root.querySelectorAll('*')){
  all.push(item);if(item.shadowRoot)visit(item.shadowRoot);}}visit(document);`;

/**
 * Owns one detached installed browser; only internal/extension control targets receive fixture debugger sessions.
 */
export function createWebBrowserLifecycle({ root, extensionId, browserName, expect, clicks, environment }) {
  let browser;
  let control;
  let evidence;

  /**
   * Opens an extension resource as a separate test control target without attaching to any website.
   */
  async function start(extension) {
    browser = await launchDetachedBrowser(join(root, 'detached-controlled'), extension, browserName, {
      flavor: 'installed',
      environment,
      startupTimeoutMs: 30000,
    });
    const version = await browser.send('Browser.getVersion');
    control = (
      await browser.send('Target.createTarget', {
        url: 'chrome-extension://' + extensionId + '/manifest.json',
      })
    ).targetId;
    await expect
      .poll(() => browser.evaluate(control, 'typeof chrome.tabs'), { timeout: 10000 })
      .toBe('object');
    await expect.poll(async () => (await storage()).bridgeStatus, { timeout: 70000 }).toBe('connected');
    return version.product;
  }

  /**
   * Reads persisted bridge evidence through an owned extension document, including after Worker replacement.
   */
  function storage() {
    return browser.evaluate(control, "chrome.storage.local.get('bridgeStatus')");
  }

  /**
   * Keeps the website detached while refusing invalid references; ordinary activation must actually clear frozen/discarded state.
   */
  async function* steps({ url, target }) {
    const status = yield { tool: 'runtime_status', args: {} };
    assert.equal(status.computer.available, false);
    const connections = yield { tool: 'browser_list', args: {} };
    console.log(
      JSON.stringify({
        stage: 'web-lifecycle-connections',
        connections: connections.connections,
        storage: await storage(),
      })
    );
    const connected = connections.connections.filter((item) => item.state === 'connected');
    assert.equal(connected.length, 1, 'Lifecycle tools require exactly one live Runtime connection');
    const connectionId = connected[0].connectionId;
    const task = yield {
      tool: 'task_start',
      args: { capabilities: ['browser'], connectionId, idempotencyKey: 'web-lifecycle-task' },
    };
    const common = { taskId: task.taskId };
    const opened = yield {
      tool: 'browser_open_tab',
      args: { ...common, url: url + '/lifecycle', idempotencyKey: 'web-lifecycle-open' },
    };
    let tabId = opened.tabId;
    /**
     * Uses browser-owned Tab metadata, without website attachment or document script evaluation.
     */
    const tab = () => browser.evaluate(control, `chrome.tabs.get(${tabId})`);
    await expect.poll(async () => (await tab()).status).toBe('complete');
    const keeper = await browser.evaluate(
      control,
      `(async()=>chrome.tabs.create({windowId:(await chrome.tabs.get(${tabId})).windowId,url:'about:blank',active:true}))()`
    );
    const internal = (await browser.send('Target.createTarget', { url: 'chrome://chrome-urls' })).targetId;
    await expect.poll(() => browser.evaluate(internal, 'document.readyState')).toBe('complete');
    await browser.evaluate(
      internal,
      `(()=>{${deepElements}const button=all.find(item=>item.matches('button,cr-button,[role="button"]')&&/Enable internal debugging pages|启用.*调试页面/.test(item.textContent));button?.click();})()`
    );
    await browser.evaluate(internal, 'location.href="chrome://discards"');
    const records = [];
    const selectedState = process.env.EXECUTOR_WEB_BROWSER_LIFECYCLE_STATE;
    assert.ok(!selectedState || ['frozen', 'discarded'].includes(selectedState));
    const states = selectedState ? [selectedState] : ['frozen', 'discarded'];
    for (const state of states) {
      const before = yield { tool: 'browser_snapshot', args: { ...common, tabId } };
      const oldId = tabId;
      await browser.evaluate(control, `chrome.tabs.update(${keeper.id},{active:true})`);
      const website = (await browser.send('Target.getTargets')).targetInfos.find(
        (item) => item.url === url + '/lifecycle'
      );
      assert.equal(website.attached, false);
      if (state === 'frozen') {
        await expect
          .poll(() =>
            browser.evaluate(
              internal,
              `(()=>{${deepElements}
          const row=all.find(item=>item.tagName==='TR'&&[...item.querySelectorAll('td')].some(cell=>cell.textContent.trim()===${JSON.stringify(url + '/lifecycle')}));
          const freeze=row&&[...row.querySelectorAll('[is="action-link"]')].find(item=>item.textContent.trim()==='[Freeze]');if(freeze){freeze.click();return true;}return false;})()`
            )
          )
          .toBe(true);
      } else tabId = (await browser.evaluate(control, `chrome.tabs.discard(${tabId})`)).id;
      const tabs = yield { tool: 'browser_tabs', args: { connectionId } };
      assert.ok(tabs.tabs.some((item) => item.tabId === tabId));
      await expect.poll(async () => (await tab())[state]).toBe(true);
      console.log(JSON.stringify({ stage: 'web-lifecycle-before-refusal', state, tab: await tab() }));
      yield {
        tool: 'browser_snapshot',
        args: { ...common, tabId: oldId },
        expectedError: tabId === oldId ? 'TAB_NOT_EXECUTABLE' : 'TARGET_CHANGED',
      };
      console.log(JSON.stringify({ stage: 'web-lifecycle-after-snapshot-refusal', state, tab: await tab() }));
      assert.equal((await tab())[state], true, 'Snapshot refusal must preserve the actual lifecycle state');
      yield {
        tool: 'browser_click',
        args: {
          ...common,
          tabId: oldId,
          target: target(before, 'Fixture click'),
          idempotencyKey: 'web-' + state + '-refused',
        },
        expectedError: tabId === oldId ? 'TAB_NOT_EXECUTABLE' : 'TARGET_CHANGED',
      };
      assert.equal((await tab())[state], true);
      console.log(
        JSON.stringify({
          stage: 'web-lifecycle-refusal-verified',
          state,
          oldId,
          tabId,
          websiteDetached: true,
        })
      );
      const count = clicks();
      const nativeEvidence = process.env.EXECUTOR_WEB_NATIVE_ACTIVATION_EVIDENCE;
      const activationId = randomUUID();
      await browser.evaluate(
        control,
        `(async()=>{const tab=await chrome.tabs.get(${tabId});await chrome.windows.update(tab.windowId,{state:'normal',left:100,top:100,width:1000,height:750,focused:true});${nativeEvidence ? '' : 'await chrome.tabs.update(tab.id,{active:true});'}})()`
      );
      console.log(
        JSON.stringify({
          stage: 'web-lifecycle-activation',
          state,
          tab: await browser.evaluate(
            control,
            `(async()=>{const tab=await chrome.tabs.get(${tabId});const window=await chrome.windows.get(tab.windowId);return {active:tab.active,frozen:tab.frozen,discarded:tab.discarded,status:tab.status,windowFocused:window.focused,windowState:window.state};})()`
          ),
          internal: await browser.evaluate(
            internal,
            String.raw`(()=>{${deepElements}const row=all.find(item=>item.tagName==='TR'&&[...item.querySelectorAll('td')].some(cell=>cell.textContent.trim()===${JSON.stringify(url + '/lifecycle')}));return row?.textContent.replace(/\s+/g,' ').trim();})()`
          ),
        })
      );
      if (nativeEvidence) {
        // Wait for a real desktop click, separately from the unchanged Browser recovery deadline.
        await writeFile(
          join(nativeEvidence, 'activation-ready.json'),
          JSON.stringify({ activationId, browserName, state, tabId, title: 'Owned Web Browser fixture' })
        );
        await expect
          .poll(
            async () => {
              try {
                const performed = JSON.parse(
                  await readFile(join(nativeEvidence, 'activation-performed.json'), 'utf8')
                );
                return performed.activationId === activationId && performed.ordinaryTabActivation === true;
              } catch (error) {
                if (error.code === 'ENOENT') return false;
                throw error;
              }
            },
            { timeout: 120000 }
          )
          .toBe(true);
      }
      // No Page.setWebLifecycleState, tabs.reload or navigation fallback may satisfy this assertion.
      await expect
        .poll(async () => ({ state: (await tab())[state], status: (await tab()).status }), { timeout: 20000 })
        .toEqual({ state: false, status: 'complete' });
      const recovered = yield { tool: 'browser_snapshot', args: { ...common, tabId } };
      assert.equal(clicks(), count);
      if (state === 'discarded') assert.notEqual(recovered.documentId, before.documentId);
      yield {
        tool: 'browser_click',
        args: {
          ...common,
          tabId,
          target: target(before, 'Fixture click'),
          idempotencyKey: 'web-' + state + '-old-reference',
        },
        expectedError: 'SNAPSHOT_EXPIRED',
      };
      assert.equal(clicks(), count);
      yield {
        tool: 'browser_click',
        args: {
          ...common,
          tabId,
          target: target(recovered, 'Fixture click'),
          idempotencyKey: 'web-' + state + '-explicit',
        },
      };
      await expect.poll(clicks).toBe(count + 1);
      records.push({
        state,
        oldId,
        tabId,
        ordinaryActivation: true,
        activation: nativeEvidence ? 'user-click' : 'tabs-api',
        websiteDetached: true,
        oldReferenceRejected: true,
        effects: 1,
      });
    }
    yield { tool: 'task_end', args: common };
    evidence = { records, replayed: false, explicitUnfreeze: false, explicitReload: false };
    console.log(JSON.stringify({ stage: 'web-lifecycle-verified', ...evidence }));
  }

  /**
   * Closes only the isolated browser process tree, even after a lifecycle assertion fails.
   */
  async function close() {
    await browser?.close();
  }
  return { start, storage, steps, close, evidence: () => evidence };
}
