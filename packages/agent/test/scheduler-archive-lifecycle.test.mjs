/**
 * @author Codex
 * @description Exercises archive recovery, purge containment, grant revocation and replay in an isolated database.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { eq } from 'drizzle-orm';
import { openSchedulerDatabase } from '../dist/extensions/scheduler/infrastructure/database.js';
import { SqliteSchedulerTaskRepository } from '../dist/extensions/scheduler/infrastructure/task-repository.js';
import { SchedulerTaskService } from '../dist/extensions/scheduler/services/task-service.js';
import {
  tasks,
  runs,
  resultDeliveries,
  mutations,
} from '../dist/extensions/scheduler/infrastructure/schema.js';

/**
 * Own all test data and artifact paths inside a disposable scheduler profile.
 */
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'scheduler-archive-'));
  const database = openSchedulerDatabase(join(directory, 'scheduler.db'));
  t.after(async () => {
    database.sqlite.close();
    await rm(directory, { recursive: true, force: true });
  });
  const revoked = [];
  const repository = new SqliteSchedulerTaskRepository(database);
  const now = '2026-09-06T00:00:00.000Z';
  const service = new SchedulerTaskService(
    repository,
    () => now,
    (task) => revoked.push(task.authorizationRef)
  );
  const scope = { workspaceId: 'w', cwd: directory, configRevision: '1', originSessionRef: 'origin' };
  const create = {
    operation: 'create',
    key: 'create',
    input: {
      name: 'Private title',
      prompt: 'Private prompt',
      schedule: { type: 'interval', everyMs: 60000, anchorAt: now },
    },
  };
  const task = service.mutate(scope, create).task;
  database.db
    .update(tasks)
    .set({
      authorizationRef: { grantId: 'grant', grantRevision: 1, executionDigest: 'a'.repeat(64) },
      authorizationBlock: null,
    })
    .where(eq(tasks.id, task.id))
    .run();
  const archived = service.mutate(scope, {
    operation: 'delete',
    key: 'archive',
    taskId: task.id,
    revision: task.revision,
    input: {},
  }).task;
  return { directory, database, repository, service, scope, task: archived, revoked, create, now };
}

test('restore retains identity/history, revokes the old grant and stays paused without authority', async (t) => {
  const { service, scope, task, revoked } = await fixture(t);
  const request = {
    operation: 'restore',
    key: 'restore',
    taskId: task.id,
    revision: task.revision,
    input: {},
  };
  assert.throws(() => service.mutate({ ...scope, workspaceId: 'other' }, request), {
    code: 'SCHEDULE_TASK_NOT_FOUND',
  });
  assert.throws(() => service.mutate({ ...scope, originSessionRef: 'other' }, request), {
    code: 'SCHEDULE_TASK_NOT_FOUND',
  });
  assert.throws(() => service.mutate(scope, { ...request, revision: 99 }), {
    code: 'SCHEDULE_TASK_CONFLICT',
  });
  const restored = service.mutate(scope, request);
  assert.equal(restored.effect, 'restored');
  assert.equal(restored.task.id, task.id);
  assert.equal(restored.task.deletedAt, null);
  assert.equal(restored.task.enabled, false);
  assert.ok(restored.task.pausedAt);
  assert.equal(restored.task.nextRunAt, null);
  assert.equal(restored.task.authorizationRef, null);
  assert.equal(restored.task.authorizationBlock, 'SCHEDULE_AUTHORIZATION_REQUIRED');
  assert.equal(revoked.length, 1);
  assert.deepEqual(service.mutate(scope, request), restored);
  assert.throws(
    () => service.mutate(scope, { operation: 'run-now', key: 'run', taskId: task.id, input: {} }),
    { code: 'SCHEDULE_AUTHORIZATION_REQUIRED' }
  );
});

test('purge rejects active runs, deletes owned data/artifacts and redacts earlier replay receipts', async (t) => {
  const { directory, database, service, scope, task, create, now } = await fixture(t);
  database.db
    .insert(runs)
    .values({
      id: 'run-a',
      taskId: task.id,
      occurrenceKey: 'one',
      status: 'running',
      scheduledFor: now,
      availableAt: now,
      triggerSource: 'manual',
      workspaceId: scope.workspaceId,
      cwd: directory,
      prompt: 'Private run',
      configRevision: '1',
      timeoutMs: 60000,
      createdAt: now,
    })
    .run();
  const request = { operation: 'purge', key: 'purge', taskId: task.id, revision: task.revision, input: {} };
  assert.throws(() => service.mutate(scope, request), { code: 'SCHEDULE_TASK_CONFLICT' });
  database.db.update(runs).set({ status: 'succeeded' }).where(eq(runs.id, 'run-a')).run();
  database.db
    .insert(resultDeliveries)
    .values({
      id: 'delivery',
      runId: 'run-a',
      originSessionRef: 'origin',
      summary: 'Private summary',
      availableAt: now,
      createdAt: now,
    })
    .run();
  await mkdir(join(directory, 'runs', 'run-a'), { recursive: true });
  await writeFile(join(directory, 'runs', 'run-a', 'session.jsonl'), 'Private transcript');
  const response = service.mutate(scope, request);
  assert.equal(response.effect, 'purged');
  for (const table of [tasks, runs, resultDeliveries])
    assert.equal(database.db.select().from(table).all().length, 0);
  await assert.rejects(readFile(join(directory, 'runs', 'run-a', 'session.jsonl')), { code: 'ENOENT' });
  assert.ok(
    database.db
      .select()
      .from(mutations)
      .all()
      .every((receipt) => !receipt.responseJson.includes('Private'))
  );
  assert.deepEqual(service.mutate(scope, request), response);
  assert.equal(service.mutate(scope, create).effect, 'purged');
  assert.equal(service.history(scope, '', {}).items.length, 0);
});

test('artifact containment failure retains the archive and never follows a redirected run directory', async (t) => {
  const { directory, database, service, scope, task, now } = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'scheduler-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'keep'), 'keep');
  await mkdir(join(directory, 'runs'));
  await symlink(outside, join(directory, 'runs', 'run-a'), process.platform === 'win32' ? 'junction' : 'dir');
  database.db
    .insert(runs)
    .values({
      id: 'run-a',
      taskId: task.id,
      occurrenceKey: 'one',
      status: 'succeeded',
      scheduledFor: now,
      availableAt: now,
      triggerSource: 'manual',
      workspaceId: scope.workspaceId,
      cwd: directory,
      prompt: '',
      configRevision: '1',
      timeoutMs: 60000,
      createdAt: now,
    })
    .run();
  assert.throws(
    () =>
      service.mutate(scope, {
        operation: 'purge',
        key: 'purge',
        taskId: task.id,
        revision: task.revision,
        input: {},
      }),
    { code: 'SCHEDULE_STORAGE_UNAVAILABLE' }
  );
  assert.equal(await readFile(join(outside, 'keep'), 'utf8'), 'keep');
  assert.equal(service.list(scope, { status: 'archived' }).items.length, 1);
});
