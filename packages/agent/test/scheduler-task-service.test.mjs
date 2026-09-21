/**
 * @author Codex
 * @description Scheduler task control-plane tests for scope, replay, immutable runs and delivery effects.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import { openSchedulerDatabase } from '../dist/extensions/scheduler/infrastructure/database.js';
import { resultDeliveries, runs, tasks } from '../dist/extensions/scheduler/infrastructure/schema.js';
import { SqliteSchedulerTaskRepository } from '../dist/extensions/scheduler/infrastructure/task-repository.js';
import { SchedulerTaskService } from '../dist/extensions/scheduler/services/task-service.js';

const now = '2026-09-05T00:00:00.000Z';

test('completed filtering excludes unfinished runs after a once plan is consumed', async (t) => {
  const { database, service, context } = await fixture(t);
  const { task } = service.mutate(context, { operation: 'create', key: 'states', input: input() });
  database.db
    .update(tasks)
    .set({
      enabled: false,
      authorizationBlock: null,
      nextRunAt: null,
      authorizationRef: { grantId: 'test', grantRevision: 1, executionDigest: 'a'.repeat(64) },
    })
    .where(eq(tasks.id, task.id))
    .run();
  assert.equal(service.list(context, { status: 'completed' }).items.length, 1);
  database.db
    .insert(runs)
    .values({
      id: 'active',
      taskId: task.id,
      occurrenceKey: 'once',
      workspaceId: context.workspaceId,
      cwd: context.cwd,
      prompt: 'test',
      configRevision: context.configRevision,
      timeoutMs: 1000,
      status: 'running',
      triggerSource: 'schedule',
      scheduledFor: now,
      availableAt: now,
      createdAt: now,
    })
    .run();
  assert.equal(service.list(context, { status: 'completed' }).items.length, 0);
  assert.equal(service.list(context, { status: 'pending' }).items[0].hasActiveRun, true);
  database.db.update(runs).set({ status: 'succeeded', settledAt: now }).where(eq(runs.id, 'active')).run();
  assert.equal(service.list(context, { status: 'completed' }).items[0].hasActiveRun, false);
});

test('archived catalogs and run searches retain history with scope fences and stable pagination', async (t) => {
  const { database, service, context } = await fixture(t);
  const created = service.mutate(context, {
    operation: 'create',
    key: 'history-create',
    input: input({ name: 'Literal % archive' }),
  });
  const other = service.mutate(
    { ...context, workspaceId: 'other' },
    { operation: 'create', key: 'other-create', input: input({ name: 'Other task' }) }
  );
  for (const [task, count] of [
    [created.task, 23],
    [other.task, 1],
  ]) {
    for (let index = 0; index < count; index++) {
      database.db
        .insert(runs)
        .values({
          id: `${task.id}-${String(index).padStart(2, '0')}`,
          taskId: task.id,
          occurrenceKey: `test:${index}`,
          workspaceId: task.workspaceId,
          cwd: context.cwd,
          originSessionRef: context.originSessionRef,
          prompt: 'Test',
          configRevision: context.configRevision,
          timeoutMs: 1000,
          status: index === 0 ? 'failed' : 'succeeded',
          triggerSource: 'schedule',
          scheduledFor: now,
          availableAt: now,
          createdAt: now,
          settledAt: now,
        })
        .run();
    }
  }
  service.mutate(context, {
    operation: 'delete',
    key: 'archive',
    taskId: created.task.id,
    revision: 1,
    input: {},
  });
  assert.equal(service.list(context).items.length, 0);
  assert.equal(service.list(context, { status: 'archived', q: '%' }).items.length, 1);
  assert.equal(service.list({ ...context, workspaceId: 'missing' }, { status: 'archived' }).items.length, 0);
  const first = service.history(context, '', { limit: 20 });
  const next = service.history(context, '', { limit: 20, offset: 20 });
  assert.equal(first.items.length, 20);
  assert.equal(next.items.length, 3);
  assert.equal(new Set([...first.items, ...next.items].map((run) => run.id)).size, 23);
  assert.equal(first.items[0].taskName, 'Literal % archive');
  assert.equal(first.items[0].archived, true);
  assert.equal(service.history(context, '', { status: 'failed', q: '%' }).items.length, 1);
  assert.equal(
    service.history(context, '', { from: '2026-09-05T08:00:00+08:00', to: '2026-09-05T00:00:00Z' }).items
      .length,
    23
  );
  assert.equal(service.history(context, '', { from: '2026-09-06T00:00:00Z' }).items.length, 0);
  assert.equal(service.history({ ...context, originSessionRef: 'another-session' }, '').items.length, 0);
  assert.equal(service.history(context, created.task.id).items.length, 23);
  assert.throws(() => service.history(context, other.task.id), { code: 'SCHEDULE_TASK_NOT_FOUND' });
  assert.throws(() => service.history(context, '', { from: '2026-09-06T00:00:00Z', to: now }), {
    code: 'SCHEDULE_INVALID',
  });
  assert.throws(
    () =>
      service.mutate(context, {
        operation: 'run-now',
        taskId: created.task.id,
        key: 'archived-run',
        input: {},
      }),
    { code: 'SCHEDULE_TASK_NOT_FOUND' }
  );
});

/**
 * Build a valid task request whose defaults are owned by the shared validation contract.
 */
