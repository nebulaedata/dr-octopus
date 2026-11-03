/**
 * @author Codex
 * @description Verifies shared Alert reuse preserves settings notification timers, focus, dismissal and replacement.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
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
      import React, { useState, useRef } from 'react';
      import { createRoot } from 'react-dom/client';
      import { SettingsToast } from './src/features/model-settings/SettingsToast';
      function Fixture() {
        const [notice, setNotice] = useState(null);
        const [closed, setClosed] = useState(0);
        const id = useRef(0);
        const close = React.useCallback(() => { setNotice(null); setClosed(value => value + 1); }, []);
        return <main style={{ padding: 16 }}>
          <button onClick={() => setNotice({ id: ++id.current, kind: 'success', message: '保存成功' })}>Success</button>
          <button onClick={() => setNotice({ id: ++id.current, kind: 'error', message: '保存失败' })}>Error</button>
          <button onClick={() => setNotice(null)}>Unmount</button>
          <output aria-label="Close count">{closed}</output>
          <div id="toast" style={{ marginTop: 24 }}>
            {notice && <SettingsToast notice={notice} close={close} />}
          </div>
          <button style={{ marginTop: 24 }}>Outside</button>
        </main>;
      }
      createRoot(document.getElementById('root')).render(<Fixture />);`,
  },
  bundle: true,
  write: false,
  jsx: 'automatic',
  platform: 'browser',
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
});

for (const flavor of ['chrome', 'edge']) {
  test(`${flavor}: settings notification lifecycle stays with the host`, { timeout: 30000 }, async () => {
    const assets = join(root, '.output', `${flavor}-mv3`, 'assets');
    const cssName = (await readdir(assets)).find((name) => /^(?:popup|style)-.*\.css$/.test(name));
    assert.ok(cssName, 'Build the extension first');
    const css = await readFile(join(assets, cssName), 'utf8');
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<!doctype html><title>Settings Toast lifecycle</title><div id="root"></div>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
      const executablePath =
        flavor === 'chrome'
          ? join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe')
          : join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe');
      browser = await chromium.launch({ executablePath, headless: true });
      const page = await browser.newPage({ viewport: { width: 360, height: 600 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.clock.install({ time: new Date('2026-10-30T00:00:00Z') });
      await page.clock.pauseAt(new Date('2026-10-30T00:00:01Z'));
      await page.addStyleTag({ content: css });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const success = page.getByRole('status').filter({ hasText: '保存成功' });
      const failure = page.getByRole('alert').filter({ hasText: '保存失败' });
      const close = page.getByRole('button', { name: '关闭提示', exact: true });
      const count = page.getByLabel('Close count');

      await page.getByRole('button', { name: 'Success', exact: true }).click();
      await expect(success).toBeVisible();
      await page.mouse.move(0, 0);
      await page.clock.fastForward(3999);
      await expect(success).toBeVisible();
      await page.clock.fastForward(1);
      await expect(success).toHaveCount(0);
      await expect(count).toHaveText('1');

      await page.getByRole('button', { name: 'Success', exact: true }).click();
      await success.hover();
      await page.clock.fastForward(10000);
      await expect(success).toBeVisible();
      await page.mouse.move(0, 0);
      await page.clock.fastForward(3999);
      await expect(success).toBeVisible();
      await page.clock.fastForward(1);
      await expect(success).toHaveCount(0);
      await expect(count).toHaveText('2');

      await page.getByRole('button', { name: 'Success', exact: true }).click();
      await close.focus();
      await page.mouse.move(0, 0);
      await page.clock.fastForward(10000);
      await expect(success).toBeVisible();
      await page.getByRole('button', { name: 'Outside', exact: true }).focus();
      await page.clock.fastForward(4000);
      await expect(success).toHaveCount(0);
      await expect(count).toHaveText('3');

      await page.getByRole('button', { name: 'Error', exact: true }).click();
      await page.clock.fastForward(60000);
      await expect(failure).toBeVisible();
      await close.focus();
      await page.keyboard.press('Enter');
      await expect(failure).toHaveCount(0);
      await expect(count).toHaveText('4');

      await page.getByRole('button', { name: 'Success', exact: true }).click();
      await expect(success).toBeVisible();
      await page.mouse.move(0, 0);
      await page.clock.fastForward(3999);
      await page.getByRole('button', { name: 'Error', exact: true }).click();
      await page.clock.fastForward(10000);
      await expect(failure).toBeVisible();
      await expect(count).toHaveText('4');
      await close.click();
      await expect(failure).toHaveCount(0);
      await expect(count).toHaveText('5');

      await page.getByRole('button', { name: 'Success', exact: true }).click();
      await expect(success).toBeVisible();
      await page.getByRole('button', { name: 'Unmount', exact: true }).click();
      await page.clock.fastForward(10000);
      await expect(count).toHaveText('5');

      await page.getByRole('button', { name: 'Success', exact: true }).click();
      await close.focus();
      await page.mouse.move(0, 0);
      // An asynchronous result replaces the notice without moving focus to an external button.
      await page.getByRole('button', { name: 'Success', exact: true }).evaluate((button) => button.click());
      await expect(success).toBeVisible();
      await page.clock.fastForward(3999);
      await expect(success).toBeVisible();
      await page.clock.fastForward(1);
      await expect(success).toHaveCount(0);
      await expect(count).toHaveText('6');
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
}
