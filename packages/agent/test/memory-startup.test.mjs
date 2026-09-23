/**
 * @author Codex
 * @description Verifies default memory startup from source and built entrypoints in isolated processes.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { stopMemoryService } from '../dist/extensions/memory/sdk/lifecycle.js';

const execute = promisify(execFile);
for (const entry of ['src/extensions/memory/index.ts', 'dist/extensions/memory/index.js']) {
  test(`${entry}: session startup resolves default migrations without an override`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'memory-default-startup-'));
    t.after(async () => {
      await stopMemoryService(root);
      await rm(root, { recursive: true, force: true });
    });
    const moduleUrl = new URL(`../${entry}`, import.meta.url).href;
    const script = `
      import { createMemoryExtension } from ${JSON.stringify(moduleUrl)};
      const handlers = new Map();
      const statuses = [];
      createMemoryExtension({ dataRoot: ${JSON.stringify(root)} })({
        on: (name, handler) => handlers.set(name, handler),
        registerTool() {}, registerCommand() {},
      });
      const ctx = { mode: 'rpc', ui: { setStatus: (_key, text) => statuses.push(JSON.parse(text)) } };
      try {
        await handlers.get('session_start')({}, ctx);
        await handlers.get('session_start')({}, ctx);
        const deadline = Date.now() + 20000;
        while (statuses.length < 1 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
        console.log(JSON.stringify(statuses));
      } finally { await handlers.get('session_shutdown')({}, ctx); }
    `;
    // Separate processes avoid loading source and built Koffi native type definitions together.
    const { stdout } = await execute(
      process.execPath,
      [...(entry.endsWith('.ts') ? ['--import', 'tsx'] : []), '--input-type=module', '-e', script],
      { cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 30_000 }
    );
    const statuses = JSON.parse(stdout.trim());
    assert.equal(statuses.length, 1, 'only the latest startup generation may publish readiness');
    assert.equal(typeof statuses[0].storeId, 'string');
    for (const status of statuses) {
      assert.equal(status.availability, 'ready');
      assert.equal(status.mode, 'auto');
      assert.equal(status.errorCode, undefined);
    }
  });
}
