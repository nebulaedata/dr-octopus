/**
 * @author Codex
 * @description Exercises quick phrase configuration, responsive cards, mode submission and draft preservation.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { installStartFixture, notifyStart } from './conversation-start-fixture.mjs';

let browser;
let server;
let baseURL = process.env.E2E_BASE_URL;
const artifacts = join(tmpdir(), 'octopus-snippets-qa');
before(async () => {
  if (!baseURL) {
    const outDir = 'node_modules/.playwright-snippets-build';
    await build({ logLevel: 'error', build: { outDir, emptyOutDir: true } });
    server = await preview({ build: { outDir }, preview: { host: '127.0.0.1', port: 0 } });
    baseURL = server.resolvedUrls.local[0];
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  await mkdir(artifacts, { recursive: true });
});

test('quick phrase blocks duplicate starts and remains retryable after admission rejection', async (t) => {
  const page = await browser.newPage({ locale: 'en-US' });
  t.after(() => page.close());
  await installStartFixture(page);
  await page.addInitScript(() =>
    globalThis.localStorage.setItem(
      'dr-octopus.snippets.v1',
      JSON.stringify({
        state: {
          snippets: [
            { id: 'retry', title: 'Review project', message: 'Review the project', workMode: 'plan' },
          ],
        },
        version: 0,
      })
    )
  );
  let posts = 0;
  let release;
  const admission = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/workspaces/*/conversation-starts**', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posts++;
    await admission;
    return route.fulfill({
      status: 400,
      json: { code: 'CONVERSATION_START_INVALID', message: 'Please try again' },
    });
  });
  await page.goto(new URL('/workspaces/workspace-e2e', baseURL).href);
  await expect(page.getByRole('button', { name: 'Model and thinking settings' })).toHaveAttribute(
    'title',
    'Model'
  );
  const card = page.getByRole('region', { name: 'Quick phrases' }).getByRole('button');
  await card.evaluate((button) => {
    button.click();
    button.click();
  });
  await expect(card).toBeDisabled();
  await expect.poll(() => posts).toBe(1);
  release();
  await expect(page.getByText('Please try again', { exact: true })).toBeVisible();
  await expect(card).toBeEnabled();
  await card.click();
  await expect.poll(() => posts).toBe(2);
});
after(async () => {
  await browser?.close();
  if (server) {
    server.httpServer.closeAllConnections();
    await new Promise((resolve) => server.httpServer.close(resolve));
  }
});

