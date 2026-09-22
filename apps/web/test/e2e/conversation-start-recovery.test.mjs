/**
 * @author Codex
 * @description Verifies process-independent onboarding, saved input, model intent and durable HTTP submission.
 */
import { before, after, test } from 'node:test';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { installStartFixture, notifyStart, submitStart } from './conversation-start-fixture.mjs';

let server;
let browser;
let baseURL;
before(async () => {
  baseURL = process.env.E2E_BASE_URL;
  if (!baseURL) {
    const outDir = 'node_modules/.playwright-start-audit-build';
    await build({ logLevel: 'error', build: { outDir, emptyOutDir: true } });
    server = await preview({ build: { outDir }, preview: { host: '127.0.0.1', port: 0, open: false } });
    baseURL = server.resolvedUrls.local[0];
  }
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    headless: process.env.E2E_HEADED !== '1',
  });
  await mkdir('.playwright-artifacts', { recursive: true });
});
after(async () => {
  await browser?.close();
  if (server) {
    server.httpServer.closeAllConnections();
    await new Promise((resolve) => server.httpServer.close(resolve));
  }
});

/**
 * A durable failed receipt still holds every public input needed to restore a new browser tab.
 */
function failedReceipt() {
  const draft = {
    submissionId: '11111111-1111-4111-8111-111111111111',
    draftId: '22222222-2222-4222-8222-222222222222',
    draftVersion: 2,
    message: 'Read @README.md',
    workspaceReferences: [{ path: 'README.md', kind: 'file' }],
    attachmentIds: ['saved-attachment'],
    selection: { mode: 'explicit', provider: 'p', modelId: 'm' },
    controls: {
      workMode: 'knowledge',
      permissionMode: 'full',
      knowledge: { collectionIds: ['saved-source'] },
    },
  };
  return {
    submissionId: draft.submissionId,
    sessionId: 'session-e2e',
    message: draft.message,
    status: 'failed',
    draft,
  };
}

/**
 * Exposes an existing attachment without uploading bytes or running document processing.
 */
async function attachmentFixture(page) {
  await page.route('**/api/workspaces/*/attachments?*', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 'saved-attachment',
            name: 'saved.txt',
            byteSize: 8,
            revision: 1,
            status: 'ready',
            detectedMediaType: 'text/plain',
            presentationKind: 'document',
          },
        ],
      },
    })
  );
}

test('a definitive admission rejection unlocks the original input for editing and a fresh submission', async (t) => {
  const page = await browser.newPage({ locale: 'en-US' });
  t.after(() => page.close());
  const state = await installStartFixture(page);
  let rejected;
  await page.route('**/api/workspaces/*/conversation-starts', (route) => {
    if (!rejected && route.request().method() === 'POST') {
      rejected = route.request().postDataJSON();
      return route.fulfill({
        status: 400,
        json: { code: 'CONVERSATION_START_INVALID', message: 'Rejected before admission' },
      });
    }
    return route.fallback();
  });
  await page.goto(new URL('/workspaces/workspace-e2e', baseURL).href);
  await expect(page.getByRole('button', { name: 'Model and thinking settings' })).toHaveAttribute(
    'title',
    'Model'
  );
  const editor = page.getByRole('textbox', { name: 'Message Dr.Octopus' });
  await editor.fill('Rejected input');
  await editor.press('Enter');
  await expect(page.getByText('Rejected before admission')).toBeVisible();
  await expect(editor).toBeEditable();
  await editor.fill('Corrected input');
  await editor.press('Enter');
  await expect(page).toHaveURL(/sessions\/session-e2e/);
  expect(state.posts[0].message).toBe('Corrected input');
  expect(state.posts[0].submissionId).not.toBe(rejected.submissionId);
});

