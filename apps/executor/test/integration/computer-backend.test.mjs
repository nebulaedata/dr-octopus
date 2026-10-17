/**
 * @author Codex
 * @description Exercises the fixed upstream engine against one owned Electron text window, refusing input unless Win32 foreground identity matches.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { _electron as electron, expect } from '@playwright/test';
import { ComputerBackend } from '../../src/runtime/computer/computer-backend.ts';
import { ComputerTools } from '../../src/runtime/computer/computer-tools.ts';
import { ComputerUseActivity } from '../../src/runtime/computer/computer-use-activity.ts';
const root = fileURLToPath(new URL('../../', import.meta.url));
const execute = promisify(execFile);

test(
  'real upstream screenshots, UIA and text input operate only in an owned foreground fixture',
  { timeout: 150000 },
  async () => {
    const data = await mkdtemp(join(tmpdir(), 'octopus-upstream-desktop-'));
    const title = 'Octopus upstream fixture ' + randomUUID();
    const entry = join(data, 'fixture.cjs');
    await writeFile(
      entry,
      `const {app,BrowserWindow}=require('electron');app.commandLine.appendSwitch('force-renderer-accessibility');app.setPath('userData',${JSON.stringify(join(data, 'profile'))});app.whenReady().then(async()=>{globalThis.win=new BrowserWindow({title:${JSON.stringify(title)},width:640,height:480,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadURL('about:blank');win.setAlwaysOnTop(true);win.show();win.focus();});`
    );
    const backend = new ComputerBackend(join(root, 'dist'));
    let app;
    let tools;
    try {
      const connection = await backend.connect();
      app = await electron.launch({ args: [entry] });
      const page = await app.firstWindow();
      await page.setContent(
        `<title>${title}</title><h1>请点击下面输入框，然后暂时不要操作键鼠</h1><textarea aria-label="Owned test input" autofocus></textarea>`
      );
      await page.locator('textarea').focus();
      await app.evaluate(({ app }) => {
        app.focus();
        globalThis.win.focus();
      });
      /**
       * Reads only the current foreground title and rejects before any upstream input can target another application.
       */
      const foreground = async () => {
        const result = await execute(
          join(root, 'dist/resources/computer/python.exe'),
          [
            '-I',
            '-B',
            '-c',
            'import ctypes as c;u=c.WinDLL("user32");u.GetForegroundWindow.restype=c.c_void_p;u.GetWindowTextW.argtypes=[c.c_void_p,c.c_wchar_p,c.c_int];b=c.create_unicode_buffer(512);u.GetWindowTextW(u.GetForegroundWindow(),b,512);print(b.value)',
          ],
          { windowsHide: true, timeout: 5000 }
        );
        assert.equal(result.stdout.trim(), title, 'Win32 foreground must be the owned fixture before input');
      };
      await expect
        .poll(
          async () => {
            try {
              await foreground();
              return true;
            } catch {
              return false;
            }
          },
          { timeout: 60000 }
        )
        .toBe(true);
      await expect
        .poll(
          async () =>
            (await connection.callTool('ControlStatus', {}, { timeoutMs: 10000 })).structuredContent.state,
          {
            timeout: 15000,
          }
        )
        .toBe('ready');
      tools = new ComputerTools(new ComputerUseActivity(() => {}), connection);
      const taskId = randomUUID();
      tools.startTask(taskId);
      /**
       * Uses fresh operation keys and validates input ownership immediately before every mutating test call.
       */
      const call = async (name, args = {}, mutates = false) => {
        if (mutates) {
          await foreground();
        }
        return tools.call(taskId, name, { taskId, idempotencyKey: randomUUID(), ...args });
      };
      const region = await app.evaluate(({ screen }) => {
        const b = screen.dipToScreenRect(globalThis.win, globalThis.win.getBounds());
        return [b.x, b.y, b.x + b.width, b.y + b.height];
      });
      const shot = await call('computer.screenshot', { region });
      assert.equal(shot.computerContent.filter((c) => c.type === 'image').length, 1);
      const snapshot = await call('computer.snapshot', { image: true, region });
      assert.equal(snapshot.computerContent.filter((block) => block.type === 'image').length, 1);
      assert.ok(
        snapshot.computerContent.some(
          (block) => block.type === 'text' && block.text.includes('Owned test input')
        )
      );
      const box = await page.locator('textarea').boundingBox();
      assert.ok(box);
      const point = await app.evaluate(({ screen }, box) => {
        const b = globalThis.win.getContentBounds();
        const p = screen.dipToScreenPoint({
          x: b.x + box.x + box.width / 2,
          y: b.y + box.y + box.height / 2,
        });
        return [Math.round(p.x), Math.round(p.y)];
      }, box);
      const text = 'Octopus 上游验证 ' + randomUUID();
      await call('computer.type', { text, point }, true);
      await expect(page.locator('textarea')).toHaveValue(text);
      await call('computer.shortcut', { shortcut: 'ctrl+a' }, true);
      await call('computer.type', { text: 'Completed', point, clear: true }, true);
      await expect(page.locator('textarea')).toHaveValue('Completed');
      console.log(
        JSON.stringify({
          upstream: connection.readStatus().upstreamVersion,
          screenshot: true,
          snapshot: true,
          typed: true,
          shortcut: true,
        })
      );
    } finally {
      await tools?.close();
      await backend.close();
      await app?.close();
      assert.ok(data.startsWith(join(tmpdir(), 'octopus-upstream-desktop-')));
      await rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
);
