/**
 * @author Codex
 * @description Verifies trusted local stop through a real Utility Runtime and owned desktop backend, with injected Escape confined to the fixture window.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { build } from 'esbuild';
import { _electron as electron, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));

/**
 * Allocates a loopback port for the isolated Runtime without changing the user's Executor configuration.
 */
async function freePort() {
  const listener = createServer();
  await new Promise((done, failed) => {
    listener.once('error', failed);
    listener.listen(0, '127.0.0.1', done);
  });
  const port = listener.address().port;
  await new Promise((done, failed) => listener.close((error) => (error ? failed(error) : done())));
  return port;
}

/**
 * Requires a successful MCP reply without logging the desktop image or credential.
 */
async function call(client, name, input) {
  const response = await client.callTool({ name, arguments: input });
  assert.notEqual(response.isError, true, JSON.stringify(response.structuredContent));
  return response.structuredContent.data;
}

/**
 * Owns one real Runtime; input acceptance is a separate scene requiring the actual fixture foreground.
 */
async function stopFixture({ verifyInput }) {
  const data = await mkdtemp(join(tmpdir(), 'octopus-computer-stop-'));
  const entry = join(data, 'fixture.cjs');
  await mkdir(join(data, 'runtime'));
  const port = await freePort();
  await build({
    stdin: {
      resolveDir: root,
      loader: 'ts',
      contents: `
        import { app, BrowserWindow, protocol, net } from 'electron';
        import { pathToFileURL } from 'node:url';
        import { createRequire } from 'node:module';
        import { resolveUiAsset } from './src/main/resource-paths';
        import { RuntimeManager } from './src/main/runtime-manager';
        import { ComputerUseIndicator } from './src/main/computer-use-indicator';
        import { ComputerUseEscape } from './src/main/computer-use-escape';
        app.setPath('userData', ${JSON.stringify(join(data, 'profile'))});
        protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true}}]);
        app.on('window-all-closed',()=>{});
        globalThis.fixtureReady=app.whenReady().then(async()=>{
          protocol.handle('app',async request=>{
            const file=await resolveUiAsset(${JSON.stringify(join(root, 'dist/renderer'))},request.url);
            if(!file)return new Response(null,{status:404});
            return net.fetch(pathToFileURL(file).href);
          });
          globalThis.sentinel=new BrowserWindow({title:'OCTOPUS OWNED COMPUTER STOP FIXTURE',width:480,height:300,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
          await globalThis.sentinel.loadURL('data:text/html,<title>OCTOPUS OWNED COMPUTER STOP FIXTURE</title><input autofocus><script>window.escapeCount=0;document.addEventListener("keydown",e=>{if(e.key==="Escape")window.escapeCount++})</script>');
          const native=createRequire(${JSON.stringify(pathToFileURL(join(root, 'package.json')).href)})(${JSON.stringify(join(root, 'dist/native/computer-escape.node'))});
          for(let index=0;index<10;index++) { const ready=native.start(()=>{}); const retired=ready.catch(()=>{}); native.stop(); await retired; }
          globalThis.runtime=new RuntimeManager(${JSON.stringify(join(root, 'dist/runtime/index.cjs'))},${JSON.stringify(join(data, 'runtime'))},${JSON.stringify(join(root, 'dist/native/file-commit.node'))});
          await globalThis.runtime.readSettings();
          await globalThis.runtime.saveSettings({port:${port},networkAddress:null});
          globalThis.indicator=new ComputerUseIndicator('app://ui/computer-use-overlay.html');
          globalThis.escapeOwner=new ComputerUseEscape({start(callback){const ready=native.start(callback);globalThis.hookReady=ready;return ready;},stop(){native.stop();}},(id,pid)=>globalThis.runtime.stopComputerUse(id,pid));
          let revision=0;
          globalThis.runtime.subscribe(snapshot=>{
            globalThis.indicator.update(snapshot.computerUse);
            globalThis.escapeOwner.update(snapshot);
            if(snapshot.computerUse.state==='running'&&snapshot.computerUse.revision>revision) {
              revision=snapshot.computerUse.revision;
              globalThis.indicator.confirmVisible(revision).then(visible=>globalThis.runtime.confirmComputerIndicator(snapshot.computerUse.revision,visible)).catch(()=>{});
            }
          });
          await globalThis.runtime.start();
        });
      `,
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    define: { 'import.meta.url': JSON.stringify(pathToFileURL(entry).href) },
    outfile: entry,
  });
  let app;
  let client;
  try {
    app = await electron.launch({ cwd: root, args: [entry] });
    const sentinel = await app.firstWindow();
    await app.evaluate(() => globalThis.fixtureReady);
    await expect
      .poll(() => app.evaluate(() => globalThis.runtime.readStatus().capabilities.computer.available), {
        timeout: 45000,
      })
      .toBe(true);
    const access = await app.evaluate(() =>
      globalThis.runtime.request({
        type: 'access-approve',
        input: {
          label: 'Owned desktop stop fixture',
          permissions: ['computer.control'],
          waitBudgetMs: 120000,
        },
      })
    );
    assert.equal(access.response.ok, true);
    client = new Client({ name: 'owned-computer-stop-fixture', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(access.response.data.endpoint), {
        requestInit: { headers: { Authorization: 'Bearer ' + access.credential } },
      })
    );
    const task = await call(client, 'task_start', {
      capabilities: ['computer.control'],
      idempotencyKey: 'owned-stop-task',
    });
    await expect.poll(() => app.evaluate(() => !!globalThis.hookReady)).toBe(true);
    await app.evaluate(() => globalThis.hookReady);
    if (verifyInput) {
      if (process.env.EXECUTOR_COMPUTER_MANUAL_ACTIVATION === '1') {
        await sentinel.evaluate(() => {
          const instruction = document.createElement('p');
          instruction.textContent = 'Computer 停止验收：点击下方输入框一次，然后暂时不要操作键鼠。';
          document.querySelector('input').before(instruction);
          window.fixtureActivated = false;
          document.querySelector('input').addEventListener('pointerdown', (event) => {
            if (event.isTrusted) {
              window.fixtureActivated = true;
            }
          });
        });
        console.log('Waiting for activation of OCTOPUS OWNED COMPUTER STOP FIXTURE input.');
        await sentinel.waitForFunction(() => window.fixtureActivated, undefined, { timeout: 30000 });
      }
      const listing = await call(client, 'computer_windows', { taskId: task.taskId });
      const windows = listing.windows.filter(
        (window) => window.title === 'OCTOPUS OWNED COMPUTER STOP FIXTURE'
      );
      assert.equal(windows.length, 1);
      const target = windows[0];
      await app.evaluate(({ app }) => {
        app.focus();
        globalThis.sentinel.show();
        globalThis.sentinel.focus();
      });
      const focus = await call(client, 'computer_focus', {
        taskId: task.taskId,
        windowId: target.windowId,
        idempotencyKey: 'owned-focus',
      });
      assert.equal(focus.businessEffect, 'applied', JSON.stringify(focus));
      const observation = await call(client, 'computer_observe', {
        taskId: task.taskId,
        windowId: target.windowId,
      });
      const key = await call(client, 'computer_key', {
        taskId: task.taskId,
        windowId: observation.windowId,
        observationId: observation.observationId,
        idempotencyKey: 'injected-escape',
        key: 'Escape',
      });
      assert.equal(key.businessEffect, 'applied', JSON.stringify(key));
      await expect.poll(() => sentinel.evaluate(() => window.escapeCount)).toBe(1);
      const active = await app.evaluate(() => globalThis.runtime.readStatus());
      assert.equal(
        active.computerUse.state,
        'running',
        'agent-generated Escape must not activate emergency stop'
      );
    }
    assert.equal(
      await app.evaluate(() => {
        const state = globalThis.runtime.readStatus();
        return globalThis.runtime.stopComputerUse(state.computerUse.activityId, state.pid);
      }),
      true
    );
    await expect
      .poll(() => app.evaluate(() => globalThis.runtime.readStatus().computerUse.state), { timeout: 15000 })
      .toBe('idle');
    await expect
      .poll(() => app.evaluate(() => globalThis.runtime.readStatus().capabilities.computer.state), {
        timeout: 15000,
      })
      .toBe('closed');
    const status = await call(client, 'task_status', { taskId: task.taskId });
    assert.equal(status.task.state, 'cancelled');
    assert.equal(
      (await client.listTools()).tools.some(({ name }) => name.startsWith('computer_')),
      false
    );
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  } finally {
    await client?.close();
    if (app) {
      await app
        .evaluate(async () => {
          globalThis.escapeOwner?.dispose();
          await globalThis.runtime?.stop();
          globalThis.indicator?.dispose();
        })
        .catch(() => {});
      await app.close();
    }
    assert.ok(data.startsWith(join(tmpdir(), 'octopus-computer-stop-')));
    await rm(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

test(
  'trusted local stop drains the real Utility backend and removes its overlays',
  { timeout: 90000 },
  async () => {
    await stopFixture({ verifyInput: false });
  }
);

test(
  'injected Escape reaches the owned foreground window without stopping its task',
  { timeout: 90000 },
  async () => {
    await stopFixture({ verifyInput: true });
  }
);
