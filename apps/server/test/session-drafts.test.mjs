/**
 * @author Codex
 * @description Verifies unpublished home drafts, first-message promotion, shared runtime identity, and bounded cleanup.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import Fastify from 'fastify';
import { createDatabase } from '../dist/db/client.js';
import { SessionsRepository } from '../dist/modules/sessions/sessions.repository.js';
import { SessionsService } from '../dist/modules/sessions/sessions.service.js';
import { SessionDraftsService } from '../dist/modules/sessions/session-drafts.service.js';
import { registerSessionDraftsController } from '../dist/modules/sessions/session-drafts.controller.js';
import { SessionRuntimeCoordinator } from '../dist/lib/runtime/index.js';

/**
 * Creates deterministic unpublished metadata with the same repository contract as production.
 */
function draftRow(id, workspaceId = 'general') {
  return {
    id,
    workspaceId,
    agentSessionId: `pi-${id}`,
    agentSessionPath: `${id}.jsonl`,
    title: 'New session',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

test('draft preferences stay outside SQLite until idempotent publication', () => {
  const database = createDatabase(':memory:');
  try {
    const repository = new SessionsRepository(database);
    const id = randomUUID();
    repository.createDraft(draftRow(id));
    repository.updateModel(id, 'test-provider', 'test-model');
    repository.updatePreferences(id, { thinkingLevel: 'high', autoRetryEnabled: false });
    assert.equal(repository.get(id).isDraft, true);
    assert.equal(repository.list().length, 0);
    assert.equal(database.sqlite.prepare('SELECT count(*) AS count FROM sessions').get().count, 0);
    const published = repository.publishDraft(id, 'First question');
    assert.equal(published.isDraft, undefined);
    assert.equal(published.model, 'test-model');
    assert.equal(published.preferences.thinkingLevel, 'high');
    assert.equal(published.preferences.autoRetryEnabled, false);
    assert.deepEqual(repository.publishDraft(id, 'Retry title'), published);
    assert.equal(repository.list().length, 1);
    assert.equal(repository.listDrafts().length, 0);
  } finally {
    database.sqlite.close();
  }
});

test('draft preparation deduplicates requests and cleanup protects live subscriptions', async () => {
  const database = createDatabase(':memory:');
  const repository = new SessionsRepository(database);
  const id = randomUUID();
  let finish;
  let calls = 0;
  let demandCount = 1;
  const removed = [];
  const drafts = new SessionDraftsService({
    repository,
    runtime: { getDiagnostics: () => ({ slots: [{ sessionId: id, demandCount, state: 'ready' }] }) },
    prepare: async () => {
      calls++;
      await new Promise((resolve) => {
        finish = resolve;
      });
      return repository.createDraft(draftRow(id));
    },
    remove: async (sessionId) => {
      removed.push(sessionId);
      repository.delete(sessionId);
    },
    onError: (error) => {
      throw error;
    },
  });
  try {
    const first = drafts.prepare('general', id);
    assert.equal(drafts.prepare('general', id), first);
    assert.throws(() => drafts.prepare('other', id), /another workspace/);
    assert.equal(calls, 1);
    finish();
    await first;
    await drafts.reap();
    assert.equal(repository.get(id).isDraft, true);
    demandCount = 0;
    await drafts.reap();
    assert.deepEqual(removed, [id]);
    assert.equal(repository.get(id), undefined);
    assert.throws(() => drafts.prepare('general', 'invalid'), /valid draft identity/);
  } finally {
    await drafts.close();
    database.sqlite.close();
  }
});

test('HTTP prepare and first prompt reuse one real RPC child and never publish an empty draft', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-home-draft-'));
  const database = createDatabase(':memory:');
  const repository = new SessionsRepository(database);
  const server = Fastify();
  let id = randomUUID();
  const piId = randomUUID();
  const sessionPath = join(root, 'draft.jsonl');
  const workspace = {
    schemaVersion: 1,
    id: 'general',
    kind: 'general',
    name: 'General',
    slug: 'general',
    cwd: root,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
  await writeFile(
    sessionPath,
    JSON.stringify({
      type: 'session',
      version: 3,
      id: piId,
      cwd: root,
      timestamp: new Date().toISOString(),
    }) + '\n'
  );
  const previousMockId = process.env.MOCK_SESSION_ID;
  process.env.MOCK_SESSION_ID = piId;
  let activations = 0;
  const runtime = new SessionRuntimeCoordinator({
    processOptions: {
      entryPath: fileURLToPath(new URL('./fixtures/mock-rpc-entry.mjs', import.meta.url)),
      agentDir: root,
      requestTimeoutMs: 5_000,
    },
    createRuntimeId: () => `runtime-${++activations}`,
    sessionBootstrap: {
      create: async () => {
        const nextPath = join(root, `draft-${activations}.jsonl`);
        await writeFile(
          nextPath,
          JSON.stringify({
            type: 'session',
            version: 3,
            id: piId,
            cwd: root,
            timestamp: new Date(0).toISOString(),
          }) + '\n'
        );
        return { sessionPath: nextPath, cleanup: async () => {} };
      },
    },
  });
  const sessions = new SessionsService(server, {
    runtime,
    sessionsRepository: repository,
    workspaceService: { resolve: async () => workspace },
    messageFeedbackRepository: { listBySession: () => [] },
  });
  registerSessionDraftsController(server, sessions);
  let reservation;
  try {
    const responses = await Promise.all(
      [1, 2].map(() =>
        server.inject({ method: 'POST', url: '/workspaces/general/session-drafts', payload: { draftId: id } })
      )
    );
    assert.deepEqual(
      responses.map((response) => response.statusCode),
      [200, 200]
    );
    assert.equal(responses[0].json().isDraft, true);
    assert.equal(repository.list().length, 0);
    assert.equal(activations, 1);
    const expiredId = id;
    const previousPath = repository.getRow(id).agentSessionPath;
    await sessions.deleteSession(id, { deleteFiles: true });
    assert.equal(repository.get(id), undefined);
    assert.equal(runtime.getDiagnostics().slots.find((slot) => slot.sessionId === id).state, 'empty');
    await assert.rejects(async () => sessions.prepareDraftSession('general', expiredId), {
      code: 'SESSION_DRAFT_EXPIRED',
    });
    assert.equal(activations, 1, 'expired IDs must be rejected before bootstrapping another Pi file');
    id = randomUUID();
    const replacement = await sessions.prepareDraftSession('general', id);
    assert.equal(replacement.isDraft, true);
    assert.notEqual(repository.getRow(id).agentSessionPath, previousPath);
    assert.equal(repository.list().length, 0);
    reservation = await sessions.acquireSubscription(id);
    const before = reservation.runtime;
    const published = await server.inject({
      method: 'POST',
      url: `/workspaces/general/session-drafts/${id}/publish`,
      payload: { title: 'Hello' },
    });
    assert.equal(published.statusCode, 200);
    await sessions.execute(
      id,
      { type: 'prompt', message: 'Hello' },
      { runtimeId: before.runtimeId, epoch: before.epoch }
    );
    assert.equal(repository.list().length, 1);
    assert.equal(sessions.getSession(id).runtime.runtimeId, before.runtimeId);
    assert.equal(sessions.getSession(id).runtime.epoch, before.epoch);
    assert.equal(activations, 2);
    await sessions.closeDrafts();
    assert.equal(repository.list().length, 1, 'shutdown must retain published conversations');
  } finally {
    reservation?.release();
    sessions.dispose();
    await runtime.close();
    await server.close();
    database.sqlite.close();
    await rm(root, { recursive: true, force: true });
    if (previousMockId === undefined) delete process.env.MOCK_SESSION_ID;
    else process.env.MOCK_SESSION_ID = previousMockId;
  }
});

test('failed preparation can retry without leaving catalog entries or pending ownership', async () => {
  const database = createDatabase(':memory:');
  const repository = new SessionsRepository(database);
  const id = randomUUID();
  let attempts = 0;
  const drafts = new SessionDraftsService({
    repository,
    runtime: { getDiagnostics: () => ({ slots: [] }) },
    prepare: async () => {
      if (++attempts === 1) throw new Error('startup failed');
      return repository.createDraft(draftRow(id));
    },
    remove: async (sessionId) => {
      repository.delete(sessionId);
    },
    onError: () => {},
  });
  try {
    await assert.rejects(drafts.prepare('general', id), /startup failed/);
    assert.equal(repository.list().length, 0);
    assert.equal(repository.listDrafts().length, 0);
    assert.equal((await drafts.prepare('general', id)).isDraft, true);
    assert.equal(attempts, 2);
    await drafts.close();
    assert.equal(repository.listDrafts().length, 0);
  } finally {
    drafts.dispose();
    database.sqlite.close();
  }
});
