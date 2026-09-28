/**
 * @author Codex
 * @description Exercises speech configuration and Composer capture with browser media and isolated ASR fixtures.
 */
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { installSessionFixture } from './session-fixture.mjs';

let server, browser, baseURL, outDir;
const qaDirectory = process.env.SPEECH_QA_DIR;
before(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'octopus-speech-browser-'));
  if (process.env.E2E_BASE_URL) baseURL = process.env.E2E_BASE_URL;
  else {
    await build({ logLevel: 'error', build: { outDir, emptyOutDir: false } });
    server = await preview({ build: { outDir }, preview: { host: '127.0.0.1', port: 0, open: false } });
    baseURL = server.resolvedUrls.local[0];
  }
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  if (qaDirectory) await mkdir(qaDirectory, { recursive: true });
});
after(async () => {
  await browser?.close();
  if (server) {
    server.httpServer.closeAllConnections();
    await new Promise((resolve) => server.httpServer.close(resolve));
  }
  await rm(outDir, { recursive: true, force: true });
});

/**
 * Intercepts settings and ASR so no microphone data or credentials reach a real provider.
 */
async function fixture(t, enabled = true) {
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1280, height: 1000 } });
  t.after(() => page.close());
  await page.addInitScript(() => localStorage.setItem('i18nextLng', 'en'));
  await page.addInitScript(() => {
    globalThis.speechContexts = [];
    globalThis.speechStreams = [];
    const AudioContext = globalThis.AudioContext;
    globalThis.AudioContext = new Proxy(AudioContext, {
      construct(target, args) {
        const context = Reflect.construct(target, args);
        globalThis.speechContexts.push(context);
        return context;
      },
    });
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await getUserMedia(constraints);
      globalThis.speechStreams.push(stream);
      return stream;
    };
    const start = globalThis.MediaRecorder.prototype.start;
    globalThis.MediaRecorder.prototype.start = function (...args) {
      globalThis.speechRecordedBytes = 0;
      this.addEventListener('dataavailable', (event) => {
        globalThis.speechRecordedBytes += event.data.size;
      });
      return start.apply(this, args);
    };
  });
  const session = await installSessionFixture(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let settings = {
    enabled,
    activeProvider: 'openai',
    providers: {
      openai: { baseUrl: 'https://asr.example/v1', model: 'whisper-1', hasApiKey: false },
      qwen: {
        baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
        model: 'qwen-audio-3.1-asr-flash',
        hasApiKey: false,
      },
    },
    revision: 'r0',
  };
  let count = 0;
  const writes = [];
  await page.route('**/api/settings/speech', async (route) => {
    if (route.request().method() === 'PUT') {
      const input = route.request().postDataJSON();
      writes.push(input);
      assert.equal(input.revision, settings.revision);
      const { provider, ...rest } = input;
      settings = { ...settings, ...rest, revision: `r${writes.length}` };
      if (provider) {
        const { id, apiKey, ...configuration } = provider;
        settings.providers[id] = {
          ...settings.providers[id],
          ...configuration,
          ...(apiKey !== undefined ? { hasApiKey: Boolean(apiKey) } : {}),
        };
      }
    }
    await route.fulfill({ json: settings });
  });
  await page.route('**/api/speech/transcriptions', async (route) => {
    count++;
    assert.match(route.request().headers()['content-type'], /^audio\//);
    assert.ok(route.request().postDataBuffer().length > 0);
    await route.fulfill({ json: { text: 'recognized words' } });
  });
  return {
    page,
    session,
    writes,
    errors,
    get count() {
      return count;
    },
  };
}

test(
  'settings saves enablement and model, redacts key, supports masked navigation and narrow layouts',
  { timeout: 60000 },
  async (t) => {
    const { page, writes, errors } = await fixture(t, false);
    await page.goto(new URL('/settings/speech', baseURL).href);
    assert.ok((await page.title()).length > 0);
    await expect(page.locator('#speech-enabled')).not.toBeChecked();
    await page.locator('#speech-enabled').focus();
    await page.keyboard.press('Space');
    await page.locator('#speech-openai-key').fill('browser-only-key');
    await page.locator('#speech-openai-model').fill('custom-asr');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByText('Speech settings saved.', { exact: true })).toBeVisible();
    assert.equal(writes[0].enabled, true);
    assert.equal(writes[1].provider.model, 'custom-asr');
    await expect(page.locator('#speech-openai-model')).toHaveValue('custom-asr');
    await expect(page.locator('#speech-openai-key')).toHaveValue('');
    await expect(page.locator('#speech-openai-key')).toHaveAttribute('placeholder', '******** (configured)');
    if (qaDirectory)
      await page.screenshot({ path: join(qaDirectory, 'speech-settings-desktop.png'), fullPage: true });
    await page.reload();
    await expect(page.locator('#speech-enabled')).toBeChecked();
    await expect(page.locator('#speech-openai-model')).toHaveValue('custom-asr');
    const labelColor = await page
      .locator('label[for="speech-openai-model"]')
      .evaluate((element) => globalThis.getComputedStyle(element).color);
    await expect
      .poll(() =>
        page.locator('#speech-openai-model').evaluate((element) => globalThis.getComputedStyle(element).color)
      )
      .toBe(labelColor);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
      assert.equal(
        await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth),
        true
      );
      await expect(page.getByRole('button', { name: 'Save settings', exact: true })).toBeVisible();
      await expect(page.locator('#speech-openai-model')).toHaveValue('custom-asr');
    }
    if (qaDirectory)
      await page.screenshot({ path: join(qaDirectory, 'speech-settings-mobile.png'), fullPage: true });
    const target = new URL('/workspaces/workspace-e2e', baseURL);
    target.searchParams.set('settings', JSON.stringify({ path: '/settings/speech' }));
    await page.goto(target.href);
    await expect(page.getByRole('dialog').locator('#speech-openai-model')).toHaveValue('custom-asr');
    assert.deepEqual(errors, []);
  }
);

