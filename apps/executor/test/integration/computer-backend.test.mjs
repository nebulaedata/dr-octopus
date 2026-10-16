/**
 * @author Codex
 * @description Validates private Python guarded capture and real Literal input against one owned Electron fixture, with actual painted overlay confirmation.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { _electron as electron, expect } from '@playwright/test';
import { ComputerUseActivity } from '../../src/runtime/computer/computer-use-activity.ts';
import { ComputerRuntime } from '../../src/runtime/computer/computer-runtime.ts';
import { captureSchema } from '../../src/runtime/computer/computer-inputs.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const selectedDisplay = process.env.EXECUTOR_COMPUTER_DISPLAY;
const manualActivation = process.env.EXECUTOR_COMPUTER_MANUAL_ACTIVATION === '1';
if (selectedDisplay !== undefined && !/^(?:[0-9]|1[0-5])$/.test(selectedDisplay)) {
  throw new Error('Fixture display must be an explicit index from 0 to 15');
}

test(
  'guarded private Python captures and types only into an owned window after actual display-edge feedback is painted',
  { timeout: manualActivation ? 180000 : 60000 },
  async () => {
    const data = await mkdtemp(join(tmpdir(), 'octopus-computer-real-'));
    const entry = join(data, 'fixture.cjs');
    const title = 'Octopus isolated Computer fixture ' + randomUUID();
    await build({
      stdin: {
        resolveDir: root,
        loader: 'ts',
        contents: `
    import {app,BrowserWindow,protocol,net,screen} from 'electron';
    import {pathToFileURL} from 'node:url';
    import {resolveUiAsset} from './src/main/resource-paths';
    import {ComputerUseIndicator} from './src/main/computer-use-indicator';
    app.setPath('userData',${JSON.stringify(join(data, 'profile'))});
    protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true}}]);
    globalThis.ready=app.whenReady().then(async()=>{
      protocol.handle('app',async request=>{const file=await resolveUiAsset(${JSON.stringify(join(root, 'dist/renderer'))},request.url);if(!file)return new Response(null,{status:404});return net.fetch(pathToFileURL(file).href);});
      globalThis.indicator=new ComputerUseIndicator('app://ui/computer-use-overlay.html');
      const displays=screen.getAllDisplays();
      const display=${selectedDisplay === undefined ? 'screen.getPrimaryDisplay()' : 'displays[' + selectedDisplay + ']'};
      if(!display || display.workArea.width < 800 || display.workArea.height < 600) throw new Error('Selected fixture display unavailable or too small');
      const area=display.workArea;
      globalThis.window=new BrowserWindow({title:${JSON.stringify(title)},x:area.x+80,y:area.y+80,width:500,height:400,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
      globalThis.window.setAlwaysOnTop(true);
      await globalThis.window.loadURL('about:blank');
      globalThis.window.show();app.focus();globalThis.window.focus();
    });
  `,
      },
      outfile: entry,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
    });
    let app;
    let tools;
    let owner;
    let backend;
    let published = Promise.resolve();
    try {
      // Negotiate the fixed backend before opening the owned desktop fixture; no startup resource digest preflight.
      const { createComputerBackend } = createRequire(import.meta.url)(
        join(root, 'dist/runtime/computer-backend.cjs')
      );
      backend = createComputerBackend(join(root, 'dist'));
      const connection = await backend.connect();
      const callProduct = connection.callProduct.bind(connection);
      /**
       * Records contract diagnostics without retaining captured pixels, window titles or input contents.
       */
      connection.callProduct = async (name, input) => {
        const started = performance.now();
        try {
          const value = await callProduct(name, input);
          if (name === 'ExecutorCapture') {
            const parsed = captureSchema.safeParse(value);
            console.log(
              JSON.stringify({
                stage: 'computer-capture-contract',
                elapsedMs: Math.round(performance.now() - started),
                schemaValid: parsed.success,
                issues: parsed.success ? [] : parsed.error.issues.map(({ code, path }) => ({ code, path })),
                imageSizePx: value.imageSizePx,
                pngHeader: Buffer.from(value.image?.data ?? '', 'base64')
                  .subarray(0, 33)
                  .toString('hex'),
              })
            );
          }
          return value;
        } catch (error) {
          if (name === 'ExecutorCapture') {
            console.log(
              JSON.stringify({
                stage: 'computer-capture-backend-failed',
                elapsedMs: Math.round(performance.now() - started),
                error: error instanceof Error ? error.message : 'Unknown failure',
              })
            );
          }
          throw error;
        }
      };
      app = await electron.launch({
        executablePath: fileURLToPath(
          new URL('../../node_modules/electron/dist/electron.exe', import.meta.url)
        ),
        args: [entry],
      });
      await app.evaluate(() => globalThis.ready);
      const page = await app.firstWindow();
      await page.setContent(
        `<title>${title}</title><style>body{margin:20px;background:white;color:black}textarea{width:350px;height:180px}</style><h1>Isolated Computer fixture</h1><textarea autofocus aria-label="Fixture input"></textarea><button id="fixture-button">Fixture click</button>`
      );
      await page.evaluate(() => {
        globalThis.fixtureClicks = 0;
        globalThis.fixtureWheels = 0;
        document.querySelector('button').addEventListener('click', () => {
          globalThis.fixtureClicks++;
        });
        document.querySelector('button').addEventListener('wheel', () => {
          globalThis.fixtureWheels++;
        });
      });
      if (manualActivation) {
        await page.evaluate(() => {
          document.querySelector('h1').textContent = 'Computer 本机测试';
          const instruction = document.createElement('p');
          instruction.id = 'manual-instruction';
          instruction.textContent = '请点击下方输入框一次，然后暂时不要操作键鼠。测试只操作本窗口。';
          document.querySelector('textarea').before(instruction);
          globalThis.fixtureManualActivated = false;
          document.querySelector('textarea').addEventListener('pointerdown', (event) => {
            if (event.isTrusted) {
              globalThis.fixtureManualActivated = true;
            }
          });
        });
      }
      await page.locator('textarea').focus();
      await app.evaluate(({ app }) => {
        app.focus();
        globalThis.window.focus();
      });
      const activity = new ComputerUseActivity(
        (snapshot) => {
          published = app.evaluate((_electron, value) => globalThis.indicator.update(value), snapshot);
        },
        async (revision) => {
          await published;
          const visible = await app.evaluate(
            (_electron, value) => globalThis.indicator.confirmVisible(value),
            revision
          );
          assert.equal(visible, true);
          const coverage = await app.evaluate(async ({ BrowserWindow, screen }) => {
            const displays = screen.getAllDisplays();
            return Promise.all(
              displays.map(async (display) => {
                const overlay = BrowserWindow.getAllWindows().find(
                  (window) =>
                    window !== globalThis.window &&
                    JSON.stringify(window.getBounds()) === JSON.stringify(display.bounds)
                );
                return overlay
                  ? {
                      bounds: overlay.getBounds(),
                      content: overlay.getContentBounds(),
                      image: (await overlay.webContents.capturePage()).getSize(),
                      scale: display.scaleFactor,
                    }
                  : null;
              })
            );
          });
          assert.ok(coverage.every(Boolean));
          for (const display of coverage) {
            assert.deepEqual(display.content, display.bounds);
            assert.equal(display.image.height, Math.round(display.bounds.height * display.scale));
          }
        }
      );
      owner = new ComputerRuntime(activity, backend);
      await owner.start();
      tools = owner.tools;
      assert.equal(tools.available(), true);
      const taskId = randomUUID();
      const inventory = await tools.call('fixture-owner', taskId, 'computer_windows', { taskId });
      const target = inventory.windows.find((window) => window.title === title);
      assert.ok(target, 'The owned test window must be enumerated');
      const handle = await app.evaluate(() =>
        globalThis.window.getNativeWindowHandle().readBigUInt64LE().toString()
      );
      if (manualActivation) {
        console.log(
          JSON.stringify({ stage: 'computer-waiting-for-manual-activation', title, timeoutMs: 90000 })
        );
        // This bounded human setup wait changes no product action budget or foreground guard.
        await expect
          .poll(
            async () => {
              const clicked = await page.evaluate(() => globalThis.fixtureManualActivated);
              if (!clicked) {
                return false;
              }
              const metadata = await connection.callProduct('ExecutorDesktopMeta', { contractVersion: 1 });
              return metadata.interactive && metadata.foreground?.hwnd === handle;
            },
            { timeout: 90000, intervals: [250, 500] }
          )
          .toBe(true);
        await page.evaluate(() => {
          document.querySelector('#manual-instruction').textContent = '正在测试，请暂时不要操作键鼠。';
        });
        console.log(
          JSON.stringify({ stage: 'computer-manual-activation-confirmed', foregroundMatchesOwned: true })
        );
      }
      const foreground = await promisify(execFile)(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class FixtureForeground { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }'; [FixtureForeground]::GetForegroundWindow().ToInt64() -eq ${handle}`,
        ],
        { windowsHide: true }
      );
      console.log(
        JSON.stringify({
          stage: 'computer-foreground-check',
          manualActivation,
          foregroundMatchesOwned: foreground.stdout.trim() === 'True',
          fixture: await app.evaluate(() => ({
            visible: globalThis.window.isVisible(),
            focused: globalThis.window.isFocused(),
          })),
        })
      );
      assert.equal(
        foreground.stdout.trim(),
        'True',
        'The owned fixture must be the actual Windows foreground window before desktop acceptance; do not bypass the input guard'
      );
      tools.startTask(taskId);
      await published;
      assert.equal(
        await app.evaluate(
          (_electron, revision) => globalThis.indicator.confirmVisible(revision),
          activity.snapshot().revision
        ),
        true
      );
      const overlayHandles = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .filter((window) => window !== globalThis.window)
          .map((window) => window.getNativeWindowHandle().readBigUInt64LE().toString())
      );
      const observation = await tools.call('fixture-owner', taskId, 'computer_observe', {
        taskId,
        windowId: target.windowId,
      });
      assert.equal(observation.image.mimeType, 'image/png');
      assert.ok(observation.imageSizePx.width > 100);
      const result = await tools.call('fixture-owner', taskId, 'computer_type', {
        taskId,
        windowId: target.windowId,
        observationId: observation.observationId,
        text: '中文😀{Enter}+ literal',
        idempotencyKey: 'literal',
      });
      assert.equal(result.businessEffect, 'applied');
      await expect(page.locator('textarea')).toHaveValue('中文😀{Enter}+ literal');
      const next = await tools.call('fixture-owner', taskId, 'computer_observe', {
        taskId,
        windowId: target.windowId,
      });
      assert.equal(
        (
          await tools.call('fixture-owner', taskId, 'computer_key', {
            taskId,
            windowId: target.windowId,
            observationId: next.observationId,
            key: 'Enter',
            idempotencyKey: 'enter',
          })
        ).businessEffect,
        'applied'
      );
      await expect(page.locator('textarea')).toHaveValue('中文😀{Enter}+ literal\n');
      const clearObservation = await tools.call('fixture-owner', taskId, 'computer_observe', {
        taskId,
        windowId: target.windowId,
      });
      assert.equal(
        (
          await tools.call('fixture-owner', taskId, 'computer_type', {
            taskId,
            windowId: target.windowId,
            observationId: clearObservation.observationId,
            text: 'replaced 中文',
            clear: true,
            idempotencyKey: 'clear',
          })
        ).businessEffect,
        'applied'
      );
      await expect(page.locator('textarea')).toHaveValue('replaced 中文');
      const pointerObservation = await tools.call('fixture-owner', taskId, 'computer_observe', {
        taskId,
        windowId: target.windowId,
      });
      const button = await page.locator('button').boundingBox();
      assert.ok(button);
      const content = await app.evaluate(({ screen }) =>
        screen.dipToScreenRect(globalThis.window, globalThis.window.getContentBounds())
      );
      const scale = await page.evaluate(() => window.devicePixelRatio);
      const point = {
        x: Math.floor(
          ((content.x + (button.x + button.width / 2) * scale - pointerObservation.captureRectPx.left) *
            pointerObservation.imageSizePx.width) /
            pointerObservation.captureRectPx.width
        ),
        y: Math.floor(
          ((content.y + (button.y + button.height / 2) * scale - pointerObservation.captureRectPx.top) *
            pointerObservation.imageSizePx.height) /
            pointerObservation.captureRectPx.height
        ),
        coordinateSpace: 'observation_image_px',
      };
      assert.equal(
        (
          await tools.call('fixture-owner', taskId, 'computer_click', {
            taskId,
            windowId: target.windowId,
            observationId: pointerObservation.observationId,
            point,
            idempotencyKey: 'click',
          })
        ).businessEffect,
        'applied'
      );
      await expect.poll(() => page.evaluate(() => globalThis.fixtureClicks)).toBe(1);
      const scrollObservation = await tools.call('fixture-owner', taskId, 'computer_observe', {
        taskId,
        windowId: target.windowId,
      });
      assert.equal(
        (
          await tools.call('fixture-owner', taskId, 'computer_scroll', {
            taskId,
            windowId: target.windowId,
            observationId: scrollObservation.observationId,
            point,
            direction: 'down',
            count: 1,
            idempotencyKey: 'scroll',
          })
        ).businessEffect,
        'applied'
      );
      await expect.poll(() => page.evaluate(() => globalThis.fixtureWheels)).toBe(1);
      // Exercise Python's checks directly, independently of the Runtime's earlier validation.
      const nativeMeta = await connection.callProduct('ExecutorDesktopMeta', { contractVersion: 1 });
      const nativeWindow = nativeMeta.windows.find((item) => item.title === title);
      assert.ok(nativeWindow);
      const nativeTarget = {
        contractVersion: 1,
        desktopSessionId: nativeMeta.desktopSessionId,
        layoutVersion: nativeMeta.layoutVersion,
        identity: nativeWindow.identity,
        expectedBoundsPx: nativeWindow.bounds,
      };
      for (const changed of [
        { desktopSessionId: 'wrong-session' },
        { layoutVersion: 'wrong-layout' },
        { identity: { ...nativeWindow.identity, pid: nativeWindow.identity.pid + 1 } },
        { identity: { ...nativeWindow.identity, processStartedAt: '0' } },
        { expectedBoundsPx: { ...nativeWindow.bounds, left: nativeWindow.bounds.left + 1 } },
      ]) {
        const rejected = await connection.callProduct('ExecutorInput', {
          ...nativeTarget,
          ...changed,
          action: { kind: 'type', text: 'must not type', clear: false },
        });
        assert.deepEqual(rejected, { contractVersion: 1, effect: 'not_applied', code: 'TARGET_CHANGED' });
      }
      await expect(page.locator('textarea')).toHaveValue('replaced 中文');
      assert.equal(
        (
          await tools.call('fixture-owner', taskId, 'computer_focus', {
            taskId,
            windowId: target.windowId,
            idempotencyKey: 'focus-current',
          })
        ).businessEffect,
        'applied'
      );

      // A non-focusable owned cover blocks pointer input without stealing the target's foreground.
      const coverPosition = await app.evaluate(() => globalThis.window.getContentBounds());
      await app.evaluate(
        async ({ BrowserWindow }, position) => {
          globalThis.cover = new BrowserWindow({
            x: Math.floor(position.x),
            y: Math.floor(position.y),
            width: 160,
            height: 100,
            frame: false,
            focusable: false,
            show: false,
            alwaysOnTop: true,
            webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
          });
          globalThis.cover.setAlwaysOnTop(true, 'screen-saver');
          await globalThis.cover.loadURL('about:blank');
          globalThis.cover.showInactive();
        },
        { x: coverPosition.x + button.x, y: coverPosition.y + button.y }
      );
      const covered = await tools.call('fixture-owner', taskId, 'computer_observe', {
        taskId,
        windowId: target.windowId,
      });
      assert.deepEqual(
        await tools.call('fixture-owner', taskId, 'computer_click', {
          taskId,
          windowId: target.windowId,
          observationId: covered.observationId,
          point,
          idempotencyKey: 'covered',
        }),
        { businessEffect: 'not_applied', code: 'TARGET_CHANGED' }
      );
      await expect.poll(() => page.evaluate(() => globalThis.fixtureClicks)).toBe(1);
      await app.evaluate(() => globalThis.cover.destroy());

      // Foreground changes only to another owned fixture: the Python boundary must refuse text.
      await app.evaluate(async ({ BrowserWindow }) => {
        const ownedBounds = globalThis.window.getBounds();
        globalThis.other = new BrowserWindow({
          x: ownedBounds.x + 100,
          y: ownedBounds.y + 100,
          width: 300,
          height: 200,
          show: false,
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
        });
        await globalThis.other.loadURL('about:blank');
        globalThis.other.show();
        globalThis.other.focus();
      });
      assert.deepEqual(
        await connection.callProduct('ExecutorInput', {
          ...nativeTarget,
          action: { kind: 'type', text: 'must not type', clear: false },
        }),
        { contractVersion: 1, effect: 'not_applied', code: 'TARGET_CHANGED' }
      );
      await app.evaluate(() => {
        globalThis.other.destroy();
        globalThis.window.focus();
      });
      await expect(page.locator('textarea')).toHaveValue('replaced 中文');
      const stale = await tools.call('fixture-owner', taskId, 'computer_observe', {
        taskId,
        windowId: target.windowId,
      });
      await app.evaluate(() => {
        const ownedBounds = globalThis.window.getBounds();
        globalThis.window.setPosition(ownedBounds.x + 20, ownedBounds.y + 20);
      });
      await assert.rejects(
        tools.call('fixture-owner', taskId, 'computer_type', {
          taskId,
          windowId: target.windowId,
          observationId: stale.observationId,
          text: 'must not type',
          idempotencyKey: 'moved',
        })
      );
      await expect(page.locator('textarea')).toHaveValue('replaced 中文');
      await published;
      assert.equal(
        activity.snapshot().state,
        'running',
        'Feedback must stay visible between completed Computer calls'
      );
      assert.deepEqual(
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .filter((window) => window !== globalThis.window)
            .map((window) => window.getNativeWindowHandle().readBigUInt64LE().toString())
        ),
        overlayHandles,
        'The whole sequence must retain the original native feedback windows'
      );
      tools.release(taskId);
      await published;
      assert.equal(activity.snapshot().state, 'idle');
      await app.evaluate(() => globalThis.indicator.dispose());
    } finally {
      await owner?.close();
      await backend?.close();
      await published;
      await app?.close();
      assert.ok(data.startsWith(join(tmpdir(), 'octopus-computer-real-')));
      await rm(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
);