function input(overrides = {}) {
  return {
    name: 'Daily review',
    prompt: 'Review the workspace status.',
    schedule: { type: 'once', at: '2026-09-06T00:00:00+00:00' },
    ...overrides,
  };
}

/**
 * Open an isolated database and close it before removing the fixture directory.
 */
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-scheduler-tasks-'));
  const database = openSchedulerDatabase(join(directory, 'scheduler.db'));
  t.after(async () => {
    database.sqlite.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    database,
    service: new SchedulerTaskService(new SqliteSchedulerTaskRepository(database), () => now),
    context: {
      workspaceId: 'workspace-a',
      originSessionRef: 'origin-session',
      cwd: join(directory, 'workspace'),
      configRevision: 'config-a',
    },
  };
}

test('create replay is stable and task reads remain inside the caller scope', async (t) => {
  const { service, context } = await fixture(t);
  const request = { operation: 'create', key: 'create-1', input: input() };
  const created = service.mutate(context, request);
  const replayed = service.mutate(context, {
    operation: 'create',
    key: 'create-1',
    input: { schedule: input().schedule, prompt: input().prompt, name: input().name },
  });

  assert.deepEqual(replayed, created);
  assert.equal(created.task.executionMode, 'isolated-run');
  assert.equal(created.task.schedule.at, '2026-09-06T00:00:00.000Z');
  assert.equal(service.list({ workspaceId: context.workspaceId }).items.length, 1);
  assert.throws(() => service.get({ workspaceId: 'workspace-b' }, created.task.id), {
    code: 'SCHEDULE_TASK_NOT_FOUND',
  });
  assert.throws(
    () => service.mutate(context, { ...request, input: input({ prompt: 'Different request' }) }),
    { code: 'SCHEDULE_TASK_CONFLICT' }
  );
});

