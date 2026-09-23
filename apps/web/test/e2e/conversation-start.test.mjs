/**
 * @author Codex
 * @description Verifies process-independent onboarding, saved input, model intent and durable HTTP submission.
 */
import { before, after, test } from 'node:test';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { installStartFixture, notifyStart, submitStart } from './conversation-start-fixture.mjs';
import { installSessionFixture } from './session-fixture.mjs';

let server;
let browser;
let baseURL;
before(async () => {
  baseURL = process.env.E2E_BASE_URL;
  if (!baseURL) {
    const outDir = 'node_modules/.playwright-cold-start-build';
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

for (const width of [1280, 390, 320]) {
  test(`empty install stays editable and first send uses HTTP admission at ${width}px`, async (t) => {
    const page = await browser.newPage({ locale: 'en-US', viewport: { width, height: 850 } });
    t.after(() => page.close());
    await installSessionFixture(page);
    let models = [];
    let defaultId;
    let body;
    let runtimePreparations = 0;
    let legacyPrompts = 0;
    let result;
    await page.addInitScript(() => {
      globalThis.EventSource = class extends EventTarget {
        constructor() {
          super();
          globalThis.fixtureEvents = this;
        }
        close() {}
      };
    });
    await page.route('**/api/conversation-models', (route) =>
      route.fulfill({
        json: {
          models,
          defaults: {
            configured: Boolean(defaultId),
            available: Boolean(defaultId),
            providerId: 'provider',
            modelId: defaultId,
            effect: 'new_sessions',
          },
        },
      })
    );
    await page.route('**/api/workspaces/*/session-drafts', (route) => {
      runtimePreparations++;
      return route.fulfill({ status: 500, json: {} });
    });
    await page.route('**/api/workspaces/*/conversation-starts**', (route) => {
      if (route.request().method() === 'POST') {
        body = route.request().postDataJSON();
        result = {
          submissionId: body.submissionId,
          sessionId: 'session-e2e',
          status: 'accepted',
          message: body.message,
        };
      }
      return route.fulfill({ json: result });
    });
    page.on('websocket', (ws) =>
      ws.on('framesent', (event) => {
        if (String(event.payload).includes('agent.')) legacyPrompts++;
      })
    );
    await page.goto(new URL('/workspaces/workspace-e2e', baseURL).href);
    const editor = page.getByRole('textbox', { name: 'Message Dr.Octopus' });
    const guidance = page.getByRole('dialog', { name: 'Connect a model to get started' });
    await expect(guidance).toBeVisible();
    await page.screenshot({ animations: 'disabled', path: `.playwright-artifacts/model-setup-${width}.png` });
    await guidance.getByRole('button', { name: 'Not now' }).click();
    await expect(editor).toBeEditable();
    await editor.fill('Keep my first question');
    await page.reload();
    await expect(guidance).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(editor).toHaveText('Keep my first question');
    models = [
      { id: 'one', provider: 'provider', name: 'First model', input: ['text'], reasoning: false },
      { id: 'two', provider: 'provider', name: 'Second model', input: ['text'], reasoning: false },
    ];
    defaultId = 'one';
    await page.evaluate(() =>
      globalThis.fixtureEvents.dispatchEvent(
        new MessageEvent('change', { data: JSON.stringify({ resource: 'model-config' }) })
      )
    );
    const picker = page.getByRole('button', { name: 'Model and thinking settings' });
    await expect(picker).toHaveAttribute('title', 'First model');
    defaultId = 'two';
    await page.evaluate(() =>
      globalThis.fixtureEvents.dispatchEvent(
        new MessageEvent('change', { data: JSON.stringify({ resource: 'model-config' }) })
      )
    );
    await expect(picker).toHaveAttribute('title', 'Second model');
    await picker.click();
    await page.getByRole('menuitem', { name: /^Model / }).hover();
    await expect(page.getByRole('menuitemradio', { name: 'Follow default model' })).toBeChecked();
    await page.getByRole('menuitemradio', { name: 'First model' }).click();
    await page.reload();
    await expect(picker).toHaveAttribute('title', 'First model');
    await expect(page.getByRole('link', { name: 'Configure model services' })).toHaveCount(0);
    await picker.click();
    await page.getByRole('menuitem', { name: /^Model / }).hover();
    await page.getByRole('menuitemradio', { name: 'Follow default model' }).click();
    await expect(picker).toHaveAttribute('title', 'Second model');
    await page.screenshot({ animations: 'disabled', path: `.playwright-artifacts/model-menu-${width}.png` });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await picker.click();
    await page.getByRole('menuitem', { name: /^Model / }).hover();
    await page.getByRole('menuitemradio', { name: 'First model' }).click();
    await expect(editor).toHaveText('Keep my first question');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(picker).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('combobox', { name: 'Permission approval mode' }).click();
    await page.getByRole('option', { name: /Full-access/ }).click();
    await page.getByRole('combobox', { name: 'Agent work mode' }).click();
    await page.getByRole('option', { name: /^Plan/ }).click();
    await page.screenshot({
      animations: 'disabled',
      path: `.playwright-artifacts/cold-start-ready-${width}.png`,
    });
    await editor.press('Enter');
    await expect(page).toHaveURL(/sessions\/session-e2e/);
    if (body.selection.mode !== 'explicit' || body.selection.modelId !== 'one')
      throw new Error('Explicit intent was not retained');
    if (body.message !== 'Keep my first question') throw new Error('Draft text was lost');
    if (body.controls?.permissionMode !== 'full' || body.controls?.workMode !== 'plan')
      throw new Error('First-turn controls were lost');
    if (runtimePreparations !== 0 || legacyPrompts !== 0)
      throw new Error('Legacy prewarm or publish/prompt path was used');
  });
}

test('a lost submission response and page reload recover the saved request without a second POST', async (t) => {
  const page = await browser.newPage({ locale: 'en-US' });
  t.after(() => page.close());
  await installSessionFixture(page);
  let posts = 0;
  let input;
  let accepted = false;
  await page.route('**/api/conversation-models', (route) =>
    route.fulfill({
      json: {
        models: [{ provider: 'p', id: 'm', name: 'Model', reasoning: false, input: ['text'] }],
        defaults: {
          configured: true,
          providerId: 'p',
          modelId: 'm',
          available: true,
          effect: 'new_sessions',
        },
      },
    })
  );
  await page.route('**/api/workspaces/*/conversation-starts**', (route) => {
    if (route.request().method() === 'POST') {
      posts++;
      input = route.request().postDataJSON();
      return route.abort('failed');
    }
    return route.fulfill({
      json: {
        submissionId: input?.submissionId,
        sessionId: 'session-e2e',
        status: accepted ? 'accepted' : 'preparing',
        message: input?.message,
      },
    });
  });
  await page.goto(new URL('/workspaces/workspace-e2e', baseURL).href);
  const editor = page.getByRole('textbox', { name: 'Message Dr.Octopus' });
  await expect(page.getByRole('button', { name: 'Model and thinking settings' })).toHaveAttribute(
    'title',
    'Model'
  );
  await editor.fill('Do not send twice');
  await editor.press('Enter');
  await expect.poll(() => posts).toBe(1);
  accepted = true;
  await page.reload();
  await expect(page).toHaveURL(/sessions\/session-e2e/);
  if (posts !== 1) throw new Error('A page reload sent a second submission');
});

test('conflicting tab input can become a separate draft without losing text', async (t) => {
  const page = await browser.newPage({ locale: 'en-US' });
  t.after(() => page.close());
  await installSessionFixture(page);
  const submissions = [];
  await page.route('**/api/conversation-models', (route) =>
    route.fulfill({
      json: {
        models: [{ provider: 'p', id: 'm', name: 'Model', reasoning: false, input: ['text'] }],
        defaults: {
          configured: true,
          providerId: 'p',
          modelId: 'm',
          available: true,
          effect: 'new_sessions',
        },
      },
    })
  );
  await page.route('**/api/workspaces/*/conversation-starts**', (route) => {
    if (route.request().method() !== 'POST')
      return route.fulfill({
        status: 404,
        json: { code: 'CONVERSATION_START_NOT_FOUND', message: 'Not found' },
      });
    const input = route.request().postDataJSON();
    submissions.push(input);
    if (submissions.length === 1)
      return route.fulfill({
        status: 409,
        json: { code: 'CONVERSATION_START_CONFLICT', message: 'Another tab submitted different input.' },
      });
    return route.fulfill({
      json: {
        submissionId: input.submissionId,
        sessionId: 'session-e2e',
        status: 'accepted',
        message: input.message,
      },
    });
  });
  await page.goto(new URL('/workspaces/workspace-e2e', baseURL).href);
  const editor = page.getByRole('textbox', { name: 'Message Dr.Octopus' });
  await expect(page.getByRole('button', { name: 'Model and thinking settings' })).toHaveAttribute(
    'title',
    'Model'
  );
  await editor.fill('Keep this tab input');
  await editor.press('Enter');
  await page.getByRole('button', { name: 'Keep input in a separate conversation' }).click();
  await expect(editor).toHaveText('Keep this tab input');
  await expect(editor).toBeEditable();
  await editor.press('Enter');
  await expect(page).toHaveURL(/sessions\/session-e2e/);
  if (submissions[0].draftId === submissions[1].draftId)
    throw new Error('Conflicting draft identity was reused');
  if (submissions[1].message !== 'Keep this tab input') throw new Error('Input was lost during separation');
});

test('Chinese dark guidance preserves input and opens the existing Settings dialog', async (t) => {
  const page = await browser.newPage({
    locale: 'zh-CN',
    colorScheme: 'dark',
    viewport: { width: 390, height: 844 },
  });
  t.after(() => page.close());
  await installSessionFixture(page);
  await page.route('**/api/conversation-models', (route) =>
    route.fulfill({
      json: { models: [], defaults: { configured: false, available: false, effect: 'new_sessions' } },
    })
  );
  await page.route('**/api/settings/model-providers', (route) => route.fulfill({ json: { providers: [] } }));
  await page.goto(new URL('/workspaces/workspace-e2e', baseURL).href);
  const dialog = page.getByRole('dialog', { name: '连接模型，开始对话' });
  await expect(dialog).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: '.playwright-artifacts/model-setup-zh-dark.png' });
  await page.keyboard.press('Escape');
  const editor = page.getByRole('textbox', { name: 'Message Dr.Octopus' });
  await editor.fill('配置完成后继续这条任务');
  await editor.press('Enter');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '配置模型', exact: true }).click();
  await expect(page).toHaveURL(/settings\/model-providers/);
  await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
  await expect(dialog).not.toBeVisible();
  await page.goBack();
  await expect(editor).toHaveText('配置完成后继续这条任务');
  await expect(dialog).not.toBeVisible();
});

