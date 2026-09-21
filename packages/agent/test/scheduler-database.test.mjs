/**
 * @author Codex
 * @description Independent migration, foreign-key rollback and failed startup resource release tests.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openSchedulerDatabase } from '../dist/extensions/scheduler/infrastructure/database.js';
import { tasks, runs } from '../dist/extensions/scheduler/infrastructure/schema.js';

/**
 * Allocate a deterministic task snapshot for transactional persistence checks.
 */
function task() {
  return {
    id: 'task',
    workspaceId: 'workspace',
    cwd: '/fixture',
    originSessionRef: 'agent-session',
    name: 'fixture',
    prompt: 'fixture',
    schedule: { type: 'once', at: '2026-09-05T00:00:00.000Z' },
    enabled: false,
    revision: 1,
    configRevision: 'fixture',
    misfirePolicy: 'coalesce',
    overlapPolicy: 'queue-one',
    timeoutMs: 1000,
    createdAt: '2026-09-05T00:00:00.000Z',
    updatedAt: '2026-09-05T00:00:00.000Z',
  };
}

test('standalone database migrates without Server tables and preserves rows across reopen', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-scheduler-db-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'scheduler.db');
  let database = openSchedulerDatabase(path);
  try {
    assert.equal(database.sqlite.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(database.sqlite.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(database.sqlite.pragma('synchronous', { simple: true }), 2);
    const tables = database.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name);
    assert.ok(tables.includes('scheduler_result_deliveries'));
    assert.ok(!tables.includes('sessions'));
    database.db.insert(tasks).values(task()).run();
    database.sqlite.close();
    database = openSchedulerDatabase(path);
    assert.equal(database.db.select().from(tasks).get().id, 'task');
  } finally {
    database.sqlite.close();
  }
});

test('foreign-key failure rolls back the complete mutation transaction', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-scheduler-db-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const database = openSchedulerDatabase(join(directory, 'scheduler.db'));
  try {
    assert.throws(
      database.sqlite.transaction(() => {
        database.db.insert(tasks).values(task()).run();
        database.db
          .insert(runs)
          .values({
            id: 'run',
            taskId: 'missing',
            occurrenceKey: 'once',
            status: 'queued',
            scheduledFor: task().createdAt,
            availableAt: task().createdAt,
            triggerSource: 'manual',
            workspaceId: 'workspace',
            cwd: '/fixture',
            prompt: 'fixture',
            configRevision: 'fixture',
            timeoutMs: 1000,
            createdAt: task().createdAt,
          })
          .run();
      })
    );
    assert.equal(database.db.select().from(tasks).all().length, 0);
  } finally {
    database.sqlite.close();
  }
});

test('missing migration resources fail initialization and close the database handle', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-scheduler-db-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'scheduler.db');
  assert.throws(() => openSchedulerDatabase(path, join(directory, 'missing')), {
    code: 'SCHEDULER_STORAGE_UNAVAILABLE',
  });
  const database = openSchedulerDatabase(path);
  database.sqlite.close();
  await rm(path);
});
