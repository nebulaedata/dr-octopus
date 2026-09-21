/**
 * @author Codex
 * @description In-process daemon transport tests for task SDK, credential separation and explicit stop intent.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { runSchedulerLifecycleServer } from '../dist/extensions/scheduler/daemon/lifecycle-server.js';
import { createSchedulerClient } from '../dist/extensions/scheduler/sdk/client.js';
import {
  getSchedulerServiceStatus,
  stopSchedulerService,
} from '../dist/extensions/scheduler/sdk/lifecycle.js';

/**
 * Wait for the current-process listener to publish an authenticated endpoint.
 */
async function waitUntilReady(agentDir) {
  const deadline = Date.now() + 5000;
  do {
    const status = await getSchedulerServiceStatus(agentDir);
    if (status.state === 'control-ready') return status;
    await delay(20);
  } while (Date.now() < deadline);
  throw new Error('Scheduler test listener did not become ready');
}

test('Agent SDK performs scoped CRUD while lifecycle and task credentials remain separate', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-scheduler-client-'));
  const directory = join(root, 'agent');
  let stopped = false;
  const server = runSchedulerLifecycleServer(directory, true, 0);
  t.after(async () => {
    if (!stopped) await stopSchedulerService(directory).catch(() => undefined);
    await server.catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });
  const status = await waitUntilReady(directory);
  assert.equal(status.taskControlReady, true);
  assert.equal(status.executionReady, true);

  const profileDirectory = join(root, 'scheduler');
  const taskToken = await readFile(join(profileDirectory, 'credentials', 'task-token'), 'utf8');
  const controlToken = await readFile(join(profileDirectory, 'credentials', 'control-token'), 'utf8');
  assert.notEqual(taskToken, controlToken);
  const lifecycleWithTaskCredential = await fetch(
    `http://127.0.0.1:${status.port}/scheduler/v1/service/status`,
    {
      headers: {
        authorization: 'Bearer ' + taskToken,
        'x-scheduler-daemon': status.daemonId,
        'x-scheduler-profile': status.profileId,
      },
    }
  );
  assert.equal(lifecycleWithTaskCredential.status, 403);
  const approvalWithTaskCredential = await fetch(
    `http://127.0.0.1:${status.port}/scheduler/v1/tasks/request`,
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + taskToken,
        'content-type': 'application/json',
        'x-scheduler-daemon': status.daemonId,
        'x-scheduler-profile': status.profileId,
      },
      body: JSON.stringify({
        context: { workspaceId: 'workspace-a' },
        request: {
          operation: 'authorize',
          taskId: 'invented',
          revision: 1,
          key: 'model-attempt',
          input: { confirmed: true },
        },
      }),
    }
  );
  assert.equal(approvalWithTaskCredential.status, 403);

  const client = createSchedulerClient({
    agentDir: directory,
    workspaceId: 'workspace-a',
    cwd: join(directory, 'workspace-a'),
    configRevision: 'config-a',
    autoEnsure: false,
  });
  t.after(() => client.close());
  const caller = { originSessionRef: 'origin-a' };
  const created = await client.create(
    {
      name: 'Transport task',
      description: '',
      prompt: 'Inspect the workspace.',
      schedule: { type: 'once', at: '2026-09-06T00:00:00.000Z' },
      enabled: true,
      misfirePolicy: 'coalesce',
      overlapPolicy: 'queue-one',
      timeoutMs: 60_000,
    },
    'create-transport',
    caller
  );
  const replayed = await client.create(
    {
      name: 'Transport task',
      description: '',
      prompt: 'Inspect the workspace.',
      schedule: { type: 'once', at: '2026-09-06T00:00:00.000Z' },
      enabled: true,
      misfirePolicy: 'coalesce',
      overlapPolicy: 'queue-one',
      timeoutMs: 60_000,
    },
    'create-transport',
    caller
  );
  assert.deepEqual(replayed, created);
  assert.equal((await client.list(caller)).items.length, 1);
  assert.equal((await client.list({ originSessionRef: 'origin-b' })).items.length, 0);
  await assert.rejects(client.runNow(created.task.id, 'run-transport', caller), {
    code: 'SCHEDULE_AUTHORIZATION_REQUIRED',
  });
  assert.equal((await client.history(created.task.id, caller)).items.length, 0);
  assert.equal((await client.forOrigin(caller.originSessionRef).listPending()).items.length, 0);

  await stopSchedulerService(directory);
  stopped = true;
  await server;
  assert.equal((await client.status()).state, 'stopped');
  await assert.rejects(client.list(caller), { code: 'SCHEDULER_UNAVAILABLE' });
});
