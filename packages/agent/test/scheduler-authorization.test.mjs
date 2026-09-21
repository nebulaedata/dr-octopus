/**
 * @author Codex
 * @description Exercises durable approval, revocation, admission and crash replay with real isolated stores.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  openGrantRepository,
  requirePermissionGrant,
} from '../dist/extensions/permission-system/sdk/index.js';
import { openSchedulerDatabase } from '../dist/extensions/scheduler/infrastructure/database.js';
import { SqliteSchedulerTaskRepository } from '../dist/extensions/scheduler/infrastructure/task-repository.js';
import { SchedulerTaskService } from '../dist/extensions/scheduler/services/task-service.js';
import { SchedulerWorkRepository } from '../dist/extensions/scheduler/infrastructure/work-repository.js';
import { SchedulerAuthorizationCoordinator } from '../dist/extensions/scheduler/sdk/authorization-coordinator.js';
import { executionDigest } from '../dist/extensions/scheduler/services/execution-digest.js';
import { SchedulerTranscriptReader } from '../dist/extensions/scheduler/infrastructure/transcript-reader.js';
import { runs } from '../dist/extensions/scheduler/infrastructure/schema.js';

const tool = { name: 'web_search', identity: 'a'.repeat(64), description: 'Search public web pages.' };
/**
 * Create a fixture whose teardown never touches the user's active Agent profile.
 */
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'scheduler-grants-'));
  const agentDir = join(root, 'agent');
  await mkdir(agentDir);
  const database = openSchedulerDatabase(join(root, 'scheduler.db'));
  const grants = openGrantRepository(agentDir);
  const repository = new SqliteSchedulerTaskRepository(database);
  const service = new SchedulerTaskService(repository);
  const coordinator = new SchedulerAuthorizationCoordinator(repository, grants, 'profile', async () => [
    tool,
  ]);
  const context = { workspaceId: 'workspace', cwd: root, configRevision: 'v1' };
  const created = service.mutate(context, {
    operation: 'create',
    key: 'new',
    input: {
      name: 'News',
      prompt: 'Search today.',
      schedule: { type: 'interval', everyMs: 60_000, anchorAt: '2026-01-01T00:00:00Z' },
    },
  });
  t.after(async () => {
    grants.close();
    database.sqlite.close();
    await rm(root, { recursive: true, force: true });
  });
  const id = created.task.id;
  const digest = executionDigest(repository.get(context, id));
  const input = { confirmed: true, tools: [tool], executionDigest: digest };
  const binding = { profileId: 'profile', workspaceId: 'workspace', subjectId: id, executionDigest: digest };
  await coordinator.preview(context, id);
  return { root, agentDir, grants, repository, service, coordinator, context, id, input, binding, database };
}

test('preview restores persisted selection and observes revocation without caching grants', async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await f.coordinator.preview(f.context, f.id)).authorizedToolIdentities, []);
  await f.coordinator.approve(f.context, f.id, 1, 'approve', f.input);
  assert.deepEqual((await f.coordinator.preview(f.context, f.id)).authorizedToolIdentities, [tool.identity]);
  const ref = f.repository.get(f.context, f.id).authorizationRef;
  f.grants.revoke(ref.grantId, ref.grantRevision);
  assert.deepEqual((await f.coordinator.preview(f.context, f.id)).authorizedToolIdentities, []);
});

test('preview does not restore stale or cross-profile authority', async (t) => {
  const f = await fixture(t);
  await f.coordinator.approve(f.context, f.id, 1, 'approve', f.input);
  const otherProfile = new SchedulerAuthorizationCoordinator(
    f.repository,
    f.grants,
    'other-profile',
    async () => [tool]
  );
  assert.deepEqual((await otherProfile.preview(f.context, f.id)).authorizedToolIdentities, []);
  f.service.mutate(f.context, {
    operation: 'update',
    taskId: f.id,
    revision: 2,
    key: 'edit',
    input: { prompt: 'Changed prompt.' },
  });
  assert.deepEqual((await f.coordinator.preview(f.context, f.id)).authorizedToolIdentities, []);
});

