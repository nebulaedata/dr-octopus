/**
 * @author Codex
 * @description Verifies the built Computer owner and its real private MCP handshake in Electron Utility and the enabled application capability without touching desktop input.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';
const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));

test(
  'built Computer owner runs in the actual Utility Node and the application reports desktop tools ready',
  { timeout: 60000 },
  async () => {
    const data = await mkdtemp(join(tmpdir(), 'octopus-computer-utility-'));
    const script = join(data, 'owner.cjs');
    await writeFile(
      script,
      `
    const { createComputerBackend } = require(${JSON.stringify(join(root, 'dist/runtime/computer-backend.cjs'))});
    const { ComputerRuntime } = require(${JSON.stringify(join(root, 'dist/runtime/computer-runtime.cjs'))});
    const backend=createComputerBackend(process.argv[2]);
    const owner=new ComputerRuntime({snapshot(){return {state:'idle'};},begin(){throw new Error('No input admitted in this fixture');},endTasks(){}},backend);
    const timer=setInterval(()=>{},1000);
    process.parentPort.on('message',()=>{clearInterval(timer);process.exit(0);});
    (async()=>{
      try {
        const first=owner.start();const same=owner.start()===first;
        await first;
        const contract=owner.status().available;
        const taskId=require('node:crypto').randomUUID();
        const displays=await owner.tools.call('owned-test',taskId,'computer_displays',{taskId});
        if(!displays.displays.length)throw new Error('No actual desktop metadata');
        const connection=await backend.connect();
        const meta=await connection.callProduct('ExecutorDesktopMeta',{contractVersion:1});
        const refused=await connection.callProduct('ExecutorCapture',{contractVersion:1,desktopSessionId:meta.desktopSessionId,layoutVersion:meta.layoutVersion+'-owned-invalid-layout',identity:{hwnd:'1',pid:process.pid,processStartedAt:'1'},expectedBoundsPx:{left:0,top:0,width:1,height:1}});
        if(JSON.stringify(refused)!==JSON.stringify({contractVersion:1,error:{code:'TARGET_CHANGED'}}))throw new Error('Capture refusal contract mismatch');
        await owner.close();
        const closed={executionStopConfirmed:owner.status().state==='closed'};
        process.parentPort.postMessage({same,contract,closed,captureRefusal:refused.error.code,node:process.versions.node});
        // Wait for the parent to acknowledge the result before exiting.
      } catch(error) {
        await owner.close().catch(()=>{});
        process.parentPort.postMessage({error:error.message});
      }
    })();
  `
    );
    let app;
    try {
      app = await electron.launch({
        cwd: root,
        args: [root, '--executor-test', '--executor-test-data=' + join(data, 'profile')],
      });
      const page = await app.firstWindow();
      // A production task can start only after the sole Runtime is healthy; do not race its component startup.
      await page.waitForFunction(
        async () => {
          const status = await window.executor.readStatus();
          return status.ok && status.data.health.state === 'healthy';
        },
        undefined,
        { timeout: 45000 }
      );
      const result = await app.evaluate(
        async ({ utilityProcess }, { script, resourceRoot }) =>
          new Promise((resolve, reject) => {
            const child = utilityProcess.fork(script, [resourceRoot], {
              stdio: 'ignore',
              serviceName: 'Computer owner verification',
            });
            let message;
            const deadline = setTimeout(() => {
              child.kill();
              reject(new Error('Computer Utility verification timed out'));
            }, 50000);
            child.once('message', (value) => {
              message = value;
              child.postMessage('shutdown');
            });
            child.once('exit', (code) => {
              clearTimeout(deadline);
              if (code !== 0 || !message) {
                reject(new Error(JSON.stringify(message)));
              } else {
                resolve(message);
              }
            });
          }),
        { script, resourceRoot: join(root, 'dist') }
      );
      assert.equal(result.error, undefined, JSON.stringify(result));
      assert.equal(result.same, true);
      assert.equal(result.contract, true);
      assert.equal(result.captureRefusal, 'TARGET_CHANGED');
      assert.deepEqual(result.closed, { executionStopConfirmed: true });
      await expect
        .poll(
          () =>
            page.evaluate(
              async () => (await window.executor.readStatus()).data?.capabilities.computer.available
            ),
          { timeout: 45000 }
        )
        .toBe(true);
      const status = await page.evaluate(() => window.executor.readStatus());
      assert.equal(status.data.capabilities.computer.state, 'ready');
    } finally {
      await app?.close();
      assert.ok(data.startsWith(join(tmpdir(), 'octopus-computer-utility-')));
      await rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
);
