/**
 * @author Codex
 * @description Checks separate skill presentation, history reload and narrow layouts through deterministic Pi fixtures.
 */
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { installSessionFixture } from './session-fixture.mjs';

let server;
let browser;
let baseURL;
before(async () => {
  server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false }, logLevel: 'error' });
  await server.listen();
  baseURL = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  await mkdir('.playwright-artifacts', { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

test(
  'skill loads are distinct from file reads and expanded skill commands retain the user request',
  { timeout: 180000 },
  async (t) => {
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1280, height: 960 } });
    t.after(() => page.close());
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const path = 'C:/agent/skills/imagegen/SKILL.md';
    await installSessionFixture(page, {
      initialMessages: [
        {
          id: 'skill-command',
          role: 'user',
          timestamp: 1767225600000,
          content: [
            {
              type: 'text',
              text:
                '<skill name="imagegen" location="' +
                path +
                '">\nPrivate skill instructions\n</skill>\n\nMake an orange cat',
            },
          ],
        },
        {
          id: 'skill-assistant',
          role: 'assistant',
          timestamp: 1767225600100,
          content: [
            { type: 'toolCall', id: 'read-skill', name: 'read', arguments: { path } },
            { type: 'toolCall', id: 'read-file', name: 'read', arguments: { path: 'README.md' } },
          ],
        },
        {
          id: 'skill-result',
          role: 'toolResult',
          toolCallId: 'read-skill',
          toolName: 'read',
          timestamp: 1767225600200,
          isError: true,
          content: [{ type: 'text', text: 'Skill file not found' }],
        },
        {
          id: 'file-result',
          role: 'toolResult',
          toolCallId: 'read-file',
          toolName: 'read',
          timestamp: 1767225600300,
          content: [{ type: 'text', text: 'Normal file contents' }],
        },
      ],
    });
    await page.goto(baseURL + 'workspaces/workspace-e2e/sessions/session-e2e', {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });
    const skill = page.getByRole('button', { name: /Load skill/ });
    await expect(skill).toBeVisible({ timeout: 120000 });
    await expect(skill).toContainText('imagegen');
    await expect(skill).toContainText('Error');
    await expect(page.getByText('Make an orange cat', { exact: true })).toBeVisible();
    const command = page.getByRole('button', { name: /Use skill/ });
    await expect(command).toHaveAttribute('aria-expanded', 'false');
    await command.click();
    await expect(page.getByText('Private skill instructions', { exact: true })).toBeVisible();
    await skill.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Skill file not found', { exact: true })).toBeVisible();
    await expect(page.getByText('Skill instructions', { exact: true })).toBeVisible();
    const read = page.getByRole('button', { name: /^read.*README/ });
    await read.click();
    await expect(page.getByText('Normal file contents', { exact: true })).toBeVisible();
    await page.screenshot({ path: '.playwright-artifacts/skill-projection-desktop.png', fullPage: true });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(skill).toBeVisible();
    await expect(skill).toHaveAttribute('aria-expanded', 'false');
    await skill.click();
    await expect(page.getByText('Skill file not found', { exact: true })).toBeVisible();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(
        await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth)
      );
    }
    await page.evaluate(() => globalThis.document.documentElement.classList.add('dark'));
    if ((await skill.getAttribute('aria-expanded')) !== 'true') await skill.click();
    await expect(page.getByText('Skill file not found', { exact: true })).toBeVisible();
    await page.screenshot({ path: '.playwright-artifacts/skill-projection-mobile-dark.png', fullPage: true });
    assert.deepEqual(errors, []);
  }
);