test('confirming the restored selection preserves authority and explicit clearing removes tools', async (t) => {
  const f = await fixture(t);
  await f.coordinator.approve(f.context, f.id, 1, 'approve', f.input);
  const preview = await f.coordinator.preview(f.context, f.id);
  await f.coordinator.approve(f.context, f.id, 2, 'reapprove', {
    confirmed: true,
    executionDigest: preview.executionDigest,
    tools: preview.tools.filter((entry) => preview.authorizedToolIdentities.includes(entry.identity)),
  });
  assert.deepEqual((await f.coordinator.preview(f.context, f.id)).authorizedToolIdentities, [tool.identity]);
  await f.coordinator.approve(f.context, f.id, 3, 'clear', { ...f.input, tools: [] });
  assert.deepEqual((await f.coordinator.preview(f.context, f.id)).authorizedToolIdentities, []);
});

test('creation remains blocked until explicit approval, then future runs freeze the grant', async (t) => {
  const f = await fixture(t);
  assert.throws(
    () => f.service.mutate(f.context, { operation: 'run-now', taskId: f.id, key: 'run', input: {} }),
    { code: 'SCHEDULE_AUTHORIZATION_REQUIRED' }
  );
  await f.coordinator.approve(f.context, f.id, 1, 'approve', f.input);
  const task = f.repository.get(f.context, f.id);
  assert.equal(task.authorizationBlock, null);
  requirePermissionGrant(f.grants, f.binding, task.authorizationRef);
  f.service.mutate(f.context, { operation: 'run-now', taskId: f.id, key: 'run', input: {} });
  const work = new SchedulerWorkRepository(f.database).claim('daemon', new Date().toISOString());
  assert.deepEqual(work.authorizationRef, task.authorizationRef);
});

test('explicit approval is idempotent and changed content under the same key conflicts', async (t) => {
  const f = await fixture(t);
  await f.coordinator.approve(f.context, f.id, 1, 'approve', f.input);
  await f.coordinator.approve(f.context, f.id, 1, 'approve', f.input);
  assert.equal(f.repository.get(f.context, f.id).revision, 2);
  await assert.rejects(f.coordinator.approve(f.context, f.id, 1, 'approve', { ...f.input, tools: [] }), {
    code: 'SCHEDULE_TASK_CONFLICT',
  });
  await assert.rejects(f.coordinator.approve(f.context, f.id, 2, 'fake', { ...f.input, confirmed: false }), {
    code: 'SCHEDULE_INVALID',
  });
});

test('new read-only runner observes durable grants and committed revocation immediately', async (t) => {
  const f = await fixture(t);
  await f.coordinator.approve(f.context, f.id, 1, 'approve', f.input);
  const ref = f.repository.get(f.context, f.id).authorizationRef;
  const runner = openGrantRepository(f.agentDir, true);
  try {
    requirePermissionGrant(runner, f.binding, ref);
    f.coordinator.revoke(f.context, f.id, 2);
    assert.throws(() => requirePermissionGrant(runner, f.binding, ref), {
      code: 'SCHEDULE_AUTHORIZATION_REVOKED',
    });
    f.coordinator.revoke(f.context, f.id, 2);
    assert.equal(f.repository.get(f.context, f.id).revision, 3);
  } finally {
    runner.close();
  }
});

test('prompt changes invalidate grants and reconciliation cancels old queued work', async (t) => {
  const f = await fixture(t);
  await f.coordinator.approve(f.context, f.id, 1, 'approve', f.input);
  f.service.mutate(f.context, { operation: 'run-now', taskId: f.id, key: 'run', input: {} });
  f.service.mutate(f.context, {
    operation: 'update',
    taskId: f.id,
    revision: 2,
    key: 'edit',
    input: { prompt: 'Write a file instead.' },
  });
  f.coordinator.reconcile();
  const task = f.repository.get(f.context, f.id);
  assert.ok(task.authorizationBlock);
  assert.equal(f.grants.get(task.authorizationRef.grantId).state, 'revoked');
  assert.equal(new SchedulerWorkRepository(f.database).claim('daemon', new Date().toISOString()), undefined);
});

test('cross-subject references and changed tool identities cannot acquire authority', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.coordinator.approve(f.context, f.id, 1, 'approve', {
      ...f.input,
      tools: [{ ...tool, identity: 'b'.repeat(64) }],
    }),
    { code: 'SCHEDULE_TASK_CONFLICT' }
  );
  await f.coordinator.approve(f.context, f.id, 1, 'valid', f.input);
  const ref = f.repository.get(f.context, f.id).authorizationRef;
  assert.throws(() => requirePermissionGrant(f.grants, { ...f.binding, subjectId: 'another-task' }, ref), {
    code: 'SCHEDULE_AUTHORIZATION_STALE',
  });
});

