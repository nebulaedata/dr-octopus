/**
 * @author Codex
 * @description Verifies recording admission through the real Native Host and MCP task authority.
 */
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
/* global chrome */

/**
 * Starts capture from a trusted popup and verifies rejected automation has no page or focus effects.
 */
export async function verifyRecordingAdmission({
  context,
  worker,
  client,
  taskId,
  connectionId,
  tabId,
  fixture,
}) {
  const popup = await context.newPage();
  await popup.goto(new URL('popup.html', worker.url()).href);
  try {
    const started = await popup.evaluate(
      (tabId) => chrome.runtime.sendMessage({ type: 'recorder.start', tabId, includeRelated: false }),
      tabId
    );
    assert.equal(started.ok, true, JSON.stringify(started));
    const toolbar = fixture.getByRole('region', { name: 'Dr.Octopus 录制工具栏' });
    await expect(toolbar).toBeVisible();
    const listed = await client.callTool({ name: 'browser_tabs', arguments: { connectionId } });
    assert.notEqual(listed.isError, true);
    assert.ok(listed.structuredContent.data.tabs.some((tab) => tab.tabId === tabId));
    await popup.bringToFront();
    const activeBefore = await worker.evaluate(async () =>
      (await chrome.tabs.query({ active: true })).map((tab) => tab.id)
    );
    for (const paused of [false, true]) {
      if (paused) {
        await toolbar
          .getByRole('button', { name: '暂停录制', exact: true })
          .evaluate((button) => button.click());
        await expect(toolbar).toContainText('已暂停');
      }
      for (const screenshot of [true, false]) {
        const rejected = await client.callTool({
          name: 'browser_snapshot',
          arguments: { taskId, tabId, screenshot },
        });
        assert.equal(rejected.structuredContent.data.error.code, 'BROWSER_BUSY');
        assert.equal(
          rejected.content.some((block) => block.type === 'image'),
          false
        );
      }
      const denied = await client.callTool({
        name: 'browser_open_tab',
        arguments: { taskId, url: fixture.url(), idempotencyKey: 'recording-open-' + paused },
      });
      assert.equal(denied.structuredContent.data.error.code, 'BROWSER_BUSY');
      assert.deepEqual(
        await worker.evaluate(async () => (await chrome.tabs.query({ active: true })).map((tab) => tab.id)),
        activeBefore,
        'Denied automation must not steal focus while recording or paused'
      );
      assert.equal(await fixture.evaluate(() => globalThis.clicks), 0);
      assert.equal(
        (await client.callTool({ name: 'browser_tabs', arguments: { connectionId } })).structuredContent.data
          .tabs.length,
        listed.structuredContent.data.tabs.length
      );
    }
    await toolbar
      .getByRole('button', { name: '停止并保存', exact: true })
      .evaluate((button) => button.click());
    await expect(toolbar).toHaveCount(0);
    const status = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'recorder.status' }));
    assert.equal(status.ok, true);
    assert.equal(status.value.active, null);
    assert.equal(status.value.recent.length, 1);
    console.info(
      'Real Native Host recording admission passed: active/paused snapshots, focus and tab creation; capture stopped.'
    );
  } finally {
    await popup.close();
  }
}

/**
 * An observed page remains owned by automation until task cleanup; capture cannot steal its controller.
 */
export async function verifyAutomationAdmission({ context, worker, tabId }) {
  const popup = await context.newPage();
  try {
    await popup.goto(new URL('popup.html', worker.url()).href);
    const rejected = await popup.evaluate(
      (tabId) => chrome.runtime.sendMessage({ type: 'recorder.start', tabId, includeRelated: false }),
      tabId
    );
    assert.deepEqual(rejected, { ok: false, error: 'BROWSER_BUSY' });
    const status = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'recorder.status' }));
    assert.equal(status.ok, true);
    assert.equal(status.value.active, null);
    assert.equal(status.value.recent.length, 1, 'Rejected capture must not create an empty recording');
    console.info('Real Native Host automation ownership rejects capture without creating a session.');
  } finally {
    await popup.close();
  }
}
