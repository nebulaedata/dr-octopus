/**
 * @author Codex
 * @description Verifies settled result export scope, artifact containment and control-token authorization.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { openSchedulerDatabase } from '../dist/extensions/scheduler/infrastructure/database.js';
import { tasks, runs } from '../dist/extensions/scheduler/infrastructure/schema.js';
import { SchedulerTranscriptReader } from '../dist/extensions/scheduler/infrastructure/transcript-reader.js';
import { handleSchedulerTaskRequest } from '../dist/extensions/scheduler/daemon/task-routes.js';

test('settled result export is workspace fenced and rejects escaped artifacts and active runs', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'scheduler-result-'));
  const database = openSchedulerDatabase(join(root, 'scheduler.db'));
  t.after(async () => {
    database.sqlite.close();
    await rm(root, { recursive: true, force: true });
  });
  const now = '2026-09-06T00:00:00.000Z';
  database.db
    .insert(tasks)
    .values({
      id: 'task',
      workspaceId: 'w',
      cwd: root,
      originSessionRef: 'origin',
      name: 'Fixture',
      prompt: 'Read fixture',
      schedule: { type: 'once', at: now },
      enabled: false,
      revision: 1,
      configRevision: '1',
      misfirePolicy: 'skip',
      overlapPolicy: 'skip',
      timeoutMs: 1000,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  database.db
    .insert(runs)
    .values({
      id: 'run',
      taskId: 'task',
      occurrenceKey: 'once',
      status: 'needs_attention',
      scheduledFor: now,
      availableAt: now,
      triggerSource: 'schedule',
      workspaceId: 'w',
      cwd: root,
      originSessionRef: 'origin',
      prompt: 'Read fixture',
      configRevision: '1',
      timeoutMs: 1000,
      settledAt: now,
      createdAt: now,
    })
    .run();
  const reader = new SchedulerTranscriptReader(database, root);
  assert.equal((await reader.result({ workspaceId: 'w' }, 'task', 'run')).session, null);
  await assert.rejects(reader.result({ workspaceId: 'other' }, 'task', 'run'), {
    code: 'SCHEDULE_RUN_NOT_FOUND',
  });
  await assert.rejects(reader.result({ workspaceId: 'w', originSessionRef: 'other' }, 'task', 'run'), {
    code: 'SCHEDULE_RUN_NOT_FOUND',
  });
  await mkdir(join(root, 'runs', 'run'), { recursive: true });
  const path = join(root, 'runs', 'run', 'session.jsonl');
  await writeFile(path, '{}\n');
  database.db.update(runs).set({ sessionId: 'pi', sessionPath: path }).where(eq(runs.id, 'run')).run();
  assert.equal((await reader.result({ workspaceId: 'w' }, 'task', 'run')).session.id, 'pi');
  const outside = join(root, 'outside.jsonl');
  await writeFile(outside, '{}\n');
  database.db.update(runs).set({ sessionPath: outside }).where(eq(runs.id, 'run')).run();
  await assert.rejects(reader.result({ workspaceId: 'w' }, 'task', 'run'), {
    code: 'SCHEDULE_ARTIFACT_UNAVAILABLE',
  });
  database.db.update(runs).set({ sessionPath: path }).where(eq(runs.id, 'run')).run();
  await rm(path);
  assert.equal(
    (await reader.result({ workspaceId: 'w' }, 'task', 'run')).artifactError,
    'SCHEDULE_ARTIFACT_MISSING'
  );
  database.db.update(runs).set({ status: 'running', settledAt: null }).where(eq(runs.id, 'run')).run();
  await assert.rejects(reader.result({ workspaceId: 'w' }, 'task', 'run'), {
    code: 'SCHEDULE_RESULT_PENDING',
  });
});

test('model task token cannot export private Session paths', async (t) => {
  let calls = 0;
  const server = createServer((request, response) => {
    void handleSchedulerTaskRequest(
      request,
      response,
      { daemonId: 'd', profileId: 'p' },
      'task',
      {},
      {},
      undefined,
      'control',
      {
        result: async () => {
          calls++;
          return { session: { path: '/private' } };
        },
      }
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  for (const token of ['task', 'control']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/scheduler/v1/tasks/request`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-scheduler-daemon': 'd', 'x-scheduler-profile': 'p' },
      body: JSON.stringify({
        context: { workspaceId: 'w' },
        request: { operation: 'run-result', taskId: 'task', input: { runId: 'run' } },
      }),
    });
    assert.equal(response.status, token === 'task' ? 403 : 200);
    await response.text();
  }
  assert.equal(calls, 1);
});