test('manual runs freeze execution inputs and revision conflicts do not alter the task', async (t) => {
  const { database, service, context } = await fixture(t);
  const created = service.mutate(context, {
    operation: 'create',
    key: 'create-1',
    input: input(),
  });
  database.db
    .update(tasks)
    .set({
      authorizationBlock: null,
      authorizationRef: {
        grantId: '00000000-0000-4000-8000-000000000001',
        grantRevision: 1,
        executionDigest: 'a'.repeat(64),
      },
    })
    .where(eq(tasks.id, created.task.id))
    .run();
  const queued = service.mutate(context, {
    operation: 'run-now',
    key: 'run-1',
    taskId: created.task.id,
    input: {},
  });
  service.mutate(context, {
    operation: 'update',
    key: 'update-1',
    taskId: created.task.id,
    revision: created.task.revision,
    input: { prompt: 'Use the new instructions.' },
  });

  const stored = database.db.select().from(runs).where(eq(runs.id, queued.run.id)).get();
  assert.equal(stored.prompt, input().prompt);
  assert.equal(stored.cwd, context.cwd);
  assert.equal(stored.configRevision, context.configRevision);
  assert.throws(
    () =>
      service.mutate(context, {
        operation: 'update',
        key: 'stale-update',
        taskId: created.task.id,
        revision: created.task.revision,
        input: { name: 'Stale edit' },
      }),
    { code: 'SCHEDULE_TASK_CONFLICT' }
  );
  assert.throws(
    () =>
      service.mutate(context, {
        operation: 'run-now',
        key: 'run-2',
        taskId: created.task.id,
        input: {},
      }),
    { code: 'SCHEDULE_AUTHORIZATION_REQUIRED' }
  );
});

test('queued cancellation and its completion delivery commit once under replay', async (t) => {
  const { database, service, context } = await fixture(t);
  const created = service.mutate(context, {
    operation: 'create',
    key: 'create-1',
    input: input(),
  });
  database.db
    .update(tasks)
    .set({
      authorizationBlock: null,
      authorizationRef: {
        grantId: '00000000-0000-4000-8000-000000000001',
        grantRevision: 1,
        executionDigest: 'a'.repeat(64),
      },
    })
    .where(eq(tasks.id, created.task.id))
    .run();
  const queued = service.mutate(context, {
    operation: 'run-now',
    key: 'run-1',
    taskId: created.task.id,
    input: {},
  });
  const request = {
    operation: 'cancel',
    key: 'cancel-1',
    taskId: created.task.id,
    input: { runId: queued.run.id },
  };
  const cancelled = service.mutate(context, request);
  const replayed = service.mutate(context, request);

  assert.deepEqual(replayed, cancelled);
  assert.equal(cancelled.effect, 'cancelled');
  assert.equal(cancelled.run.status, 'cancelled');
  const deliveryRows = database.db.select().from(resultDeliveries).all();
  assert.equal(deliveryRows.length, 1);
  assert.equal(deliveryRows[0].runId, queued.run.id);
  assert.equal(deliveryRows[0].originSessionRef, context.originSessionRef);
});

test('pause skips queued work without delivery and soft-deleted task history remains scoped', async (t) => {
  const { database, service, context } = await fixture(t);
  const created = service.mutate(context, {
    operation: 'create',
    key: 'create-1',
    input: input(),
  });
  database.db
    .update(tasks)
    .set({
      authorizationBlock: null,
      authorizationRef: {
        grantId: '00000000-0000-4000-8000-000000000001',
        grantRevision: 1,
        executionDigest: 'a'.repeat(64),
      },
    })
    .where(eq(tasks.id, created.task.id))
    .run();
  const queued = service.mutate(context, {
    operation: 'run-now',
    key: 'run-1',
    taskId: created.task.id,
    input: {},
  });
  const paused = service.mutate(context, {
    operation: 'update',
    key: 'pause-1',
    taskId: created.task.id,
    revision: created.task.revision,
    input: { enabled: false },
  });
  service.mutate(context, {
    operation: 'delete',
    key: 'delete-1',
    taskId: created.task.id,
    revision: paused.task.revision,
    input: {},
  });

  assert.equal(service.list(context).items.length, 0);
  assert.throws(() => service.get(context, created.task.id), { code: 'SCHEDULE_TASK_NOT_FOUND' });
  assert.equal(service.history(context, created.task.id).items[0].id, queued.run.id);
  assert.equal(service.history(context, created.task.id).items[0].status, 'skipped');
  assert.equal(database.db.select().from(resultDeliveries).all().length, 0);
  assert.throws(() => service.history({ workspaceId: 'workspace-b' }, created.task.id), {
    code: 'SCHEDULE_TASK_NOT_FOUND',
  });
});
