/**
 * @author Codex
 * @description Exercises shared Alert prop combinations against production popup CSS in isolated browser pages.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const bundle = await build({
  stdin: {
    resolveDir: root,
    loader: 'jsx',
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { Alert } from '@octopus/custom-ui/components/alert';
      const longText = 'diagnostic_' + 'x'.repeat(180);
      createRoot(document.getElementById('root')).render(
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Alert id="failure" variant="danger" showIcon
            description="模型输出未通过校验，请重试。"
            details={<details><summary>查看校验详情</summary><code>{longText}</code></details>}
            action={<button type="button">检查并修复</button>} />
          <Alert id="complete" variant="warning" showIcon title="Warning title"
            description={longText} allowClose closeLabel="Dismiss warning"
            action={<><button type="button">Cancel</button><button type="button">Continue</button></>} />
          <Alert id="plain" description="No icon or heading" />
          <Alert id="success" variant="success" showIcon title="保存成功"
            description="模型配置已保存。" allowClose closeLabel="Dismiss success"
            onClose={() => window.alertCloseCount = (window.alertCloseCount ?? 0) + 1} />
          <Alert id="custom" showIcon icon={<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" /></svg>}
            title="Custom icon" description="Custom content" />
        </div>
      );`,
  },
  jsx: 'automatic',
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
});

for (const flavor of ['chrome', 'edge']) {
  test(`${flavor}: Alert owns icon, text, details, action and close layout`, { timeout: 30000 }, async () => {
    const assets = join(root, '.output', `${flavor}-mv3`, 'assets');
    const cssName = (await readdir(assets)).find((name) => /^(?:popup|style)-.*\.css$/.test(name));
    assert.ok(cssName, 'Build the extension before running layout regression checks');
    const css = await readFile(join(assets, cssName), 'utf8');
    const evidence = await mkdtemp(join(tmpdir(), `octopus-alert-layout-${flavor}-`));
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<!doctype html><title>Alert layout regression</title><div id="root"></div>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
      const executablePath =
        flavor === 'chrome'
          ? join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe')
          : join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe');
      browser = await chromium.launch({ executablePath, headless: true });
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.addStyleTag({ content: css + '\nbody{width:100%;height:auto;overflow:auto}' });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await expect(page.locator('#failure')).toBeVisible();
      await page.getByText('查看校验详情', { exact: true }).click();
      for (const width of [360, 320]) {
        await page.setViewportSize({ width, height: 900 });
        for (const scheme of ['light', 'dark']) {
          await page.emulateMedia({ colorScheme: scheme });
          await page
            .locator('html')
            .evaluate((element, dark) => element.classList.toggle('dark', dark), scheme === 'dark');
          const geometry = await page.evaluate(() => {
            /** Reads visible bounds, including expanded diagnostics and intrinsic text width. */
            function bounds(selector) {
              const element = document.querySelector(selector);
              const { x, y, width, height } = element.getBoundingClientRect();
              return { x, y, width, height, scroll: element.scrollWidth, client: element.clientWidth };
            }
            return {
              failure: bounds('#failure'),
              icon: bounds('#failure [data-slot="alert-icon"]'),
              description: bounds('#failure [data-slot="alert-description"]'),
              details: bounds('#failure [data-slot="alert-details"]'),
              action: bounds('#failure [data-slot="alert-actions"]'),
              repair: bounds('#failure button'),
              complete: bounds('#complete'),
              heading: bounds('#complete [data-slot="alert-title"]'),
              warningDescription: bounds('#complete [data-slot="alert-description"]'),
              close: bounds('#complete button[aria-label]'),
              controls: bounds('#complete [data-slot="alert-actions"]'),
              plain: bounds('#plain'),
              success: bounds('#success'),
              plainText: bounds('#plain [data-slot="alert-description"]'),
            };
          });
          const g = geometry;
          assert.ok(g.icon.x + g.icon.width < g.description.x, 'Icon has its own fixed column');
          assert.ok(Math.abs(g.description.x - g.details.x) < 1, 'Details align with the description');
          assert.ok(Math.abs(g.description.x - g.action.x) < 1, 'Actions stay in the content column');
          assert.ok(g.details.y >= g.description.y + g.description.height, 'Details follow the description');
          assert.ok(g.action.y >= g.details.y + g.details.height, 'Actions follow expanded details');
          assert.ok(
            Math.abs(g.repair.x + g.repair.width - g.action.x - g.action.width) < 1,
            'Action stays right aligned'
          );
          assert.ok(Math.abs(g.heading.x - g.warningDescription.x) < 1, 'Heading and description align');
          assert.ok(
            g.warningDescription.x + g.warningDescription.width <= g.close.x,
            'Close button has reserved space'
          );
          for (const item of [g.failure, g.details, g.complete, g.controls, g.success]) {
            assert.ok(item.scroll <= item.client + 1, `No horizontal overflow at ${width}px in ${scheme}`);
          }
          assert.ok(g.plainText.x - g.plain.x < 16, 'No unused icon column when showIcon is false');
          const contrast = await page.locator('#success').evaluate((element) => {
            const style = getComputedStyle(element);
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            const context = canvas.getContext('2d');
            /** Composites browser-resolved theme colors into the screenshot's sRGB color space. */
            function luminance(color) {
              context.clearRect(0, 0, 1, 1);
              context.fillStyle = style.getPropertyValue('--background');
              context.fillRect(0, 0, 1, 1);
              context.fillStyle = color;
              context.fillRect(0, 0, 1, 1);
              const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((channel) => {
                const value = channel / 255;
                return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
              });
              return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
            }
            const foreground = luminance(style.color);
            const background = luminance(style.backgroundColor);
            return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
          });
          console.info(`${flavor} ${scheme} success text contrast: ${contrast.toFixed(2)}:1`);
          assert.ok(contrast >= 4.5, `Success body text needs sufficient contrast in ${scheme}: ${contrast}`);
          const successText = await page.evaluate(() => ({
            body: getComputedStyle(document.querySelector('#success [data-slot="alert-description"]')).color,
            title: getComputedStyle(document.querySelector('#success [data-slot="alert-title"]')).color,
            plain: getComputedStyle(document.querySelector('#plain')).color,
            icon: getComputedStyle(document.querySelector('#success [data-slot="alert-icon"]')).color,
          }));
          assert.equal(successText.body, successText.plain, 'Success body uses regular foreground color');
          assert.equal(successText.title, successText.plain, 'Success title uses regular foreground color');
          assert.notEqual(successText.icon, successText.body, 'Only the status icon uses success color');
          await page.screenshot({ path: join(evidence, `${width}-${scheme}.png`), fullPage: true });
        }
      }
      await page.getByRole('button', { name: 'Dismiss warning' }).focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('#complete')).toHaveCount(0);
      await expect(page.locator('#failure')).toBeVisible();
      await expect(page.locator('#success')).toHaveAttribute('data-variant', 'success');
      await expect(page.locator('#success [data-slot="alert-icon"] svg')).toBeVisible();
      const successColors = await page.evaluate(() => {
        const success = getComputedStyle(document.querySelector('#success'));
        const plain = getComputedStyle(document.querySelector('#plain'));
        return { success: success.backgroundColor, plain: plain.backgroundColor };
      });
      assert.notEqual(successColors.success, successColors.plain, 'Success theme styles are generated');
      await page.getByRole('button', { name: 'Dismiss success' }).click();
      await expect(page.locator('#success')).toHaveCount(0);
      assert.equal(await page.evaluate(() => window.alertCloseCount), 1);
      assert.deepEqual(errors, []);
      console.info('Alert layout evidence:', evidence);
    } finally {
      await browser?.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
}
