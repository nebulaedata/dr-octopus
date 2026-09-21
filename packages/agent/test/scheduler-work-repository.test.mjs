/**
 * @author Codex
 * @description Scheduler materialization, claim fencing, terminal delivery and crash recovery tests.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import { openSchedulerDatabase } from '../dist/extensions/scheduler/infrastructure/database.js';
import { resultDeliveries, runs, tasks } from '../dist/extensions/scheduler/infrastructure/schema.js';
import { SchedulerWorkRepository } from '../dist/extensions/scheduler/infrastructure/work-repository.js';

const now = '2026-09-05T00:00:00.000Z';

/**
 * Open an isolated Scheduler store for one test.
 */
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-scheduler-work-'));
  const database = openSchedulerDatabase(join(directory, 'scheduler.db'));
  t.after(async () => {
    database.sqlite.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { database, repository: new SchedulerWorkRepository(database) };
}

/**
 * Create a persisted task row with deterministic execution inputs.
 */
function task(id, overrides = {}) {
  return {
    id,
    workspaceId: 'workspace-a',
    cwd: 'D:\\workspace-a',
    originSessionRef: 'origin-a',
    name: id,
    description: '',
    prompt: `Run ${id}`,
    schedule: { type: 'once', at: '2026-09-04T00:00:00.000Z' },
    enabled: true,
    revision: 1,
    authorizationBlock: null,
    authorizationRef: {
      grantId: '00000000-0000-4000-8000-000000000001',
      grantRevision: 1,
      executionDigest: 'a'.repeat(64),
    },
    configRevision: 'config-a',
    nextRunAt: '2026-09-04T00:00:00.000Z',
    misfirePolicy: 'coalesce',
    overlapPolicy: 'queue-one',
    timeoutMs: 60_000,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create a queued or active immutable run snapshot.
 */
function run(id, taskId, overrides = {}) {
  const source = task(taskId);
  return {
    id,
    taskId,
    occurrenceKey: `manual:${id}`,
    status: 'queued',
    scheduledFor: now,
    availableAt: now,
    triggerSource: 'manual',
    workspaceId: source.workspaceId,
    cwd: source.cwd,
    originSessionRef: source.originSessionRef,
    prompt: source.prompt,
    configRevision: source.configRevision,
    timeoutMs: source.timeoutMs,
    createdAt: now,
    ...overrides,
  };
}

test('materialization advances the plan and freezes one scheduled Run snapshot', async (t) => {
  const { database, repository } = await fixture(t);
  database.db.insert(tasks).values(task('task-a')).run();

  repository.materialize(now);
  repository.materialize(now);

  const taskRow = database.db.select().from(tasks).where(eq(tasks.id, 'task-a')).get();
  const runRows = database.db.select().from(runs).all();
  assert.equal(taskRow.enabled, false);
  assert.equal(taskRow.nextRunAt, null);
  assert.equal(runRows.length, 1);
  assert.equal(runRows[0].status, 'queued');
  assert.equal(runRows[0].prompt, 'Run task-a');
  assert.equal(runRows[0].occurrenceKey, 'scheduled:2026-09-04T00:00:00.000Z');
  const claimed = repository.claim('daemon-a', now);
  assert.ok(claimed);
  assert.equal(claimed.taskId, 'task-a');
  assert.equal(
    repository.dispatch(claimed, 'daemon-a', now, {
      sessionId: 'session-a',
      sessionPath: 'path-a',
    }),
    true
  );
});

test('claims enforce Workspace capacity and terminal commit creates one delivery', async (t) => {
  const { database, repository } = await fixture(t);
  database.db
    .insert(tasks)
    .values([
      task('task-a', { nextRunAt: null }),
      task('task-b', { nextRunAt: null }),
      task('task-c', { nextRunAt: null }),
    ])
    .run();
  database.db
    .insert(runs)
    .values([run('run-a', 'task-a'), run('run-b', 'task-b'), run('run-c', 'task-c')])
    .run();

  const first = repository.claim('daemon-a', now);
  const second = repository.claim('daemon-a', now);
  assert.ok(first);
  assert.ok(second);
  assert.equal(repository.claim('daemon-a', now), undefined);
  assert.equal(
    repository.dispatch(first, 'wrong-daemon', now, { sessionId: 'session-a', sessionPath: 'path-a' }),
    false
  );
  assert.equal(
    repository.dispatch(first, 'daemon-a', now, { sessionId: 'session-a', sessionPath: 'path-a' }),
    true
  );
  assert.equal(repository.running(first, 'daemon-a', 'prompt-entry-a', now), true);
  assert.equal(
    repository.finish(first, 'daemon-a', now, {
      status: 'succeeded',
      summary: 'Completed.',
      errorCode: null,
    }),
    true
  );
  assert.equal(
    repository.finish(first, 'daemon-a', now, {
      status: 'succeeded',
      summary: 'Duplicate.',
      errorCode: null,
    }),
    false
  );
  assert.equal(database.db.select().from(resultDeliveries).all().length, 1);
  assert.equal(repository.diagnostics().running, 1);
});

test('recovery requeues only pre-dispatch work and interrupts ambiguous execution', async (t) => {
  const { database, repository } = await fixture(t);
  database.db
    .insert(tasks)
    .values([task('task-a', { nextRunAt: null }), task('task-b', { nextRunAt: null })])
    .run();
  database.db
    .insert(runs)
    .values([
      run('run-a', 'task-a', {
        status: 'claimed',
        daemonId: 'old-daemon',
        attemptId: 'attempt-a',
      }),
      run('run-b', 'task-b', {
        status: 'dispatching',
        daemonId: 'old-daemon',
        attemptId: 'attempt-b',
        dispatchAt: now,
        sessionId: 'session-b',
        sessionPath: 'path-b',
      }),
    ])
    .run();

  repository.recoverAbandoned('new-daemon', now);

  const preDispatch = database.db.select().from(runs).where(eq(runs.id, 'run-a')).get();
  const dispatched = database.db.select().from(runs).where(eq(runs.id, 'run-b')).get();
  assert.equal(preDispatch.status, 'queued');
  assert.equal(preDispatch.daemonId, null);
  assert.equal(dispatched.status, 'interrupted');
  assert.equal(dispatched.errorCode, 'SCHEDULE_EXECUTION_INTERRUPTED');
  assert.deepEqual(
    database.db
      .select()
      .from(resultDeliveries)
      .all()
      .map((item) => item.runId),
    ['run-b']
  );
});