test('grant committed before task binding can be replayed without signing a second grant', async (t) => {
  const f = await fixture(t);
  const saved = f.grants.approve(f.binding, [tool], JSON.stringify(['profile', f.id, 'approve']));
  assert.equal(f.repository.get(f.context, f.id).authorizationRef, null);
  await f.coordinator.approve(f.context, f.id, 1, 'approve', f.input);
  assert.equal(f.repository.get(f.context, f.id).authorizationRef.grantId, saved.id);
});

test('replacing approval revokes the previous grant and cancels its queued snapshot', async (t) => {
  const f = await fixture(t);
  await f.coordinator.approve(f.context, f.id, 1, 'approve', f.input);
  const old = f.repository.get(f.context, f.id).authorizationRef;
  f.service.mutate(f.context, { operation: 'run-now', taskId: f.id, key: 'run', input: {} });
  await f.coordinator.preview(f.context, f.id);
  await f.coordinator.approve(f.context, f.id, 2, 'narrow', { ...f.input, tools: [] });
  assert.equal(f.grants.get(old.grantId).state, 'revoked');
  assert.equal(new SchedulerWorkRepository(f.database).claim('daemon', new Date().toISOString()), undefined);
  assert.equal(f.service.history(f.context, f.id).items[0].status, 'skipped');
});

test('transcript reads retain workspace fencing without allocating a Runtime', async (t) => {
  const f = await fixture(t);
  const directory = join(f.root, 'runs', 'run');
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'session.jsonl');
  await writeFile(
    path,
    JSON.stringify({
      type: 'message',
      message: {
        role: 'toolResult',
        content: [{ type: 'text', text: 'Permission denied before execution.' }],
      },
    }) + '\n'
  );
  f.database.db
    .insert(runs)
    .values({
      id: 'run',
      taskId: f.id,
      occurrenceKey: 'manual:test',
      status: 'needs_attention',
      scheduledFor: new Date().toISOString(),
      availableAt: new Date().toISOString(),
      triggerSource: 'manual',
      workspaceId: f.context.workspaceId,
      cwd: f.root,
      prompt: 'test',
      configRevision: 'v1',
      timeoutMs: 1000,
      sessionPath: path,
      createdAt: new Date().toISOString(),
    })
    .run();
  const reader = new SchedulerTranscriptReader(f.database, f.root);
  assert.equal(
    (await reader.read(f.context, f.id, 'run')).entries[0].text,
    'Permission denied before execution.'
  );
  await assert.rejects(reader.read({ workspaceId: 'another' }, f.id, 'run'), {
    code: 'SCHEDULE_RUN_NOT_FOUND',
  });
});

test('late denial from an old run cannot block a newly approved grant', async (t) => {
  const f = await fixture(t);
  await f.coordinator.approve(f.context, f.id, 1, 'approve', f.input);
  f.service.mutate(f.context, { operation: 'run-now', taskId: f.id, key: 'run', input: {} });
  const repository = new SchedulerWorkRepository(f.database);
  const now = new Date().toISOString();
  const claimed = repository.claim('daemon', now);
  await f.coordinator.preview(f.context, f.id);
  await f.coordinator.approve(f.context, f.id, 2, 'narrow', { ...f.input, tools: [] });
  assert.equal(
    repository.finish(claimed, 'daemon', now, {
      status: 'needs_attention',
      errorCode: 'SCHEDULE_PERMISSION_DENIED',
      summary: 'Old grant denied.',
    }),
    true
  );
  assert.equal(f.repository.get(f.context, f.id).authorizationBlock, null);
  assert.equal(f.repository.get(f.context, f.id).revision, 3);
});

test('concurrent previews share one probe and confirmations reuse the completed catalog', async (t) => {
  const f = await fixture(t);
  const gate = Promise.withResolvers();
  const entered = Promise.withResolvers();
  let calls = 0;
  const coordinator = new SchedulerAuthorizationCoordinator(f.repository, f.grants, 'profile', async () => {
    calls += 1;
    entered.resolve();
    await gate.promise;
    return [tool];
  });
  const preview = coordinator.preview(f.context, f.id);
  await entered.promise;
  const duplicatePreview = coordinator.preview(f.context, f.id);
  gate.resolve();
  await Promise.all([preview, duplicatePreview]);
  const first = coordinator.approve(f.context, f.id, 1, 'same-operation', f.input);
  const duplicate = coordinator.approve(f.context, f.id, 1, 'same-operation', f.input);
  gate.resolve();
  await Promise.all([first, duplicate]);
  assert.equal(calls, 1);
  const task = f.repository.get(f.context, f.id);
  assert.equal(task.revision, 2);
  assert.equal(f.grants.get(task.authorizationRef.grantId).state, 'active');
});

