/**
 * @author Codex
 * @description Tests authenticated Scheduler event delivery, idle suppression and SDK reconnect against a real daemon.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { runSchedulerLifecycleServer } from '../dist/extensions/scheduler/daemon/lifecycle-server.js';
import { createSchedulerClient } from '../dist/extensions/scheduler/sdk/client.js';
import { subscribeSchedulerChanges } from '../dist/extensions/scheduler/sdk/changes.js';
import {
  getSchedulerServiceStatus,
  stopSchedulerService,
} from '../dist/extensions/scheduler/sdk/lifecycle.js';

/**
 * Await a condition without allowing a lost event to hang the test process indefinitely.
 */
async function until(predicate) {
  const deadline = Date.now() + 8000;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error('Expected Scheduler condition did not arrive');
    await delay(20);
  }
}

test('read-only subscription never creates a missing profile and closes during discovery backoff', async () => {
  const root = await mkdtemp(join(tmpdir(), 'scheduler-events-absent-'));
  const dir = join(root, 'absent');
  const subscription = subscribeSchedulerChanges(dir, () => assert.fail('No daemon exists'));
  await delay(30);
  await subscription.close();
  await assert.rejects(stat(dir), { code: 'ENOENT' });
  await rm(root, { recursive: true, force: true });
});

test(
  'real daemon emits committed changes, fences credentials and reconnects after restart',
  { timeout: 30_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'scheduler-events-'));
    const dir = join(root, 'agent');
    let daemon = runSchedulerLifecycleServer(dir, true, 0);
    let count = 0;
    let readyCount = 0;
    const subscription = subscribeSchedulerChanges(dir, (event) => {
      count++;
      if (event.type === 'ready') readyCount++;
    });
    const client = createSchedulerClient({
      agentDir: dir,
      workspaceId: 'w',
      cwd: root,
      configRevision: '1',
      autoEnsure: false,
    });
    try {
      await until(async () => (await getSchedulerServiceStatus(dir)).state === 'control-ready');
      await until(() => readyCount > 0);
      const baseline = count;
      await delay(5400);
      assert.equal(count, baseline, 'idle worker scans must not become periodic UI refreshes');
      const endpoint = await getSchedulerServiceStatus(dir);
      const token = await readFile(join(root, 'scheduler', 'credentials', 'task-token'), 'utf8');
      const denied = await fetch(`http://127.0.0.1:${endpoint.port}/scheduler/v1/service/events`, {
        headers: {
          authorization: 'Bearer ' + token,
          'x-scheduler-daemon': endpoint.daemonId,
          'x-scheduler-profile': endpoint.profileId,
        },
      });
      assert.equal(denied.status, 403);
      const created = await client.create(
        {
          name: 'Push task',
          description: '',
          prompt: 'Test',
          schedule: { type: 'once', at: '2099-01-01T00:00:00.000Z' },
          enabled: false,
          misfirePolicy: 'coalesce',
          overlapPolicy: 'queue-one',
          timeoutMs: 60_000,
        },
        'create'
      );
      await until(() => count > baseline);
      assert.equal((await client.get(created.task.id)).name, 'Push task');
      const beforeStop = count;
      await stopSchedulerService(dir);
      await daemon;
      await until(() => count > beforeStop);
      const control = JSON.parse(await readFile(join(root, 'scheduler', 'control.json'), 'utf8'));
      const beforeRestart = readyCount;
      daemon = runSchedulerLifecycleServer(dir, true, control.revision);
      await until(() => readyCount > beforeRestart);
      assert.equal((await client.list()).items.length, 1);
    } finally {
      await subscription.close();
      client.close();
      await stopSchedulerService(dir);
      await daemon;
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
);