test(
  'recording inserts into draft without sending, and cancel preserves the draft on mobile',
  { timeout: 60000 },
  async (t) => {
    const fixtureState = await fixture(t);
    const { page, session, errors } = fixtureState;
    await page.goto(new URL(session.path, baseURL).href);
    const editor = page.getByRole('textbox', { name: 'Message Dr.Octopus' });
    await editor.fill('Existing draft');
    await page.getByRole('button', { name: 'Start voice input', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Recording…' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Send message', exact: true, includeHidden: true })
    ).toBeDisabled();
    const dialog = page.getByRole('dialog', { name: 'Voice input', exact: true });
    await expect(dialog).toBeVisible();
    await expect(page.locator('[role="toolbar"] [aria-label="Cancel voice input"]')).toHaveCount(0);
    await expect(page.locator('[role="toolbar"] [aria-label="Stop recording and transcribe"]')).toHaveCount(
      0
    );
    await expect
      .poll(() =>
        page.evaluate(() => globalThis.speechContexts.some((context) => context.state === 'running'))
      )
      .toBe(true);
    await expect
      .poll(() =>
        page
          .locator('[data-speech-waveform] span')
          .first()
          .evaluate((element) => element.style.transform)
      )
      .not.toBe('scaleY(0.12)');
    await page.mouse.click(5, 5);
    await expect(dialog).toBeVisible();
    if (qaDirectory)
      await page.screenshot({ path: join(qaDirectory, 'speech-dialog-desktop.png'), fullPage: true });
    // Let the real MediaRecorder produce a nonempty chunk from Chromium's fake microphone.
    await expect
      .poll(() =>
        page.evaluate(() => navigator.mediaDevices.enumerateDevices().then((devices) => devices.length))
      )
      .toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => globalThis.speechRecordedBytes)).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Stop recording and transcribe', exact: true }).click();
    await expect(editor).toContainText('Existing draft recognized words');
    assert.equal(fixtureState.count, 1);
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => globalThis.speechContexts.every((context) => context.state === 'closed'))
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() =>
          globalThis.speechStreams.every((stream) =>
            stream.getTracks().every((track) => track.readyState === 'ended')
          )
        )
      )
      .toBe(true);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
      await page.getByRole('button', { name: 'Start voice input', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Cancel voice input', exact: true })).toBeVisible();
      await expect(
        dialog.getByRole('button', { name: 'Stop recording and transcribe', exact: true })
      ).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() => globalThis.speechContexts.every((context) => context.state === 'closed'))
        )
        .toBe(true);
      const bounds = await dialog.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      if (qaDirectory && width === 390)
        await page.screenshot({ path: join(qaDirectory, 'speech-composer-recording.png'), fullPage: true });
      await page.getByRole('button', { name: 'Cancel voice input', exact: true }).click();
      await expect(editor).toContainText('Existing draft recognized words');
      await expect(editor).toBeFocused();
      assert.equal(
        await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth),
        true
      );
    }
    assert.equal(fixtureState.count, 1);
    assert.deepEqual(errors, []);
  }
);

