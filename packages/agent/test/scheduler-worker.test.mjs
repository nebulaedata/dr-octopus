/**
 * @author Codex
 * @description Worker orchestration tests for dispatch callbacks, cancellation polling and terminal persistence.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import { setTimeout as delay } from 'node:timers/promises';
import { openSchedulerDatabase } from '../dist/extensions/scheduler/infrastructure/database.js';
import { runs, tasks } from '../dist/extensions/scheduler/infrastructure/schema.js';
import { SchedulerWorkRepository } from '../dist/extensions/scheduler/infrastructure/work-repository.js';
import { SchedulerWorker } from '../dist/extensions/scheduler/services/worker.js';
import { SchedulerTaskService } from '../dist/extensions/scheduler/services/task-service.js';
import { SqliteSchedulerTaskRepository } from '../dist/extensions/scheduler/infrastructure/task-repository.js';

const now = '2026-09-05T00:00:00.000Z';

/**
 * Wait until a durable status reaches the expected terminal state.
 */
async function waitForStatus(database, runId, expected) {
  const deadline = Date.now() + 2000;
  do {
    const status = database.db.select().from(runs).where(eq(runs.id, runId)).get()?.status;
    if (status === expected) return;
    await delay(10);
  } while (Date.now() < deadline);
  throw new Error(`Run ${runId} did not reach ${expected}`);
}

/**
 * Insert a runnable snapshot and its parent Task.
 */
function seed(database, runId = 'run-a') {
  database.db
    .insert(tasks)
    .values({
      id: 'task-a',
      workspaceId: 'workspace-a',
      cwd: 'D:\\workspace-a',
      originSessionRef: 'origin-a',
      name: 'task-a',
      description: '',
      prompt: 'Run task-a',
      schedule: { type: 'once', at: '2026-09-06T00:00:00.000Z' },
      enabled: true,
      revision: 1,
      authorizationBlock: null,
      configRevision: 'config-a',
      nextRunAt: null,
      misfirePolicy: 'coalesce',
      overlapPolicy: 'queue-one',
      timeoutMs: 60_000,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  database.db
    .insert(runs)
    .values({
      id: runId,
      taskId: 'task-a',
      occurrenceKey: `manual:${runId}`,
      status: 'queued',
      scheduledFor: now,
      availableAt: now,
      triggerSource: 'manual',
      workspaceId: 'workspace-a',
      cwd: 'D:\\workspace-a',
      originSessionRef: 'origin-a',
      prompt: 'Run task-a',
      configRevision: 'config-a',
      timeoutMs: 60_000,
      createdAt: now,
    })
    .run();
}

test('Worker drives a claimed Run through dispatch evidence and terminal delivery', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-scheduler-worker-'));
  const database = openSchedulerDatabase(join(directory, 'scheduler.db'));
  t.after(async () => {
    database.sqlite.close();
    await rm(directory, { recursive: true, force: true });
  });
  seed(database);
  const transitions = [];
  const worker = new SchedulerWorker(
    new SchedulerWorkRepository(database),
    {
      async run(work, _signal, callbacks) {
        assert.equal(callbacks.dispatch({ sessionId: 'session-a', sessionPath: 'path-a' }), true);
        assert.equal(callbacks.running('prompt-entry-a'), true);
        return { status: 'succeeded', summary: `Completed ${work.runId}.`, errorCode: null };
      },
    },
    'daemon-a',
    () => now,
    () => undefined,
    () => {
      assert.equal(database.sqlite.inTransaction, false);
      transitions.push(database.db.select().from(runs).where(eq(runs.id, 'run-a')).get()?.status);
    }
  );
  t.after(() => worker.close());

  worker.start();
  await waitForStatus(database, 'run-a', 'succeeded');
  const row = database.db.select().from(runs).where(eq(runs.id, 'run-a')).get();
  assert.equal(row.sessionId, 'session-a');
  assert.equal(row.promptEntryId, 'prompt-entry-a');
  assert.equal(row.startedAt, now);
  assert.equal(worker.diagnostics().running, 0);
  assert.ok(transitions.includes('dispatching'));
  assert.ok(transitions.includes('running'));
  assert.ok(transitions.includes('succeeded'));
});

test('Worker observes durable active cancellation intent and aborts the exact Runner', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-scheduler-worker-'));
  const database = openSchedulerDatabase(join(directory, 'scheduler.db'));
  t.after(async () => {
    database.sqlite.close();
    await rm(directory, { recursive: true, force: true });
  });
  seed(database);
  const worker = new SchedulerWorker(
    new SchedulerWorkRepository(database),
    {
      async run(_work, signal, callbacks) {
        callbacks.dispatch({ sessionId: 'session-a', sessionPath: 'path-a' });
        callbacks.running('prompt-entry-a');
        await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
        return {
          status: 'cancelled',
          summary: 'Scheduled run was cancelled.',
          errorCode: 'SCHEDULE_EXECUTION_CANCELLED',
        };
      },
    },
    'daemon-a',
    () => now
  );
  t.after(() => worker.close());

  worker.start();
  await waitForStatus(database, 'run-a', 'running');
  database.db.update(runs).set({ cancelRequestedAt: now }).where(eq(runs.id, 'run-a')).run();
  worker.wake();
  await waitForStatus(database, 'run-a', 'cancelled');
});

test('Worker applies configured global concurrency without interrupting active runs', async () => {
  const queue = [{ runId: 'run-a' }, { runId: 'run-b' }, { runId: 'run-c' }];
  let launches = 0;
  const worker = new SchedulerWorker(
    {
      recoverAbandoned() {},
      materialize() {},
      claim() {
        return queue.shift();
      },
      cancellationRequested() {
        return false;
      },
      dispatch() {
        return true;
      },
      running() {
        return true;
      },
      abandonClaim() {},
      finish() {},
      diagnostics() {
        return { queued: queue.length, running: launches };
      },
    },
    {
      async run(_work, signal) {
        launches += 1;
        await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
        return { status: 'interrupted', summary: 'stopped', errorCode: null };
      },
    },
    'daemon-a',
    () => now
  );

  worker.configure(1);
  worker.start();
  assert.equal(launches, 1);
  worker.configure(2);
  worker.wake();
  assert.equal(launches, 2);
  worker.configure(1);
  worker.wake();
  assert.equal(launches, 2);
  await worker.close();
});

test('configured concurrency above three reaches the real SQLite claim boundary', async () => {
  const database = openSchedulerDatabase(':memory:');
  const service = new SchedulerTaskService(new SqliteSchedulerTaskRepository(database), () => now);
  let launches = 0;
  const worker = new SchedulerWorker(
    new SchedulerWorkRepository(database),
    {
      async run(_work, signal) {
        launches += 1;
        await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
        return { status: 'interrupted', summary: 'stopped', errorCode: null };
      },
    },
    'daemon-configured',
    () => now
  );
  try {
    for (let index = 0; index < 5; index += 1) {
      service.mutate(
        { workspaceId: 'workspace-' + index, cwd: process.cwd(), configRevision: '1' },
        {
          operation: 'create',
          key: 'create-' + index,
          input: { name: 'task-' + index, prompt: 'Check status', schedule: { type: 'once', at: now } },
        }
      );
    }
    database.db.update(tasks).set({ authorizationBlock: null }).run();
    worker.configure(4);
    worker.start();
    assert.equal(launches, 4);
    assert.equal(worker.diagnostics().queued, 1);
    worker.configure(5);
    worker.wake();
    assert.equal(launches, 5);
    assert.equal(worker.diagnostics().queued, 0);
  } finally {
    await worker.close();
    database.sqlite.close();
  }
});
