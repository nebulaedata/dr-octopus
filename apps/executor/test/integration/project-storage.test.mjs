/**
 * @author Codex
 * @description Verifies the built application stores business data solely in its isolated project and restores identity and grants.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readdir, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { _electron as electron, expect } from '@playwright/test';

test(
  'business data survives complete restart independently of AppData leftovers',
  { timeout: 90000 },
  async () => {
    const data = await mkdtemp(join(tmpdir(), 'octopus-storage-ui-'));
    const appRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
    let app;
    try {
      await mkdir(join(data, '.octopus-executor-recovery-control'));
      await writeFile(
        join(data, '.octopus-executor-recovery-control', 'events.jsonl'),
        '{old invalid format'
      );
      let original;
      for (let cycle = 0; cycle < 2; cycle++) {
        app = await electron.launch({
          cwd: appRoot,
          args: [appRoot, '--executor-test', '--executor-test-data=' + data],
        });
        const page = await app.firstWindow();
        await expect
          .poll(async () => (await page.evaluate(() => window.executor.readStatus())).data?.state, {
            timeout: 15000,
          })
          .toBe('ready');
        const settings = await page.evaluate(() => window.executor.readSettings());
        assert.equal(settings.ok, true);
        if (cycle === 0) {
          original = settings.data.device;
          const grant = await page.evaluate(() =>
            window.executor.approveAccess({
              label: 'persisted project grant',
              permissions: ['files.read'],
              waitBudgetMs: 120000,
            })
          );
          assert.equal(
            grant.ok,
            true,
            JSON.stringify({ grant, status: await page.evaluate(() => window.executor.readStatus()) })
          );
        } else {
          assert.deepEqual(settings.data.device, original);
          const grants = await page.evaluate(() => window.executor.readAccess());
          assert.equal(grants.data.clients.length, 1);
          assert.equal(grants.data.clients[0].label, 'persisted project grant');
        }
        const project = join(data, 'project');
        const names = await readdir(project);
        for (const name of [
          'settings.json',
          'settings-recovery',
          'device',
          'connections',
          'tasks',
          'browser',
          'file-operations',
          'shell',
          'transfers',
        ]) {
          assert.ok(names.includes(name), name);
        }
        for (const name of [
          'device',
          'connections',
          'tasks',
          'browser',
          'file-operations',
          'shell',
          'transfers',
          'settings-recovery',
        ]) {
          assert.equal((await readdir(data)).includes(name), false);
        }
        await app.close();
        app = undefined;
      }
    } finally {
      await app?.close();
      await rm(data, { recursive: true, force: true });
    }
  }
);
