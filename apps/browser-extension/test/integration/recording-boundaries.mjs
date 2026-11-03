/**
 * @author Codex
 * @description Exercises real window movement and out-of-scope navigation without touching daily profiles.
 */
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
/* global chrome */

/**
 * Verifies exclusion persists after returning to the original window or authorized origin.
 */
export async function verifyRecordingBoundaries(context, popup, siteUrl) {
  for (const scenario of ['window', 'redirect']) {
    const page = await context.newPage();
    await page.goto(siteUrl + '/boundary-' + scenario);
    const tab = await popup.evaluate(
      async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url),
      page.url()
    );
    const started = await popup.evaluate(
      (tabId) => chrome.runtime.sendMessage({ type: 'recorder.start', tabId, includeRelated: true }),
      tab.id
    );
    assert.equal(started.ok, true);
    const toolbar = page.getByRole('region', { name: 'Dr.Octopus 录制工具栏' });
    await expect(toolbar).toBeVisible();
    if (scenario === 'window') {
      await popup.evaluate((tabId) => chrome.windows.create({ tabId, focused: false }), tab.id);
    } else {
      await page.goto(siteUrl + '/boundary-redirect-out');
      await page.waitForURL(siteUrl.replace('127.0.0.1', 'localhost') + '/outside');
    }
    await expect
      .poll(
        async () =>
          (
            await popup.evaluate(
              (sessionId) => chrome.runtime.sendMessage({ type: 'recorder.detail', sessionId }),
              started.value.id
            )
          ).value.session.status
      )
      .toBe('interrupted');
    await expect(toolbar).toHaveCount(0);
    const before = await popup.evaluate(
      (sessionId) => chrome.runtime.sendMessage({ type: 'recorder.detail', sessionId }),
      started.value.id
    );
    assert.ok(before.value.session.gaps.length > 0);
    if (scenario === 'window') {
      await popup.evaluate(({ id, windowId }) => chrome.tabs.move(id, { windowId, index: -1 }), tab);
    } else {
      await page.goto(siteUrl + '/boundary-return');
    }
    await page.bringToFront();
    await page.locator('#search').click();
    const after = await popup.evaluate(
      (sessionId) => chrome.runtime.sendMessage({ type: 'recorder.detail', sessionId }),
      started.value.id
    );
    assert.equal(after.value.session.count, before.value.session.count);
    assert.equal(
      (await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'recorder.status' }))).value.active,
      null
    );
    await expect(toolbar).toHaveCount(0);
    await page.close();
  }
  return { movedOutAndBack: true, crossOriginRedirectAndReturn: true, automaticRejoin: false };
}