test('different task probes queue and a rejected inspection does not poison the queue', async (t) => {
  const f = await fixture(t);
  const second = f.service.mutate(f.context, {
    operation: 'create',
    key: 'second',
    input: {
      name: 'Second task',
      prompt: 'Search later.',
      schedule: { type: 'interval', everyMs: 60_000, anchorAt: '2026-01-01T00:00:00Z' },
    },
  }).task.id;
  const gate = Promise.withResolvers();
  const entered = Promise.withResolvers();
  const starts = [];
  const coordinator = new SchedulerAuthorizationCoordinator(
    f.repository,
    f.grants,
    'profile',
    async (task) => {
      starts.push(task.id);
      if (starts.length === 1) {
        entered.resolve();
        await gate.promise;
        throw new Error('Inspection fixture failure');
      }
      return [tool];
    }
  );
  const first = assert.rejects(coordinator.preview(f.context, f.id), /Inspection fixture failure/);
  await entered.promise;
  const queued = coordinator.preview(f.context, second);
  assert.deepEqual(starts, [f.id]);
  gate.resolve();
  await first;
  assert.deepEqual((await queued).tools, [tool]);
  assert.deepEqual((await coordinator.preview(f.context, f.id)).tools, [tool]);
  assert.deepEqual(starts, [f.id, second, f.id]);
});

test('editing during inspection rejects the stale review without granting authority', async (t) => {
  const f = await fixture(t);
  const gate = Promise.withResolvers();
  const entered = Promise.withResolvers();
  const coordinator = new SchedulerAuthorizationCoordinator(f.repository, f.grants, 'profile', async () => {
    entered.resolve();
    await gate.promise;
    return [tool];
  });
  const rejected = assert.rejects(coordinator.preview(f.context, f.id), {
    code: 'SCHEDULE_TASK_CONFLICT',
  });
  await entered.promise;
  f.service.mutate(f.context, {
    operation: 'update',
    key: 'edit-during-probe',
    taskId: f.id,
    revision: 1,
    input: { prompt: 'Changed task' },
  });
  gate.resolve();
  await rejected;
  assert.equal(f.repository.get(f.context, f.id).authorizationRef, null);
});

test('catalog and approval support more than 100 tools without persisting presentation metadata', async (t) => {
  const f = await fixture(t);
  const tools = Array.from({ length: 150 }, (_, i) => ({
    name: `tool_${i}`,
    identity: i.toString(16).padStart(64, '0'),
    description: `Tool ${i}`,
  }));
  const catalog = tools.map((tool) => ({ ...tool, source: 'test provider', unavailableReason: null }));
  const coordinator = new SchedulerAuthorizationCoordinator(
    f.repository,
    f.grants,
    'profile',
    async () => catalog
  );
  assert.equal((await coordinator.preview(f.context, f.id)).tools.length, 150);
  await coordinator.approve(f.context, f.id, 1, 'all-150', { ...f.input, tools });
  const grant = f.grants.get(f.repository.get(f.context, f.id).authorizationRef.grantId);
  assert.equal(grant.tools.length, 150);
  assert.equal('source' in grant.tools[0], false);
});

test('visible policy-blocked tools cannot be authorized by a forged selection', async (t) => {
  const f = await fixture(t);
  const coordinator = new SchedulerAuthorizationCoordinator(f.repository, f.grants, 'profile', async () => [
    { ...tool, source: 'provider', unavailableReason: 'Policy deny' },
  ]);
  assert.equal((await coordinator.preview(f.context, f.id)).tools[0].unavailableReason, 'Policy deny');
  await assert.rejects(coordinator.approve(f.context, f.id, 1, 'forged', f.input), {
    code: 'SCHEDULE_TASK_CONFLICT',
  });
  assert.equal(f.repository.get(f.context, f.id).authorizationRef, null);
});