for (const width of [1280, 390, 320]) {
  test(`fill action stays editable, persists and sends only on request at ${width}px`, async (t) => {
    const page = await browser.newPage({ locale: 'en-US', viewport: { width, height: 1000 } });
    t.after(() => page.close());
    const state = await installStartFixture(page);
    await page.goto(new URL('/settings/appearance/snippets', baseURL).href);
    await page.getByRole('button', { name: 'Add phrase', exact: true }).click();
    await page.getByLabel('Card title', { exact: true }).fill('Draft a plan');
    await page.getByLabel('Message', { exact: true }).fill('Plan my project');
    await page.getByRole('combobox', { name: 'Agent Modes' }).click();
    await page.getByRole('option', { name: 'Plan', exact: true }).click();
    await page.getByRole('button', { name: 'Fill', exact: true }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Quick phrases saved', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Fill', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await page.screenshot({ animations: 'disabled', path: join(artifacts, `fill-settings-${width}.png`) });
    await page.goto(new URL('/workspaces/workspace-e2e', baseURL).href);
    const editor = page.getByRole('textbox', { name: 'Message Dr.Octopus' });
    await expect(page.getByRole('button', { name: 'Model and thinking settings' })).toHaveAttribute(
      'title',
      'Model'
    );
    await editor.fill('Previous text');
    const card = page.getByRole('region', { name: 'Quick phrases' }).getByRole('button');
    await expect(card).toContainText('Click to fill');
    await card.click();
    await expect(editor).toHaveText('Plan my project');
    await expect(editor).toBeFocused();
    await expect(page.getByRole('combobox', { name: 'Agent work mode' })).toContainText('Plan');
    assert.equal(state.posts.length, 0);
    await page.reload();
    await expect(editor).toHaveText('Plan my project');
    await card.click();
    await expect(editor).toBeFocused();
    await editor.press('End');
    await editor.pressSequentially(' carefully');
    await expect(editor).toHaveText('Plan my project carefully');
    assert.equal(state.posts.length, 0);
    await page.screenshot({ animations: 'disabled', path: join(artifacts, `fill-home-${width}.png`) });
    await editor.press('Enter');
    await expect(page).toHaveURL(/sessions\/session-e2e/);
    assert.equal(state.posts.length, 1);
    assert.equal(state.posts[0].message, 'Plan my project carefully');
    assert.equal(state.posts[0].controls.workMode, 'plan');
  });
  test(`configure four phrases, reload and send bound mode at ${width}px`, async (t) => {
    const page = await browser.newPage({
      locale: 'en-US',
      viewport: { width, height: 1000 },
      reducedMotion: 'reduce',
    });
    t.after(() => page.close());
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const state = await installStartFixture(page);
    await page.goto(new URL('/settings/appearance/snippets', baseURL).href);
    await expect(page.getByText('Your next conversation, one click away')).toBeVisible({ timeout: 30000 });
    for (let index = 0; index < 4; index++) {
      await page.getByRole('button', { name: 'Add phrase', exact: true }).click();
      await page
        .getByLabel('Card title', { exact: true })
        .nth(index)
        .fill(
          [
            'Plan my next project',
            'Explore my knowledge',
            'Review this workspace',
            'A deliberately long title to verify compact card truncation',
          ][index]
        );
      await page
        .getByLabel('Message', { exact: true })
        .nth(index)
        .fill(`Request ${index}: help me understand the project and suggest clear next steps.`);
      if (index < 2) {
        await page.getByRole('combobox', { name: 'Agent Modes' }).nth(index).click();
        await page.getByRole('option', { name: index === 0 ? 'Plan' : 'Knowledge Q&A', exact: true }).click();
      }
    }
    await expect(page.getByRole('button', { name: 'Add phrase', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Quick phrases saved', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Card title', { exact: true })).toHaveCount(4);
    await page.screenshot({ animations: 'disabled', path: join(artifacts, `settings-${width}.png`) });
    await page.goto(new URL('/workspaces/workspace-e2e', baseURL).href);
    const cards = page.getByRole('region', { name: 'Quick phrases' }).getByRole('button');
    await expect(cards).toHaveCount(4);
    await expect(page.getByRole('button', { name: 'Model and thinking settings' })).toHaveAttribute(
      'title',
      'Model'
    );
    const first = await cards.nth(0).boundingBox();
    const second = await cards.nth(1).boundingBox();
    assert.equal(first.y === second.y, width >= 640);
    assert.equal(
      await page.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth),
      false
    );
    await page.screenshot({ animations: 'disabled', path: join(artifacts, `home-${width}.png`) });
    await page.evaluate(() => globalThis.document.documentElement.classList.add('dark'));
    await page.screenshot({ animations: 'disabled', path: join(artifacts, `home-dark-${width}.png`) });
    const editor = page.getByRole('textbox', { name: 'Message Dr.Octopus' });
    await editor.fill('Keep my existing draft');
    await cards.nth(width === 390 ? 1 : width === 320 ? 2 : 0).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/sessions\/session-e2e/);
    assert.equal(state.posts.length, 1);
    assert.equal(
      state.posts[0].controls.workMode,
      width === 390 ? 'knowledge' : width === 320 ? 'agent' : 'plan'
    );
    assert.deepEqual(state.posts[0].attachmentIds, []);
    assert.deepEqual(state.posts[0].workspaceReferences, []);
    state.result.status = 'accepted';
    state.published = true;
    await notifyStart(page);
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.values(JSON.parse(sessionStorage.getItem('octopus-home-drafts')).state.drafts).some(
            (draft) => draft.submission
          )
        )
      )
      .toBe(false);
    await page.goto(new URL('/workspaces/workspace-e2e', baseURL).href);
    await expect(editor).toHaveText('Keep my existing draft');
    await page.goto(new URL('/settings/appearance/snippets', baseURL).href);
    await page.getByRole('button', { name: 'Remove phrase 4', exact: true }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.reload();
    await expect(page.getByLabel('Card title', { exact: true })).toHaveCount(3);
    assert.deepEqual(errors, []);
  });
}