test('model guidance opens default settings or the current session model menu without losing input', async (t) => {
  const page = await browser.newPage({ locale: 'en-US' });
  t.after(() => page.close());
  await installSessionFixture(page);
  await page.route('**/api/conversation-models', (route) =>
    route.fulfill({
      json: {
        models: ['one', 'two'].map((id) => ({
          id,
          provider: 'p',
          name: id,
          reasoning: false,
          input: ['text'],
        })),
        defaults: { configured: false, available: false, effect: 'new_sessions' },
      },
    })
  );
  await page.route('**/api/settings/default-model', (route) =>
    route.fulfill({ json: { configured: false, available: false, effect: 'new_sessions' } })
  );
  await page.route('**/api/settings/default-model/candidates', (route) =>
    route.fulfill({ json: { candidates: [] } })
  );
  await page.goto(new URL('/workspaces/workspace-e2e', baseURL).href);
  const guidance = page.getByRole('dialog', { name: 'Choose an available model' });
  await expect(guidance).toBeVisible();
  await page.keyboard.press('Escape');
  const editor = page.getByRole('textbox', { name: 'Message Dr.Octopus' });
  await editor.fill('Keep this question while choosing a model');
  await editor.press('Enter');
  await guidance.getByRole('button', { name: 'Set default model', exact: true }).click();
  await expect(page).toHaveURL(/settings\/default-model/);
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByText('Current default model', { exact: true })).toBeVisible();
  await expect(guidance).not.toBeVisible();
  await page.goBack();
  await expect(editor).toHaveText('Keep this question while choosing a model');
  await expect(guidance).not.toBeVisible();
  await editor.press('Enter');
  await guidance.getByRole('button', { name: 'Choose model', exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces\/workspace-e2e$/);
  await page.getByRole('menuitem', { name: /^Model / }).hover();
  await page.getByRole('menuitemradio', { name: 'two', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Model and thinking settings' })).toHaveAttribute(
    'title',
    'two'
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(editor).toHaveText('Keep this question while choosing a model');
});

for (const event of ['change', 'ready']) {
  test(`immediate Session navigation survives reload and uses ${event} notifications without polling`, async (t) => {
    const page = await browser.newPage({
      locale: 'en-US',
      viewport: { width: event === 'change' ? 1280 : 320, height: 850 },
      colorScheme: event === 'change' ? 'light' : 'dark',
    });
    t.after(() => page.close());
    const state = await installStartFixture(page);
    await submitStart(page, 'Wait for a pushed result', baseURL);
    await expect(page.getByText('Session not found', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Ask Dr.Octopus anything…', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toHaveAttribute(
      'aria-busy',
      'true'
    );
    for (const name of ['Permission approval mode', 'Agent work mode']) {
      const trigger = page.getByRole('combobox', { name });
      await expect(trigger).toBeEnabled();
      await trigger.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const popup = page.locator(`[id="${await trigger.getAttribute('aria-controls')}"]`);
      await expect(popup).toBeVisible();
      await expect(popup.getByRole('option')).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
    await page.getByRole('button', { name: 'Model and thinking settings' }).click();
    const modelMenu = page.getByRole('menuitem', { name: /^Model / });
    await expect(modelMenu).toBeEnabled();
    await modelMenu.hover();
    await expect(page.getByRole('menuitemradio')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    if (event === 'change') {
      for (const name of [
        'Attach files',
        'Open commands',
        'Mention workspace file or folder',
        'Insert /goal command',
      ]) {
        await expect(page.getByRole('button', { name, exact: true })).toBeEnabled();
      }
      await page.getByRole('button', { name: 'Mention workspace file or folder' }).click();
      await expect(page.getByRole('textbox', { name: 'Message Dr.Octopus' })).toContainText('@');
    }
    await page.reload();
    await expect(page.getByText('Preparing your conversation…', { exact: true })).toBeVisible();
    await expect(page.getByText('Wait for a pushed result', { exact: true })).toBeVisible();
    await page.screenshot({
      animations: 'disabled',
      path: `.playwright-artifacts/session-preparing-${event}.png`,
    });
    const editor = page.getByRole('textbox', { name: 'Message Dr.Octopus' });
    await expect(editor).toBeEditable();
    await editor.fill('Keep typing during preparation');
    await editor.press('Enter');
    await expect(editor).toHaveText('Keep typing during preparation');
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
    await editor.press('Shift+ArrowLeft');
    const editorHandle = await editor.elementHandle();
    const composer = page.locator('[aria-label="composer"]');
    const initialBounds = await composer.boundingBox();
    const selection = await editor.evaluate(() => globalThis.getSelection()?.toString());
    /**
     * Stage changes must preserve the real editor node, focus, selection and input geometry.
     */
    async function assertStableComposer() {
      await expect(editor).toHaveText('Keep typing during preparation');
      await expect(editor).toBeFocused();
      expect(await editorHandle.evaluate((node) => node.isConnected)).toBe(true);
      expect(await editor.evaluate(() => globalThis.getSelection()?.toString())).toBe(selection);
      const bounds = await composer.boundingBox();
      for (const dimension of ['x', 'y', 'width', 'height']) {
        expect(Math.abs(bounds[dimension] - initialBounds[dimension])).toBeLessThanOrEqual(1);
      }
    }
    const before = state.reads;
    await page.waitForTimeout(1400);
    if (state.reads !== before) throw new Error('The pending submission was polled');
    if (state.bootstraps !== 0) throw new Error('An unpublished session was bootstrapped');
    if (state.posts.length !== 1) throw new Error('Reload repeated the first message');
    state.result.status = 'accepted';
    await notifyStart(page, event);
    await expect(page.getByText('Your message is saved. Preparing delivery…', { exact: true })).toBeVisible();
    await assertStableComposer();
    const drafts = await page.evaluate(
      () => JSON.parse(sessionStorage.getItem('octopus-home-drafts')).state.drafts
    );
    if (Object.keys(drafts).length) throw new Error('Accepted draft was not released on the Session route');
    state.result.status = 'dispatching';
    state.published = true;
    await notifyStart(page, event);
    await notifyStart(page, 'change', 'sessions');
    await expect(page.getByText('Sending your first message…', { exact: true })).toBeVisible();
    await expect.poll(() => state.bootstraps).toBeGreaterThan(0);
    await assertStableComposer();
    await page.screenshot({
      animations: 'disabled',
      path: `.playwright-artifacts/session-dispatching-${event}.png`,
    });
    state.result.status = 'running';
    await notifyStart(page, event);
    await expect(page.getByText('Sending your first message…', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Message Dr.Octopus' })).toBeEditable();
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toHaveAttribute(
      'aria-busy',
      'false'
    );
    await assertStableComposer();
    await editor.press('ControlOrMeta+a');
    await editor.press('Backspace');
    await expect(editor).toHaveText('');
    await expect(page.getByText('Ask Dr.Octopus anything…', { exact: true })).toBeVisible();
    if (state.posts.length !== 1) throw new Error('A stage transition replayed the first message');
    if (await page.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth))
      throw new Error('Startup overflows the viewport');
  });
}

for (const outcome of ['failed', 'cancelled']) {
  test(`${outcome} preparation restores the original draft and allows a new submission`, async (t) => {
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 } });
    t.after(() => page.close());
    const state = await installStartFixture(page);
    await submitStart(page, 'Preserve my original question', baseURL);
    if (outcome === 'cancelled') {
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page.getByText('Preparation cancelled. Your message is saved.')).toBeVisible();
    } else {
      state.result.status = 'failed';
      state.result.error = 'Model initialization failed';
      await notifyStart(page);
      await expect(page.getByText('Model initialization failed')).toBeVisible();
    }
    await page.screenshot({
      animations: 'disabled',
      path: `.playwright-artifacts/session-start-${outcome}.png`,
    });
    await page.getByRole('button', { name: 'Return to draft' }).click();
    await expect(page).toHaveURL(/workspaces\/workspace-e2e$/);
    const editor = page.getByRole('textbox', { name: 'Message Dr.Octopus' });
    await expect(editor).toHaveText('Preserve my original question');
    await editor.press('Enter');
    await expect(page).toHaveURL(/sessions\/session-e2e/);
    await expect(page.getByText('Preparing your conversation…', { exact: true })).toBeVisible();
    if (state.posts.length !== 2 || state.posts[0].submissionId === state.posts[1].submissionId)
      throw new Error('Explicit recovery did not create a fresh submission');
    if (state.posts[0].draftId !== state.posts[1].draftId)
      throw new Error('Original draft identity was lost');
  });
}

test('acceptance winning cancellation shows delivery progress without offering replay', async (t) => {
  const page = await browser.newPage({ locale: 'en-US' });
  t.after(() => page.close());
  const state = await installStartFixture(page);
  await submitStart(page, 'Do not replay accepted work', baseURL);
  state.cancelStatus = 'accepted';
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('Your message is saved. Preparing delivery…', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Return to draft' })).toHaveCount(0);
  state.result.status = 'unknown';
  state.result.error = 'Delivery confirmation lost';
  await notifyStart(page);
  await expect(page.getByText('Delivery confirmation lost')).toBeVisible();
  await expect(page.getByText('Do not replay accepted work', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Return to draft' })).toHaveCount(0);
  if (state.posts.length !== 1) throw new Error('An uncertain first message was replayed');
});

test('receipt transport failure can recover in place without resubmitting', async (t) => {
  const page = await browser.newPage({ locale: 'en-US' });
  t.after(() => page.close());
  const state = await installStartFixture(page);
  await submitStart(page, 'Recover status without replay', baseURL);
  let unavailable = true;
  await page.route('**/api/workspaces/*/sessions/*/start-receipt', (route) =>
    unavailable
      ? route.fulfill({ status: 503, json: { message: 'Startup status unavailable' } })
      : route.fallback()
  );
  await page.reload();
  await expect(page.getByText('Startup status unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('Session not found', { exact: true })).toHaveCount(0);
  unavailable = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('Preparing your conversation…', { exact: true })).toBeVisible();
  await expect(page.getByText('Recover status without replay', { exact: true })).toBeVisible();
  if (state.posts.length !== 1 || state.bootstraps !== 0)
    throw new Error('Receipt recovery triggered Agent work');
});

for (const colorScheme of ['light', 'dark']) {
  test(`saved first message keeps its presentation when the transcript arrives in ${colorScheme} mode`, async (t) => {
    const page = await browser.newPage({
      locale: 'en-US',
      colorScheme,
      viewport: { width: colorScheme === 'light' ? 1280 : 390, height: 850 },
    });
    t.after(() => page.close());
    const messages = [];
    const state = await installStartFixture(page, messages);
    await submitStart(page, 'Same first message', baseURL);
    const row = page
      .locator('[data-slot="message"][data-align="end"]')
      .filter({ hasText: 'Same first message' });
    const bubble = row.locator('[data-slot="bubble"]');
    const content = row.locator('[data-slot="bubble-content"]');
    await expect(bubble).toHaveAttribute('data-variant', 'muted');
    await expect(bubble).toHaveAttribute('data-align', 'end');
    await expect(content.locator('p')).toHaveText('Same first message');
    /**
     * Compare browser-computed presentation, not implementation class names alone.
     */
    async function appearance() {
      return content.evaluate((node) => {
        const style = globalThis.getComputedStyle(node);
        const box = node.getBoundingClientRect();
        return {
          background: style.backgroundColor,
          color: style.color,
          font: style.fontFamily,
          size: style.fontSize,
          lineHeight: style.lineHeight,
          padding: style.padding,
          radius: style.borderRadius,
          width: box.width,
          height: box.height,
          right: box.right,
          html: node.innerHTML,
        };
      });
    }
    const saved = await appearance();
    await page.screenshot({
      animations: 'disabled',
      path: `.playwright-artifacts/message-saved-${colorScheme}.png`,
    });
    messages.push({
      id: 'authoritative-first-message',
      role: 'user',
      content: [{ type: 'text', text: 'Same first message' }],
      timestamp: 1767225600000,
      entryId: 'entry-first',
    });
    state.result.status = 'running';
    state.published = true;
    await notifyStart(page);
    await notifyStart(page, 'change', 'sessions');
    await expect(row.getByRole('button', { name: 'Fork session from this message' })).toBeEnabled();
    await expect(page.getByText('Preparing your conversation…', { exact: true })).toHaveCount(0);
    await expect(content).toBeVisible();
    expect(await appearance()).toEqual(saved);
    await page.screenshot({
      animations: 'disabled',
      path: `.playwright-artifacts/message-authoritative-${colorScheme}.png`,
    });
    expect(state.posts.length).toBe(1);
  });
}

for (const selected of [false, true]) {
  test(`home knowledge ${selected ? 'selected sources' : 'auto-match'} survives reload, submission and failure recovery`, async (t) => {
    const page = await browser.newPage({
      locale: 'en-US',
      viewport: { width: selected ? 390 : 1280, height: 850 },
    });
    t.after(() => page.close());
    const state = await installStartFixture(page);
    await page.route('**/api/**/knowledge/collections?*', (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: 'selected-source',
              name: 'Knowledge handbook',
              description: 'Workspace sources',
              source: 'local',
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
        },
      })
    );
    await page.goto(new URL('/workspaces/workspace-e2e', baseURL).href);
    const editor = page.getByRole('textbox', { name: 'Message Dr.Octopus' });
    await editor.fill('Answer using my knowledge sources');
    await page.getByRole('combobox', { name: 'Agent work mode' }).click();
    await page.getByRole('option', { name: /Knowledge Q&A/ }).click();
    const settings = page.getByRole('button', { name: 'Source settings' });
    await expect(settings).toBeEnabled();
    if (selected) {
      await settings.click();
      const dialog = page.getByRole('dialog', { name: 'Source answers from the right materials' });
      await dialog.getByRole('button', { name: 'Selected collections', exact: true }).click();
      await dialog.getByRole('option', { name: /Knowledge handbook/ }).click();
      await dialog.getByRole('button', { name: 'Apply source settings' }).click();
    }
    await page.getByRole('combobox', { name: 'Agent work mode' }).click();
    await page.getByRole('option', { name: /^Plan/ }).click();
    await page.getByRole('combobox', { name: 'Agent work mode' }).click();
    await page.getByRole('option', { name: /Knowledge Q&A/ }).click();
    await page.reload();
    await expect(settings).toBeVisible();
    await expect(editor).toHaveText('Answer using my knowledge sources');
    await expect(
      page.getByText(selected ? 'Selected collections (1)' : 'Auto-match sources', { exact: true })
    ).toBeVisible();
    await page.screenshot({
      animations: 'disabled',
      path: `.playwright-artifacts/home-knowledge-${selected ? 'selected' : 'auto'}.png`,
    });
    expect(state.bootstraps).toBe(0);
    await editor.press('Enter');
    await expect(page).toHaveURL(/sessions\/session-e2e/);
    expect(state.posts[0].controls.workMode).toBe('knowledge');
    expect(state.posts[0].controls.knowledge?.collectionIds ?? []).toEqual(
      selected ? ['selected-source'] : []
    );
    state.result.status = 'failed';
    state.result.error = 'Knowledge mode unavailable';
    await notifyStart(page);
    await page.getByRole('button', { name: 'Return to draft' }).click();
    await expect(settings).toBeVisible();
    await expect(editor).toHaveText('Answer using my knowledge sources');
    await expect(
      page.getByText(selected ? 'Selected collections (1)' : 'Auto-match sources', { exact: true })
    ).toBeVisible();
    await editor.press('Enter');
    await expect(page).toHaveURL(/sessions\/session-e2e/);
    expect(state.posts[1].controls).toEqual(state.posts[0].controls);
    expect(state.posts[1].submissionId).not.toBe(state.posts[0].submissionId);
  });
}
