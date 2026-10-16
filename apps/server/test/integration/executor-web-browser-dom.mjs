/**
 * @author Codex
 * @description Verifies finite same-origin frame, open-shadow and dynamic-page contracts through real Web Browser calls against a deterministic owned page.
 */
import assert from 'node:assert/strict';

/**
 * Keeps external page mutations in the fixture and all product observations/actions in the actual Web Agent.
 */
export function createWebBrowserDom({ expect, clicks }) {
  let evidence;
  /**
   * Requires fresh source references for supported scopes and explicit refusal for unmonitorable frame trees.
   */
  async function* steps({ task, tabId, page, target, url }) {
    const common = { taskId: task.taskId, tabId };
    const initial = clicks();
    await page.evaluate(() => {
      globalThis.document.body.style.minHeight = '4000px';
      const frame = globalThis.document.createElement('iframe');
      frame.srcdoc = `<button onclick="parent.fetch('/clicked')">Frame action</button>`;
      globalThis.document.body.prepend(frame);
      const host = globalThis.document.createElement('div');
      globalThis.document.body.prepend(host);
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<button>Shadow action</button>';
      shadow.querySelector('button').onclick = () => fetch('/clicked');
      globalThis.ownedShadow = shadow;
    });
    await page.waitForFunction(() =>
      globalThis.document.querySelector('iframe').contentDocument?.querySelector('button')
    );
    const frame = yield { tool: 'browser_snapshot', args: common };
    assert.ok(frame.text.includes('Shadow action'));
    await page.evaluate(() => {
      globalThis.document.querySelector('iframe').contentDocument.querySelector('button').textContent =
        'Frame changed';
    });
    yield {
      tool: 'browser_click',
      args: { ...common, target: target(frame, 'Frame action'), idempotencyKey: 'web-frame-dirty' },
      expectedError: 'STALE_SNAPSHOT',
    };
    assert.equal(clicks(), initial);
    const current = yield { tool: 'browser_snapshot', args: common };
    yield {
      tool: 'browser_click',
      args: { ...common, target: target(current, 'Frame changed'), idempotencyKey: 'web-frame-fresh' },
    };
    await expect.poll(clicks).toBe(initial + 1);
    const shadow = yield { tool: 'browser_snapshot', args: common };
    await page.evaluate(() => {
      globalThis.ownedShadow.querySelector('button').textContent = 'Shadow changed';
    });
    yield {
      tool: 'browser_click',
      args: { ...common, target: target(shadow, 'Shadow action'), idempotencyKey: 'web-shadow-dirty' },
      expectedError: 'STALE_SNAPSHOT',
    };
    const fresh = yield { tool: 'browser_snapshot', args: common };
    yield {
      tool: 'browser_click',
      args: { ...common, target: target(fresh, 'Shadow changed'), idempotencyKey: 'web-shadow-fresh' },
    };
    await expect.poll(clicks).toBe(initial + 2);
    const beforeSpa = yield { tool: 'browser_snapshot', args: common };
    await page.evaluate(() => globalThis.history.pushState({}, '', '/owned-spa'));
    const { documentId, controllerId, snapshotId } = beforeSpa;
    yield {
      tool: 'browser_scroll',
      args: {
        ...common,
        target: { documentId, controllerId, snapshotId },
        direction: 'down',
        pixels: 1,
        idempotencyKey: 'web-spa-stale',
      },
      expectedError: 'TARGET_CHANGED',
    };
    await page.evaluate(
      (url) => {
        globalThis.document.querySelector('iframe').removeAttribute('srcdoc');
        globalThis.document.querySelector('iframe').src = url;
      },
      url.replace('octopus-browser.test', 'localhost') + '/cross-origin'
    );
    await expect
      .poll(() => page.evaluate(() => globalThis.document.querySelector('iframe').contentDocument === null))
      .toBe(true);
    yield { tool: 'browser_snapshot', args: common, expectedError: 'FORBIDDEN_PAGE' };
    await page.evaluate(() => {
      globalThis.document.querySelector('iframe').srcdoc =
        `<iframe srcdoc="<button>Nested frame</button>"></iframe>`;
    });
    await page.waitForFunction(() =>
      globalThis.document
        .querySelector('iframe')
        .contentDocument?.querySelector('iframe')
        ?.contentDocument?.querySelector('button')
    );
    yield { tool: 'browser_snapshot', args: common, expectedError: 'FORBIDDEN_PAGE' };
    assert.equal(clicks(), initial + 2);
    await page.evaluate(() => globalThis.document.querySelector('iframe').remove());
    const recovered = yield { tool: 'browser_snapshot', args: common };
    assert.ok(recovered.text.includes('Shadow changed'));
    yield { tool: 'browser_close_tab', args: { ...common, idempotencyKey: 'web-dom-close' } };
    yield { tool: 'task_end', args: { taskId: task.taskId } };
    evidence = {
      sameOriginFrame: true,
      openShadow: true,
      mutationsRefused: true,
      spaRefused: true,
      crossOriginFrameRefused: true,
      nestedFrameRefused: true,
      explicitEffects: 2,
      replayed: false,
    };
    console.log(JSON.stringify({ stage: 'browser-dom-verified', ...evidence }));
  }
  return { steps, evidence: () => evidence };
}