test('a failed deep link restores controls, source scope, attachments and real mention nodes without local storage', async (t) => {
  const page = await browser.newPage({ locale: 'en-US' });
  t.after(() => page.close());
  const state = await installStartFixture(page);
  state.result = failedReceipt();
  await attachmentFixture(page);
  await page.goto(new URL('/workspaces/workspace-e2e/sessions/session-e2e', baseURL).href);
  await page.getByRole('button', { name: 'Return to draft' }).click();
  await expect(page).toHaveURL(/workspaces\/workspace-e2e$/);
  const editor = page.getByRole('textbox', { name: 'Message Dr.Octopus' });
  await expect(editor).toHaveText('Read @README.md');
  await expect(editor.locator('[data-reference-path="README.md"]')).toBeVisible();
  await expect(page.getByText('Selected collections (1)', { exact: true })).toBeVisible();
  await expect(page.getByText('saved.txt', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  const expected = state.result.draft;
  await editor.press('Enter');
  await expect(page).toHaveURL(/sessions\/session-e2e/);
  expect(state.posts[0].controls).toEqual(expected.controls);
  expect(state.posts[0].selection).toEqual(expected.selection);
  expect(state.posts[0].workspaceReferences).toEqual(expected.workspaceReferences);
  expect(state.posts[0].attachmentIds).toEqual(expected.attachmentIds);
});

test('recovery cannot overwrite a newer workspace draft', async (t) => {
  const page = await browser.newPage({ locale: 'en-US' });
  t.after(() => page.close());
  const state = await installStartFixture(page);
  state.result = failedReceipt();
  await attachmentFixture(page);
  await page.goto(new URL('/workspaces/workspace-e2e', baseURL).href);
  await page.getByRole('textbox', { name: 'Message Dr.Octopus' }).fill('Keep my newer work');
  await page.goto(new URL('/workspaces/workspace-e2e/sessions/session-e2e', baseURL).href);
  await page.getByRole('button', { name: 'Return to draft' }).click();
  await expect(
    page.getByText('Another draft already contains input. Finish or clear it before restoring this message.')
  ).toBeVisible();
  await page.getByRole('link', { name: 'Open current draft' }).click();
  await expect(page.getByRole('textbox', { name: 'Message Dr.Octopus' })).toHaveText('Keep my newer work');
  expect(state.posts.length).toBe(0);
});

test('attachment lookup failure keeps the receipt recoverable and cannot silently drop files', async (t) => {
  const page = await browser.newPage({ locale: 'en-US' });
  t.after(() => page.close());
  const state = await installStartFixture(page);
  state.result = failedReceipt();
  await attachmentFixture(page);
  let unavailable = true;
  await page.route('**/api/workspaces/*/attachments?*', (route) =>
    unavailable
      ? route.fulfill({ status: 503, json: { message: 'Attachment lookup unavailable' } })
      : route.fallback()
  );
  await page.goto(new URL('/workspaces/workspace-e2e/sessions/session-e2e', baseURL).href);
  await page.getByRole('button', { name: 'Return to draft' }).click();
  await expect(page.getByText('Attachment lookup unavailable')).toBeVisible();
  await expect(page).toHaveURL(/sessions\/session-e2e/);
  unavailable = false;
  await page.getByRole('button', { name: 'Return to draft' }).click();
  await expect(page.getByText('saved.txt', { exact: true })).toBeVisible();
  expect(state.posts.length).toBe(0);
});

test('receipt publication alone reconciles the catalog and keeps saved text visible while bootstrap is delayed', async (t) => {
  const page = await browser.newPage({ locale: 'en-US' });
  t.after(() => page.close());
  const messages = [];
  const state = await installStartFixture(page, messages);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  t.after(() => release());
  await page.route(/\/(bootstrap|history)(\?|$)/, async (route) => {
    await gate;
    await route.fallback();
  });
  await submitStart(page, 'Keep the admitted message visible', baseURL);
  state.result.status = 'running';
  state.published = true;
  await notifyStart(page);
  await expect.poll(() => state.bootstraps).toBeGreaterThan(0);
  await expect(page.getByText('Connecting to Agent…', { exact: true })).toBeVisible();
  await expect(page.getByText('Keep the admitted message visible', { exact: true })).toBeVisible();
  messages.push({
    id: 'first',
    role: 'user',
    content: [{ type: 'text', text: 'Keep the admitted message visible' }],
    entryId: 'entry-first',
    timestamp: 1,
  });
  release();
  await expect(page.getByRole('button', { name: 'Fork session from this message' })).toBeEnabled();
  await expect(page.getByText('Keep the admitted message visible', { exact: true })).toHaveCount(1);
});

test('a completed receipt for a deleted session reaches not-found instead of waiting indefinitely', async (t) => {
  const page = await browser.newPage({ locale: 'en-US' });
  t.after(() => page.close());
  const state = await installStartFixture(page);
  state.result = { ...failedReceipt(), status: 'running', draft: undefined };
  await page.goto(new URL('/workspaces/workspace-e2e/sessions/session-e2e', baseURL).href);
  await expect(page.getByText('Session not found', { exact: true })).toBeVisible();
  expect(state.bootstraps).toBe(0);
});

test('rejection of a retry cannot discard the identity of an earlier ambiguous submission', async (t) => {
  const page = await browser.newPage({ locale: 'en-US' });
  t.after(() => page.close());
  await installStartFixture(page);
  const requests = [];
  await page.route('**/api/workspaces/*/conversation-starts', (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) return route.abort('failed');
    if (requests.length === 2)
      return route.fulfill({
        status: 503,
        json: { code: 'CONVERSATION_START_CLOSED', message: 'Service unavailable before retry' },
      });
    return route.fallback();
  });
  await page.goto(new URL('/workspaces/workspace-e2e', baseURL).href);
  await expect(page.getByRole('button', { name: 'Model and thinking settings' })).toHaveAttribute(
    'title',
    'Model'
  );
  const editor = page.getByRole('textbox', { name: 'Message Dr.Octopus' });
  await editor.fill('Keep this request identity');
  await editor.press('Enter');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('Service unavailable before retry')).toBeVisible();
  await expect(editor).not.toBeEditable();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page).toHaveURL(/sessions\/session-e2e/);
  expect(requests.map((item) => item.submissionId)).toEqual(Array(3).fill(requests[0].submissionId));
});

test('home thinking choices follow the actual model catalog including extended levels', async (t) => {
  const page = await browser.newPage({ locale: 'en-US' });
  t.after(() => page.close());
  const state = await installStartFixture(page);
  await page.route('**/api/conversation-models', (route) =>
    route.fulfill({
      json: {
        models: [
          {
            provider: 'p',
            id: 'm',
            name: 'Model',
            reasoning: true,
            input: ['text'],
            thinkingLevels: ['off', 'high', 'xhigh', 'max'],
          },
        ],
        defaults: {
          configured: true,
          available: true,
          providerId: 'p',
          modelId: 'm',
          effect: 'new_sessions',
        },
      },
    })
  );
  await page.goto(new URL('/workspaces/workspace-e2e', baseURL).href);
  const picker = page.getByRole('button', { name: 'Model and thinking settings' });
  await expect(picker).toHaveAttribute('title', 'Model');
  await picker.click();
  await page.getByRole('menuitem', { name: /^Thinking level/ }).hover();
  await expect(page.getByRole('menuitemradio', { name: 'low', exact: true })).toHaveCount(0);
  await page.getByRole('menuitemradio', { name: 'max', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Message Dr.Octopus' });
  await editor.fill('Use the supported maximum reasoning level');
  await editor.press('Enter');
  await expect(page).toHaveURL(/sessions\/session-e2e/);
  expect(state.posts[0].controls.thinkingLevel).toBe('max');
});
