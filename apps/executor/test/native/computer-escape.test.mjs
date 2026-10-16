/**
 * @author Codex
 * @description Verifies Escape registration retirement and automatic environment cleanup using the fixed private Node in an isolated child without dispatching input.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('native Escape readiness races retire safely and an active hook never prevents owned Node exit', async () => {
  const privateNode = fileURLToPath(new URL('../../dist/resources/node/node.exe', import.meta.url));
  const addon = fileURLToPath(new URL('../../dist/native/computer-escape.node', import.meta.url));
  const script = `
    const watcher = require(${JSON.stringify(addon)});
    const keepAlive = setTimeout(() => { console.error('ESCAPE_READY_TIMEOUT'); process.exitCode = 1; }, 3000);
    (async () => {
      for (let index = 0; index < 50; index++) {
        const ready = watcher.start(() => {});
        const settled = ready.catch(() => {});
        watcher.stop();
        await settled;
      }
      await watcher.start(() => {});
      console.log('ESCAPE_REGISTERED');
      clearTimeout(keepAlive);
      // Leave the final watcher active: Node's environment owner must stop its thread and release the TSFN.
    })().catch(() => { clearTimeout(keepAlive); console.error('ESCAPE_NATIVE_FAILED'); process.exitCode = 1; });
  `;
  const result = await promisify(execFile)(privateNode, ['-e', script], {
    env: { SystemRoot: process.env.SystemRoot },
    windowsHide: true,
    timeout: 10000,
  });
  assert.equal(result.stdout.trim(), 'ESCAPE_REGISTERED');
  assert.equal(result.stderr, '');
});