test(
  'speech dialog keeps actions reachable and shortcut hints separate at small viewports',
  { timeout: 60000 },
  async (t) => {
    const { page, session, errors } = await fixture(t);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const customShortcuts of [false, true]) {
      if (customShortcuts) {
        await page.setViewportSize({ width: 1280, height: 1000 });
        await page.goto(new URL('/settings/appearance/shortcuts', baseURL).href);
        for (const [label, binding] of [
          ['Start / stop voice input', 'Control+Alt+Shift+y'],
          ['Cancel voice input', 'Control+Alt+Shift+x'],
        ]) {
          await page
            .getByRole('row')
            .filter({ hasText: label })
            .getByRole('button', { name: 'Edit shortcut', exact: true })
            .click();
          await page.keyboard.press(binding);
        }
      }
      for (const viewport of [
        { width: 320, height: 844 },
        { width: 390, height: 844 },
        { width: 844, height: 390 },
      ]) {
        await page.setViewportSize(viewport);
        await page.goto(new URL(session.path, baseURL).href);
        const editor = page.getByRole('textbox', { name: 'Message Dr.Octopus' });
        await editor.fill('Keep this draft');
        await page.getByRole('button', { name: 'Start voice input', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Voice input', exact: true });
        const stop = dialog.getByRole('button', { name: 'Stop recording and transcribe', exact: true });
        const cancel = dialog.getByRole('button', { name: 'Cancel voice input', exact: true });
        await expect(stop).toBeVisible();
        const bounds = await dialog.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width);
        assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height);
        for (const [button, text] of [
          [stop, 'Stop and transcribe'],
          [cancel, 'Cancel voice input'],
        ]) {
          await button.focus();
          await expect(button).toBeInViewport({ ratio: 1 });
          const overlaps = await button.evaluate((element, text) => {
            const hint = element.querySelector('kbd').getBoundingClientRect();
            const walker = globalThis.document.createTreeWalker(element, globalThis.NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              if (walker.currentNode.textContent.trim() !== text) continue;
              const range = globalThis.document.createRange();
              range.selectNodeContents(walker.currentNode);
              return Array.from(range.getClientRects()).some(
                (label) =>
                  label.left < hint.right &&
                  label.right > hint.left &&
                  label.top < hint.bottom &&
                  label.bottom > hint.top
              );
            }
            throw new Error(`Missing action label: ${text}`);
          }, text);
          assert.equal(overlaps, false, `${text} overlaps its shortcut at ${viewport.width}px`);
          assert.equal(await button.evaluate((element) => element.scrollWidth <= element.clientWidth), true);
        }
        if (qaDirectory && customShortcuts)
          await page.screenshot({
            path: join(qaDirectory, `speech-dialog-${viewport.width}x${viewport.height}.png`),
          });
        // Use the visible on-screen coordinate so Playwright cannot hide a clipped action by auto-scrolling.
        const cancelBounds = await cancel.boundingBox();
        await page.mouse.click(
          cancelBounds.x + cancelBounds.width / 2,
          cancelBounds.y + cancelBounds.height / 2
        );
        await expect(dialog).toHaveCount(0);
        await expect(editor).toHaveText('Keep this draft');
        await expect(editor).toBeFocused();
      }
    }
    assert.deepEqual(errors, []);
  }
);

