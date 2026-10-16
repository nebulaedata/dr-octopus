/**
 * @author Codex
 * @description Verifies actual Electron overlay bounds, transparency, non-focusable native styles and disposal in an isolated fixture.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { _electron as electron } from '@playwright/test';
const run = promisify(execFile);
const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));

test(
  'local overlay keeps native windows throughout a Computer task and uncertainty without focus or input capture',
  { timeout: 60000 },
  async () => {
    const data = await mkdtemp(join(tmpdir(), 'octopus-indicator-'));
    const entry = join(data, 'fixture.cjs');
    await build({
      stdin: {
        resolveDir: root,
        contents: `
    import { app, BrowserWindow, protocol, net, screen } from 'electron';
    import { pathToFileURL } from 'node:url';
    import { resolveUiAsset } from './src/main/resource-paths';
    import { ComputerUseIndicator } from './src/main/computer-use-indicator';
    import { ComputerUseActivity } from './src/runtime/computer/computer-use-activity';
    app.setPath('userData', ${JSON.stringify(join(data, 'profile'))});
    protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true}}]);
    app.on('window-all-closed',()=>{});
    globalThis.fixtureReady=app.whenReady().then(async()=>{
      protocol.handle('app',async request=>{
        const file=await resolveUiAsset(${JSON.stringify(join(root, 'dist/renderer'))},request.url);
        if(!file)return new Response(null,{status:404});
        const response=await net.fetch(pathToFileURL(file).href);
        const headers=new Headers(response.headers);
        headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none'; object-src 'none'");
        return new Response(response.body,{headers});
      });
      globalThis.sentinel=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
      await globalThis.sentinel.loadURL('app://ui/computer-use-overlay.html#running');
      globalThis.indicator=new ComputerUseIndicator('app://ui/computer-use-overlay.html');
      globalThis.activity=new ComputerUseActivity(snapshot=>globalThis.indicator.update(snapshot));
      globalThis.displays=()=>screen.getAllDisplays().map(({bounds})=>bounds);
    });`,
        loader: 'ts',
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
      outfile: entry,
    });
    let app;
    try {
      app = await electron.launch({ cwd: root, args: [entry] });
      const sentinel = await app.firstWindow();
      const errors = [];
      app.on('window', (page) => {
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
          if (message.type() === 'error') {
            errors.push(message.text());
          }
        });
      });
      await sentinel.waitForFunction(() => document.readyState === 'complete');
      await app.evaluate(() => globalThis.fixtureReady);
      const nextOverlay = app.waitForEvent('window');
      const initialFocus = await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id ?? null
      );
      await app.evaluate(() => {
        globalThis.activity.startTask('fixture-task');
        globalThis.first = globalThis.activity.begin();
        globalThis.second = globalThis.activity.begin();
      });
      const overlay = await nextOverlay;
      await overlay.getByText('Computer Use 进行中', { exact: false }).waitFor();
      assert.ok(overlay.url().startsWith('app://ui/computer-use-overlay.html'));
      assert.equal(await overlay.title(), 'Computer Use Indicator');
      await overlay.evaluate(() => {
        window.fixtureDocument = 'persistent';
      });
      await overlay.evaluate(() => document.fonts.ready);
      assert.equal(
        await app.evaluate(() =>
          globalThis.indicator.confirmVisible(globalThis.activity.snapshot().revision)
        ),
        true,
        'every display must complete native show and paint confirmation before inspection'
      );
      const windows = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .filter((w) => w !== globalThis.sentinel)
          .map((w) => ({
            bounds: w.getBounds(),
            focusable: w.isFocusable(),
            top: w.isAlwaysOnTop(),
            visible: w.isVisible(),
            backgroundThrottling: w.webContents.getBackgroundThrottling(),
            preferences: w.webContents.getLastWebPreferences(),
            handle: w.getNativeWindowHandle().readBigUInt64LE().toString(),
          }))
      );
      assert.deepEqual(
        windows.map((w) => w.bounds).sort((a, b) => a.x - b.x || a.y - b.y),
        (await app.evaluate(() => globalThis.displays())).sort((a, b) => a.x - b.x || a.y - b.y)
      );
      for (const window of windows) {
        assert.equal(window.focusable, false);
        assert.equal(window.visible, true);
        assert.equal(window.top, true);
        assert.equal(window.preferences.sandbox, true);
        assert.equal(window.preferences.nodeIntegration, false);
        assert.equal(window.preferences.preload, undefined);
        assert.equal(window.backgroundThrottling, false);
        const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class IndicatorStyles { [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr Read(IntPtr window, int index); }'; [IndicatorStyles]::Read([IntPtr]::new(${window.handle}), -20).ToInt64()`;
        const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
          windowsHide: true,
        });
        const styles = BigInt(result.stdout.trim());
        assert.notEqual(styles & 0x20n, 0n, 'WS_EX_TRANSPARENT must pass input through');
        assert.notEqual(styles & 0x08000000n, 0n, 'WS_EX_NOACTIVATE must preserve input focus');
      }
      assert.equal(
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id ?? null),
        initialFocus
      );
      assert.equal(await overlay.evaluate(() => typeof window.executor), 'undefined');
      assert.equal(
        await overlay.evaluate(() => getComputedStyle(document.body).backgroundColor),
        'rgba(0, 0, 0, 0)'
      );
      const pixels = await overlay.screenshot({ omitBackground: true, animations: 'disabled' });
      const centerAlpha = await app.evaluate(({ nativeImage }, encoded) => {
        const image = nativeImage.createFromBuffer(Buffer.from(encoded, 'base64'));
        const { width, height } = image.getSize();
        return image.toBitmap()[(Math.floor(height / 2) * width + Math.floor(width / 2)) * 4 + 3];
      }, pixels.toString('base64'));
      assert.equal(centerAlpha, 0, 'the desktop center must remain fully transparent');
      const edges = await app.evaluate(({ nativeImage }, encoded) => {
        const image = nativeImage.createFromBuffer(Buffer.from(encoded, 'base64'));
        const { width, height } = image.getSize();
        const pixels = image.toBitmap();
        const alpha = (x, y) => pixels[(y * width + x) * 4 + 3];
        const offsets = [2, 24, 64, 96];
        return [
          offsets.map((y) => alpha(Math.floor(width / 4), y)),
          offsets.map((y) => alpha(Math.floor(width / 4), height - y - 1)),
          offsets.map((x) => alpha(x, Math.floor(height / 2))),
          offsets.map((x) => alpha(width - x - 1, Math.floor(height / 2))),
        ];
      }, pixels.toString('base64'));
      for (const fade of edges) {
        assert.ok(
          fade[0] < 200 && fade[0] > fade[1] && fade[1] > fade[2] && fade[2] > fade[3] && fade[3] === 0,
          'each edge must fade continuously inward with no opaque border or hard inner boundary'
        );
      }
      const cornerRule = await overlay.evaluate(() => {
        const sheet = document.styleSheets[0];
        return sheet.insertRule(
          '.ribbon { clip-path: polygon(12px 0, calc(100% - 12px) 0, 100% 12px, 100% calc(100% - 12px), calc(100% - 12px) 100%, 12px 100%, 0 calc(100% - 12px), 0 12px); }',
          sheet.cssRules.length
        );
      });
      assert.equal(
        await app.evaluate(() =>
          globalThis.indicator.confirmVisible(globalThis.activity.snapshot().revision)
        ),
        true,
        'transparent corners must not reject a ribbon visibly painted on all four sides'
      );
      const hiddenRule = await overlay.evaluate(() => {
        const sheet = document.styleSheets[0];
        return sheet.insertRule('.ribbon { visibility: hidden; }', sheet.cssRules.length);
      });
      assert.equal(
        await app.evaluate(() =>
          globalThis.indicator.confirmVisible(globalThis.activity.snapshot().revision)
        ),
        false,
        'a visible label cannot substitute for actual painted ribbon edges'
      );
      await overlay.evaluate((index) => document.styleSheets[0].deleteRule(index), hiddenRule);
      await overlay.evaluate((index) => document.styleSheets[0].deleteRule(index), cornerRule);
      assert.equal(
        await app.evaluate(() =>
          globalThis.indicator.confirmVisible(globalThis.activity.snapshot().revision - 1)
        ),
        false,
        'paint confirmation for an old revision must never permit input'
      );
      assert.equal(
        await overlay.locator('.ribbon').count(),
        1,
        'all four sides share one continuous color field'
      );
      assert.equal(
        await overlay
          .locator('.ribbon')
          .evaluate((node) => getComputedStyle(node).getPropertyValue('--glow-depth').trim()),
        '96px'
      );
      assert.equal(
        await overlay.locator('.ribbon').evaluate((node) => getComputedStyle(node).animationName),
        'ribbon-flow'
      );
      assert.equal(
        await overlay.locator('.ribbon').evaluate((node) => getComputedStyle(node).animationDuration),
        '8s'
      );
      const badge = overlay.locator('[data-slot="badge"]');
      assert.equal(await badge.evaluate((node) => getComputedStyle(node).animationName), 'pulse');
      const opacity = await badge.evaluate((node) => parseFloat(getComputedStyle(node).opacity));
      await overlay.waitForFunction(
        (before) =>
          Math.abs(
            parseFloat(getComputedStyle(document.querySelector('[data-slot="badge"]')).opacity) - before
          ) > 0.15,
        opacity,
        { timeout: 2500 }
      );
      const angle = await overlay
        .locator('.ribbon')
        .evaluate((node) => parseFloat(getComputedStyle(node).getPropertyValue('--ribbon-angle')));
      await overlay.waitForFunction(
        (before) => {
          const angle = parseFloat(
            getComputedStyle(document.querySelector('.ribbon')).getPropertyValue('--ribbon-angle')
          );
          return (angle - before + 360) % 360 > 60;
        },
        angle,
        { timeout: 3000 }
      );
      const position = await overlay
        .locator('.ribbon')
        .evaluate((node) => getComputedStyle(node).backgroundImage);
      await overlay.waitForFunction(
        (before) => getComputedStyle(document.querySelector('.ribbon')).backgroundImage !== before,
        position
      );
      await overlay.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await badge.evaluate((node) => getComputedStyle(node).animationName), 'none');
      assert.equal(
        await overlay.locator('.ribbon').evaluate((node) => getComputedStyle(node).animationName),
        'none'
      );
      await overlay.emulateMedia({ reducedMotion: 'no-preference' });
      await app.evaluate(() => globalThis.first.complete());
      assert.equal(
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
        windows.length + 1
      );
      await app.evaluate(() => globalThis.second.complete());
      assert.equal(await app.evaluate(() => globalThis.activity.snapshot().state), 'running');
      await app.evaluate(() => {
        globalThis.second = globalThis.activity.begin();
      });
      await app.evaluate(() => globalThis.second.uncertain());
      const unknown = overlay;
      await unknown.getByText('电脑控制状态未知', { exact: false }).waitFor();
      assert.equal(await badge.evaluate((node) => getComputedStyle(node).animationName), 'none');
      assert.equal(await unknown.evaluate(() => window.fixtureDocument), 'persistent');
      assert.deepEqual(
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .filter((w) => w !== globalThis.sentinel)
            .map((w) => w.getNativeWindowHandle().readBigUInt64LE().toString())
        ),
        windows.map((w) => w.handle)
      );
      await app.evaluate(() => globalThis.activity.endTask('fixture-task'));
      assert.equal(await app.evaluate(() => globalThis.activity.snapshot().state), 'unknown');
      assert.equal(
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
        windows.length + 1
      );
      await app.evaluate(() => globalThis.second.complete());
      assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
      assert.deepEqual(errors, [], 'actual overlay renders without console or page errors');
      await app.evaluate(() => {
        globalThis.indicator.dispose();
        globalThis.indicator.dispose();
      });
      assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    } finally {
      await app?.close();
      assert.ok(data.startsWith(join(tmpdir(), 'octopus-indicator-')));
      await rm(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
);
