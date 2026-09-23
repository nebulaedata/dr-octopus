/**
 * @author Codex
 * @description Exercises committed model notifications and real subprocess restart fencing without network providers.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RuntimeConfigChanges } from '../dist/infrastructure/runtime-config/runtime-config-changes.js';
import { createModelConfigChanges } from '../dist/modules/model-settings/model-settings.service.js';
import { SessionRuntimeCoordinator } from '../dist/infrastructure/runtime/coordinator.js';
import { SessionLifecycleControl } from '../dist/infrastructure/runtime/session-lifecycle-control.js';
import { saveLocalProvider } from '../dist/infrastructure/pi-settings/local-provider-repository.js';
import { SessionRuntimeDirectory } from '../dist/infrastructure/runtime/runtime-directory.js';
import { SessionRuntimeRetirement } from '../dist/infrastructure/runtime/retirement.js';

test('only enabled model commits change the baseline; failed observers cannot interrupt commits', () => {
  const changes = new RuntimeConfigChanges();
  const model = createModelConfigChanges(changes);
  let notices = 0;
  changes.subscribe(() => {
    throw new Error('observer failed');
  });
  const unsubscribe = changes.subscribe(() => notices++);
  for (const route of ['/settings/environment', '/settings/permissions', '/settings/default-model']) {
    changes.record(route);
  }
  assert.equal(changes.current(), 0);
  model.recordCommitted();
  assert.deepEqual(changes.since(0), ['/settings/model-providers']);
  assert.deepEqual(changes.since(1), []);
  assert.equal(notices, 1);
  unsubscribe();
  model.recordCommitted();
  assert.equal(notices, 1);
  const disabled = new RuntimeConfigChanges(new Set());
  createModelConfigChanges(disabled).recordCommitted();
  assert.equal(disabled.current(), 0);
});

test('model repository distinguishes draft, unchanged configuration and a new endpoint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-model-commit-'));
  try {
    const path = join(root, 'models.json');
    const record = { name: 'Local', runtime: 'ollama', baseUrl: 'http://localhost:11434' };
    assert.equal(await saveLocalProvider(path, 'local', record), false);
    assert.equal(await saveLocalProvider(path, 'local', { ...record, modelId: 'model' }), true);
    assert.equal(await saveLocalProvider(path, 'local', { ...record, modelId: 'model' }), false);
    assert.equal(
      await saveLocalProvider(path, 'local', {
        ...record,
        modelId: 'model',
        baseUrl: 'http://localhost:11435',
      }),
      true
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('timeout keeps lifecycle ownership until late work cleans up, then permits a retry', async () => {
  const lifecycle = new SessionLifecycleControl();
  const release = Promise.withResolvers();
  const request = { expectedRuntime: null, allowInterrupt: false };
  const pending = lifecycle.restart(
    request,
    async (assertLive) => {
      await release.promise;
      assertLive();
    },
    () => {},
    10
  );
  const keepAlive = setTimeout(() => {}, 1_000);
  try {
    await assert.rejects(pending, { code: 'SESSION_RESTART_TIMEOUT' });
    assert.equal(lifecycle.snapshot().error.retryable, false);
    assert.throws(() => lifecycle.assertAvailable(), { code: 'SESSION_RESTART_IN_PROGRESS' });
    release.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    lifecycle.assertAvailable();
    assert.equal(lifecycle.snapshot().error.retryable, true);
  } finally {
    clearTimeout(keepAlive);
  }
});

test('an unconfirmed process exit keeps its Slot owned and prevents subsequent activation', async () => {
  const directory = new SessionRuntimeDirectory();
  const slot = directory.getOrCreate('session');
  await slot.activate(async (epoch) => ({
    getBinding: () => ({ runtimeId: 'runtime', sessionId: 'session', sessionPath: 'original.jsonl', epoch }),
    start() {},
    beginStop() {},
    waitForDrain: async () => true,
    dispose: () => assert.fail('unconfirmed process must retain ownership'),
  }));
  const retirement = new SessionRuntimeRetirement(
    {
      stop: async () => {
        throw new Error('exit unconfirmed');
      },
    },
    directory
  );
  await assert.rejects(retirement.stop('runtime'), /exit unconfirmed/);
  assert.equal(slot.getState(), 'draining');
  assert.equal(slot.lifecycle.snapshot().error.retryable, false);
  assert.throws(() => slot.lifecycle.assertAvailable(), { code: 'SESSION_RESTART_FAILED' });
});

test('restart preserves durable Session identity, merges duplicates and fences stale targets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-restart-'));
  const workspaceCwd = join(root, 'workspace');
  await mkdir(workspaceCwd);
  const sessionPath = join(root, 'session.jsonl');
  const content =
    JSON.stringify({
      type: 'session',
      version: 3,
      id: 'pi-session',
      timestamp: new Date(0).toISOString(),
      cwd: workspaceCwd,
    }) + '\n';
  await writeFile(sessionPath, content);
  const modelPath = join(root, 'model.json');
  const model = { provider: 'fixture', id: 'same-model', name: 'Fixture', baseUrl: 'http://127.0.0.1:19001' };
  await writeFile(modelPath, JSON.stringify(model));
  const input = {
    sessionId: 'web-session',
    expectedAgentSessionId: 'pi-session',
    sessionPath,
    workspace: {
      id: 'workspace',
      cwd: workspaceCwd,
      schemaVersion: 1,
      kind: 'project',
      name: 'Fixture',
      slug: 'fixture',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
  };
  const coordinator = new SessionRuntimeCoordinator({
    processOptions: {
      entryPath: fileURLToPath(new URL('./fixtures/mock-rpc-entry.mjs', import.meta.url)),
      childEnvironment: { MOCK_SESSION_ID: 'pi-session', MOCK_MODEL_CONFIG: modelPath },
    },
  });
  try {
    assert.equal(coordinator.getControl(input.sessionId).restartRequired, false);
    assert.equal(coordinator.getDiagnostics().activeRuntimeCount, 0);
    const first = await coordinator.activateExisting(input);
    await writeFile(modelPath, JSON.stringify({ ...model, baseUrl: 'http://127.0.0.1:19002' }));
    const staleState = await coordinator.withExisting(input, (operation) =>
      operation.execute({ type: 'get_state' })
    );
    assert.equal(staleState.data.model.baseUrl, model.baseUrl);
    coordinator.configChanges.record('/settings/model-providers');
    assert.equal(coordinator.getControl(input.sessionId).restartRequired, true);
    const request = {
      expectedRuntime: { runtimeId: first.runtimeId, epoch: first.epoch },
      allowInterrupt: false,
    };
    const pending = coordinator.restart(input, request);
    const duplicate = coordinator.restart(input, request);
    assert.equal(pending, duplicate);
    await assert.rejects(coordinator.activateExisting(input), { code: 'SESSION_RESTART_IN_PROGRESS' });
    const second = await pending;
    assert.notEqual(second.runtimeId, first.runtimeId);
    assert.equal(second.epoch, first.epoch + 1);
    assert.equal(second.agentSessionId, first.agentSessionId);
    const freshState = await coordinator.withExisting(input, (operation) =>
      operation.execute({ type: 'get_state' })
    );
    assert.equal(freshState.data.model.id, model.id);
    assert.equal(freshState.data.model.baseUrl, 'http://127.0.0.1:19002');
    assert.equal(await readFile(sessionPath, 'utf8'), content);
    assert.equal(coordinator.getControl(input.sessionId).restartRequired, false);
    await assert.rejects(coordinator.restart(input, request), { code: 'SESSION_RUNTIME_BINDING_MISMATCH' });
    await coordinator.withExisting(input, (operation) =>
      operation.execute({ type: 'prompt', message: '__running__' })
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    const next = {
      expectedRuntime: { runtimeId: second.runtimeId, epoch: second.epoch },
      allowInterrupt: false,
    };
    await assert.rejects(coordinator.restart(input, next), { code: 'SESSION_BUSY' });
    assert.equal(coordinator.getBindingBySessionId(input.sessionId).runtimeId, second.runtimeId);
    await coordinator.restart(input, { ...next, allowInterrupt: true });
    await coordinator.deleteSession(input.sessionId, async () => true);
    await assert.rejects(coordinator.activateExisting(input), { code: 'SESSION_NOT_FOUND' });
  } finally {
    await coordinator.close();
    await rm(root, { recursive: true, force: true });
  }
});