test('recognition failure preserves draft and supports recording again', { timeout: 60000 }, async (t) => {
  const { page, session } = await fixture(t);
  await page.route('**/api/speech/transcriptions', (route) =>
    route.fulfill({ status: 502, json: { code: 'SPEECH_REQUEST_FAILED', message: 'ASR unavailable' } })
  );
  await page.goto(new URL(session.path, baseURL).href);
  const editor = page.getByRole('textbox', { name: 'Message Dr.Octopus' });
  await editor.fill('Keep this draft');
  await page.getByRole('button', { name: 'Start voice input', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Stop recording and transcribe', exact: true })
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => globalThis.speechRecordedBytes)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Stop recording and transcribe', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Voice input failed.' })).toBeVisible();
  await expect(editor).toHaveText('Keep this draft');
  await expect(page.getByRole('button', { name: 'Start voice input', exact: true })).toBeEnabled();
});

test(
  'disabled service hides microphone and failed settings saves keep edits',
  { timeout: 60000 },
  async (t) => {
    const { page, session } = await fixture(t, false);
    await page.goto(new URL(session.path, baseURL).href);
    await expect(page.getByRole('textbox', { name: 'Message Dr.Octopus' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start voice input', exact: true })).toHaveCount(0);
    await page.goto(new URL('/settings/speech', baseURL).href);
    await page.route('**/api/settings/speech', async (route) => {
      if (route.request().method() === 'PUT')
        await route.fulfill({ status: 409, json: { message: 'Configuration changed' } });
      else await route.fallback();
    });
    await page.locator('#speech-openai-model').fill('unsaved-asr');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Configuration changed');
    await expect(page.locator('#speech-openai-model')).toHaveValue('unsaved-asr');
    await page.getByRole('button', { name: 'Reload settings', exact: true }).click();
    await expect(page.locator('#speech-openai-model')).toHaveValue('whisper-1');
  }
);

test('cancelling pending transcription ignores a late result', { timeout: 60000 }, async (t) => {
  const { page, session } = await fixture(t);
  let respond;
  await page.route('**/api/speech/transcriptions', async (route) => {
    await new Promise((resolve) => {
      respond = resolve;
    });
    await route.fulfill({ json: { text: 'late words' } }).catch(() => undefined);
  });
  await page.goto(new URL(session.path, baseURL).href);
  const editor = page.getByRole('textbox', { name: 'Message Dr.Octopus' });
  await editor.fill('Original draft');
  await page.keyboard.press('Control+d');
  await expect.poll(() => page.evaluate(() => globalThis.speechRecordedBytes)).toBeGreaterThan(0);
  await page.keyboard.press('Control+d');
  await expect(page.getByRole('status').filter({ hasText: 'Recognizing speech…' })).toBeVisible();
  await expect.poll(() => Boolean(respond)).toBe(true);
  await page.keyboard.press('Control+d');
  await expect(page.getByRole('status').filter({ hasText: 'Recognizing speech…' })).toBeVisible();
  await page.keyboard.press('Escape');
  respond();
  await expect(page.getByRole('button', { name: 'Start voice input', exact: true })).toBeVisible();
  await expect(editor).toHaveText('Original draft');
  await expect(editor).toBeFocused();
});

test(
  'Ctrl+D starts and stops recording; Escape cancels and returns focus without sending',
  { timeout: 60000 },
  async (t) => {
    const state = await fixture(t);
    const { page, session } = state;
    await page.goto(new URL(session.path, baseURL).href);
    const editor = page.getByRole('textbox', { name: 'Message Dr.Octopus' });
    await editor.fill('Keyboard draft');
    await expect(page.getByRole('button', { name: 'Start voice input', exact: true })).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+D'
    );
    await page.keyboard.press('Control+d');
    await expect(
      page.getByRole('button', { name: 'Stop recording and transcribe', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Send message', exact: true, includeHidden: true })
    ).toBeDisabled();
    await expect.poll(() => page.evaluate(() => globalThis.speechRecordedBytes)).toBeGreaterThan(0);
    await page.keyboard.press('Control+d');
    await expect(editor).toHaveText('Keyboard draft recognized words');
    await expect(editor).toBeFocused();
    assert.equal(state.count, 1);
    await page.keyboard.press('Control+d');
    await expect(page.getByRole('button', { name: 'Cancel voice input', exact: true })).toHaveAttribute(
      'aria-keyshortcuts',
      'Escape'
    );
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Start voice input', exact: true })).toBeVisible();
    await expect(editor).toHaveText('Keyboard draft recognized words');
    await expect(editor).toBeFocused();
    assert.equal(state.count, 1);
    assert.deepEqual(state.errors, []);
  }
);

test(
  'voice shortcuts can be rebound and cleared through keyboard settings',
  { timeout: 60000 },
  async (t) => {
    const { page, session } = await fixture(t);
    await page.goto(new URL('/settings/appearance/shortcuts', baseURL).href);
    const toggleRow = page.getByRole('row').filter({ hasText: 'Start / stop voice input' });
    const cancelRow = page.getByRole('row').filter({ hasText: 'Cancel voice input' });
    await toggleRow.getByRole('button', { name: 'Edit shortcut', exact: true }).click();
    await page.keyboard.press('Control+Shift+y');
    await expect(toggleRow).toContainText('Ctrl+Shift+Y');
    await cancelRow.getByRole('button', { name: 'Edit shortcut', exact: true }).click();
    await page.keyboard.press('Control+Shift+x');
    await page.goto(new URL(session.path, baseURL).href);
    await page.getByRole('textbox', { name: 'Message Dr.Octopus' }).fill('Custom keys');
    await expect(page.getByRole('button', { name: 'Start voice input', exact: true })).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+Shift+Y'
    );
    await page.keyboard.press('Control+Shift+y');
    await expect(page.getByRole('button', { name: 'Cancel voice input', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Cancel voice input', exact: true })).toBeVisible();
    await page.keyboard.press('Control+Shift+x');
    await expect(page.getByRole('button', { name: 'Start voice input', exact: true })).toBeVisible();
    await page.goto(new URL('/settings/appearance/shortcuts', baseURL).href);
    await toggleRow.getByRole('button', { name: 'Clear shortcut', exact: true }).click();
    await expect(toggleRow).toContainText('Not set');
    await page.goto(new URL(session.path, baseURL).href);
    const start = page.getByRole('button', { name: 'Start voice input', exact: true });
    await expect(start).not.toHaveAttribute('aria-keyshortcuts');
    await page.keyboard.press('Control+Shift+y');
    await expect(start).toBeVisible();
  }
);

test(
  'voice shortcuts stay inactive while speech is disabled or Settings is open',
  { timeout: 60000 },
  async (t) => {
    const { page, session } = await fixture(t, false);
    await page.goto(new URL(session.path, baseURL).href);
    await page.getByRole('textbox', { name: 'Message Dr.Octopus' }).fill('Keep draft');
    await page.keyboard.press('Control+d');
    await expect(page.getByRole('button', { name: 'Cancel voice input', exact: true })).toHaveCount(0);
    await page.route('**/api/settings/speech', (route) =>
      route.fulfill({
        json: {
          enabled: true,
          activeProvider: 'openai',
          providers: {
            openai: { baseUrl: 'https://asr.example/v1', model: 'whisper-1', hasApiKey: false },
            qwen: {
              baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
              model: 'qwen-audio-3.1-asr-flash',
              hasApiKey: false,
            },
          },
          revision: 'r1',
        },
      })
    );
    const target = new URL(session.path, baseURL);
    target.searchParams.set('settings', JSON.stringify({ path: '/settings/speech' }));
    await page.goto(target.href);
    await page.getByRole('dialog').locator('#speech-openai-model').focus();
    await page.keyboard.press('Control+d');
    await expect(page.getByRole('button', { name: 'Cancel voice input', exact: true })).toHaveCount(0);
    await expect(page.getByRole('dialog')).toBeVisible();
  }
);

test('microphone denial is actionable and leaves the editor available', { timeout: 60000 }, async (t) => {
  const { page, session } = await fixture(t);
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('Denied', 'NotAllowedError');
    };
  });
  await page.goto(new URL(session.path, baseURL).href);
  await page.getByRole('button', { name: 'Start voice input', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not access the microphone.' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message Dr.Octopus' })).toBeEditable();
  await expect(page.getByRole('button', { name: 'Start voice input', exact: true })).toBeEnabled();
});

test(
  'provider tabs preserve drafts, save independently and switch only on Save and use',
  { timeout: 60000 },
  async (t) => {
    const { page, writes, errors } = await fixture(t);
    await page.goto(new URL('/settings/speech', baseURL).href);
    await page.locator('#speech-openai-model').fill('openai-draft');
    await page.locator('#speech-openai-key').fill('openai-key');
    await page.getByRole('tab', { name: 'Qwen Bailian', exact: true }).click();
    await expect(page).toHaveURL(/provider=qwen/);
    await expect(page.locator('#speech-qwen-model')).toHaveValue('qwen-audio-3.1-asr-flash');
    await expect(page.getByText('Selected service: OpenAI compatible', { exact: true })).toBeVisible();
    assert.equal(writes.length, 0);
    await page.getByRole('button', { name: 'Save and use', exact: true }).click();
    await expect(
      page.getByText('Add a Qwen API key before enabling this service.', { exact: true })
    ).toBeVisible();
    await expect(page.locator('#speech-qwen-key')).toBeFocused();
    assert.equal(writes.length, 0);
    await page.locator('#speech-qwen-key').fill('qwen-key');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByText('Speech settings saved.', { exact: true })).toBeVisible();
    assert.equal(writes[0].provider.id, 'qwen');
    assert.equal(writes[0].provider.apiKey, 'qwen-key');
    assert.equal(writes[0].activeProvider, undefined);
    await expect(page.locator('#speech-qwen-key')).toHaveValue('');
    await expect(page.locator('#speech-qwen-key')).toHaveAttribute('placeholder', '******** (configured)');
    await page.getByRole('tab', { name: 'Qwen Bailian', exact: true }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: 'OpenAI compatible', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#speech-openai-model')).toBeVisible();
    await expect(page.locator('#speech-openai-model')).toHaveValue('openai-draft');
    await expect(page.locator('#speech-openai-key')).toHaveValue('openai-key');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.locator('#speech-openai-key')).toHaveValue('');
    await page.getByRole('tab', { name: 'Qwen Bailian', exact: true }).click();
    await page.getByRole('button', { name: 'Save and use', exact: true }).click();
    await expect(page.getByText('Selected service: Qwen Bailian', { exact: true })).toBeVisible();
    assert.equal(writes[2].activeProvider, 'qwen');
    assert.equal(writes[2].provider.apiKey, undefined);
    await page.reload();
    await expect(page.getByRole('tab', { name: 'Qwen Bailian', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(page.locator('#speech-qwen-key')).toHaveValue('');
    if (qaDirectory)
      await page.screenshot({ path: join(qaDirectory, 'speech-qwen-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 320, height: 844 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await expect(page.locator('#speech-qwen-model')).toBeVisible();
    await expect(page.locator('html')).toHaveClass(/dark/);
    const textColor = await page
      .locator('label[for="speech-qwen-model"]')
      .evaluate((element) => globalThis.getComputedStyle(element).color);
    await expect
      .poll(() =>
        page
          .getByRole('tab', { name: 'Qwen Bailian', exact: true })
          .evaluate((element) => globalThis.getComputedStyle(element).color)
      )
      .toBe(textColor);
    assert.equal(
      await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth),
      true
    );
    if (qaDirectory)
      await page.screenshot({ path: join(qaDirectory, 'speech-qwen-mobile.png'), fullPage: true });
    await page.goto(new URL('/settings/speech', baseURL).href);
    await expect(page.getByRole('tab', { name: 'Qwen Bailian', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    const target = new URL('/workspaces/workspace-e2e', baseURL);
    target.searchParams.set('settings', JSON.stringify({ path: '/settings/speech', provider: 'qwen' }));
    await page.goto(target.href);
    await page.getByRole('tab', { name: 'OpenAI compatible', exact: true }).click();
    await expect(page).toHaveURL(/provider=openai/);
    await expect(page.getByRole('dialog').locator('#speech-openai-model')).toHaveValue('openai-draft');
    await expect(page.getByRole('dialog').locator('#speech-openai-key')).toHaveAttribute(
      'placeholder',
      '******** (configured)'
    );
    assert.deepEqual(errors, []);
  }
);
