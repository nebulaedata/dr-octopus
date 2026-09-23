/**
 * @author Codex
 * @description 验证 Host Session runtime 的 Lease、身份、容量和精确路由不变量
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { RuntimeCommands, SessionRuntimeCoordinator } from '../dist/infrastructure/runtime/index.js';
import { SessionRuntimeSlot } from '../dist/infrastructure/runtime/runtime-slot.js';

const fixturePath = fileURLToPath(new URL('./fixtures/mock-rpc-entry.mjs', import.meta.url));

/**
 * 创建带 Pi v3 header 的隔离 Workspace 和 Session。
 */
async function createSessionFixture(sessionId = 'session-a') {
  const root = await mkdtemp(join(tmpdir(), 'octopus-server-runtime-'));
  const workspaceCwd = join(root, 'workspace');
  await mkdir(workspaceCwd);
  const sessionPath = join(root, `${sessionId}.jsonl`);
  await writeFile(
    sessionPath,
    `${JSON.stringify({ type: 'session', version: 3, id: sessionId, timestamp: new Date(0).toISOString(), cwd: workspaceCwd })}\n`,
    'utf8'
  );
  const timestamp = new Date(0).toISOString();
  return {
    root,
    sessionId: `web-${sessionId}`,
    expectedAgentSessionId: sessionId,
    sessionPath,
    workspace: {
      schemaVersion: 1,
      id: 'workspace-a',
      kind: 'project',
      name: 'Workspace A',
      slug: 'workspace-a',
      cwd: workspaceCwd,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  };
}

/**
 * 等待异步子进程事件满足断言条件。
 */
async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for runtime event.');
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}

/**
 * Executes one command through the Session-first acquisition contract used by production callers.
 */
async function executeForSession(coordinator, fixture, command) {
  return coordinator.withExisting(fixture, async (target) => target.execute(command));
}

/**
 * Responds to Extension UI through the same fenced Session operation contract.
 */
async function respondForSession(coordinator, fixture, response) {
  return coordinator.withExisting(fixture, async (target) => target.respondToExtensionUi(response));
}

test('new Web Session bootstraps a durable Pi Session before runtime activation', async () => {
  const fixture = await createSessionFixture('session-new');
  process.env.MOCK_SESSION_ID = fixture.expectedAgentSessionId;
  let cleanupCalled = false;
  const coordinator = new SessionRuntimeCoordinator({
    processOptions: { entryPath: fixturePath, requestTimeoutMs: 2_000 },
    createRuntimeId: () => 'runtime-new',
    sessionBootstrap: {
      async create(cwd) {
        assert.equal(cwd, fixture.workspace.cwd);
        return {
          sessionPath: fixture.sessionPath,
          cleanup: async () => {
            cleanupCalled = true;
          },
        };
      },
    },
  });
  try {
    const binding = await coordinator.activateNew({
      workspace: fixture.workspace,
      sessionId: fixture.sessionId,
    });

    assert.equal(binding.sessionId, fixture.sessionId);
    assert.equal(binding.agentSessionId, fixture.expectedAgentSessionId);
    assert.equal(binding.sessionPath, fixture.sessionPath);
    assert.equal(cleanupCalled, false);
  } finally {
    await coordinator.close();
    await rm(fixture.root, { recursive: true, force: true });
    delete process.env.MOCK_SESSION_ID;
  }
});

test('concurrent activation of one Session returns one immutable runtime', async () => {
  const fixture = await createSessionFixture();
  process.env.MOCK_SESSION_ID = 'session-a';
  const coordinator = new SessionRuntimeCoordinator({
    processOptions: { entryPath: fixturePath, requestTimeoutMs: 2_000 },
    createRuntimeId: () => 'runtime-a',
  });
  try {
    const [left, right] = await Promise.all([
      coordinator.activateExisting(fixture),
      coordinator.activateExisting(fixture),
    ]);
    assert.equal(left.runtimeId, right.runtimeId);
    assert.equal(left.epoch, right.epoch);
    assert.equal(left.sessionId, right.sessionId);
    assert.equal(left.agentSessionId, right.agentSessionId);
    assert.equal(left.sessionPath, right.sessionPath);
    assert.equal(left.runtimeId, 'runtime-a');
    assert.equal(left.sessionId, 'web-session-a');
    assert.equal(left.agentSessionId, 'session-a');
    assert.equal(coordinator.listWorkspace('workspace-a').length, 1);
  } finally {
    await coordinator.close();
    await rm(fixture.root, { recursive: true, force: true });
    delete process.env.MOCK_SESSION_ID;
  }
});

test('concurrent Session operations share one stable runtime epoch', async () => {
  const fixture = await createSessionFixture('session-concurrent-operations');
  process.env.MOCK_SESSION_ID = fixture.expectedAgentSessionId;
  let nextRuntime = 0;
  const coordinator = new SessionRuntimeCoordinator({
    processOptions: { entryPath: fixturePath, requestTimeoutMs: 2_000 },
    createRuntimeId: () => `runtime-${String(++nextRuntime)}`,
  });
  try {
    const epochs = await Promise.all(
      Array.from({ length: 24 }, async (_, index) =>
        coordinator.withExisting(fixture, async (target) => {
          await target.execute({ type: index % 2 === 0 ? 'get_state' : 'get_commands' });
          return target.epoch;
        })
      )
    );

    assert.deepEqual([...new Set(epochs)], [1]);
    assert.equal(nextRuntime, 1);
    assert.equal(coordinator.listWorkspace(fixture.workspace.id).length, 1);
  } finally {
    await coordinator.close();
    await rm(fixture.root, { recursive: true, force: true });
    delete process.env.MOCK_SESSION_ID;
  }
});

test('permission mode uses the active Pi RPC generation and resets after recovery', async () => {
  const fixture = await createSessionFixture('session-permission-generation');
  process.env.MOCK_SESSION_ID = fixture.expectedAgentSessionId;
  const coordinator = new SessionRuntimeCoordinator({
    processOptions: { entryPath: fixturePath, requestTimeoutMs: 2_000 },
    createRuntimeId: () => 'runtime-permission-generation',
  });
  try {
    await coordinator.activateExisting(fixture);
    assert.deepEqual(
      await coordinator.withExisting(fixture, async (target) => target.setPermissionMode('auto')),
      { mode: 'auto', scope: 'runtime-generation', persisted: false }
    );
    assert.deepEqual(await coordinator.withExisting(fixture, async (target) => target.getPermissionState()), {
      mode: 'auto',
      scope: 'runtime-generation',
      persisted: false,
    });

    await executeForSession(coordinator, fixture, { type: 'prompt', message: '__crash__' });
    await waitFor(() => coordinator.getBinding('runtime-permission-generation').state === 'recovering');
    assert.deepEqual(await coordinator.withExisting(fixture, async (target) => target.getPermissionState()), {
      mode: 'ask',
      scope: 'runtime-generation',
      persisted: false,
    });
  } finally {
    await coordinator.close();
    await rm(fixture.root, { recursive: true, force: true });
    delete process.env.MOCK_SESSION_ID;
  }
});

test('operation fencing epoch is published in the immutable runtime binding', async () => {
  const fixture = await createSessionFixture('session-epoch-binding');
  process.env.MOCK_SESSION_ID = fixture.expectedAgentSessionId;
  const coordinator = new SessionRuntimeCoordinator({
    processOptions: { entryPath: fixturePath, requestTimeoutMs: 2_000 },
    createRuntimeId: () => 'runtime-epoch-binding',
  });
  try {
    const binding = await coordinator.activateExisting(fixture);
    assert.equal(binding.epoch, 1);
    await coordinator.withExisting(fixture, async (target) => {
      assert.equal(target.epoch, binding.epoch);
      assert.equal(target.binding.epoch, binding.epoch);
    });
  } finally {
    await coordinator.close();
    await rm(fixture.root, { recursive: true, force: true });
    delete process.env.MOCK_SESSION_ID;
  }
});

test('runtime command rejects a stale client generation before RPC execution', async () => {
  let executed = false;
  const commands = new RuntimeCommands({
    async withRuntime(_sessionId, operation) {
      return operation({
        binding: { runtimeId: 'runtime-current', epoch: 4 },
        async execute() {
          executed = true;
          return { success: true };
        },
      });
    },
  });

  await assert.rejects(
    commands.execute('session-a', { type: 'get_state' }, { runtimeId: 'runtime-current', epoch: 3 }),
    (error) => error?.code === 'SESSION_RUNTIME_BINDING_MISMATCH'
  );
  assert.equal(executed, false);
});

test('aborted activation releases caller demand while shared startup completes', async () => {
  const fixture = await createSessionFixture('session-aborted-activation');
  process.env.MOCK_SESSION_ID = fixture.expectedAgentSessionId;
  process.env.MOCK_RESPONSE_DELAY_MS = '100';
  const coordinator = new SessionRuntimeCoordinator({
    processOptions: { entryPath: fixturePath, requestTimeoutMs: 2_000 },
    createRuntimeId: () => 'runtime-aborted-activation',
  });
  const controller = new AbortController();
  try {
    const cancelled = coordinator.withExisting(fixture, async () => undefined, {
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(cancelled, (error) => error?.code === 'SESSION_RUNTIME_CANCELLED');

    const binding = await coordinator.activateExisting(fixture);
    assert.equal(binding.runtimeId, 'runtime-aborted-activation');
    const diagnostics = coordinator.getDiagnostics();
    assert.equal(coordinator.isAcceptingRequests(), true);
    assert.equal(diagnostics.admissionQueueDepth, 0);
    assert.equal(diagnostics.slotStates.active, 1);
    assert.equal(diagnostics.slots[0]?.demandCount, 0);
  } finally {
    await coordinator.close();
    await rm(fixture.root, { recursive: true, force: true });
    delete process.env.MOCK_SESSION_ID;
    delete process.env.MOCK_RESPONSE_DELAY_MS;
  }
});

test('Coordinator readiness closes its request admission gate before shutdown completes', async () => {
  const coordinator = new SessionRuntimeCoordinator();
  assert.equal(coordinator.isAcceptingRequests(), true);
  await coordinator.close();
  assert.equal(coordinator.isAcceptingRequests(), false);
});

test('operation deadline releases its lease without cancelling shared runtime ownership', async () => {
  const fixture = await createSessionFixture('session-operation-deadline');
  process.env.MOCK_SESSION_ID = fixture.expectedAgentSessionId;
  const coordinator = new SessionRuntimeCoordinator({
    processOptions: { entryPath: fixturePath, requestTimeoutMs: 2_000 },
    createRuntimeId: () => 'runtime-operation-deadline',
  });
  try {
    await assert.rejects(
      coordinator.withExisting(fixture, async () => new Promise((resolve) => setTimeout(resolve, 100)), {
        deadlineAt: Date.now() + 10,
      }),
      (error) => error?.code === 'SESSION_RUNTIME_TIMEOUT'
    );
    assert.equal((await coordinator.activateExisting(fixture)).runtimeId, 'runtime-operation-deadline');
  } finally {
    await coordinator.close();
    await rm(fixture.root, { recursive: true, force: true });
    delete process.env.MOCK_SESSION_ID;
  }
});

test('coordinator close gracefully drains accepted operations before process retirement', async () => {
  const fixture = await createSessionFixture('session-graceful-drain');
  process.env.MOCK_SESSION_ID = fixture.expectedAgentSessionId;
  const coordinator = new SessionRuntimeCoordinator({
    processOptions: { entryPath: fixturePath, requestTimeoutMs: 2_000 },
    createRuntimeId: () => 'runtime-graceful-drain',
    shutdownDrainTimeoutMs: 1_000,
  });
  let releaseOperation;
  const operationGate = new Promise((resolve) => {
    releaseOperation = resolve;
  });
  try {
    const operation = coordinator.withExisting(fixture, async () => operationGate);
    await waitFor(() => coordinator.listWorkspace(fixture.workspace.id).length === 1);
    let closed = false;
    const closing = coordinator.close().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(closed, false);
    releaseOperation();
    await Promise.all([operation, closing]);
    assert.equal(closed, true);
  } finally {
    releaseOperation?.();
    await coordinator.close();
    await rm(fixture.root, { recursive: true, force: true });
    delete process.env.MOCK_SESSION_ID;
  }
});

test('two Sessions in one Workspace own independent runtimes', async () => {
  const first = await createSessionFixture('session-a');
  const secondPath = join(first.root, 'session-b.jsonl');
  await writeFile(
    secondPath,
    `${JSON.stringify({ type: 'session', version: 3, id: 'session-b', timestamp: new Date(0).toISOString(), cwd: first.workspace.cwd })}\n`,
    'utf8'
  );
  let nextRuntime = 0;
  const coordinator = new SessionRuntimeCoordinator({
    processOptions: { entryPath: fixturePath, requestTimeoutMs: 2_000 },
    createRuntimeId: () => `runtime-${String(++nextRuntime)}`,
  });
  try {
    process.env.MOCK_SESSION_ID = 'session-a';
    const left = await coordinator.activateExisting(first);
    process.env.MOCK_SESSION_ID = 'session-b';
    const right = await coordinator.activateExisting({
      workspace: first.workspace,
      sessionId: 'web-session-b',
      expectedAgentSessionId: 'session-b',
      sessionPath: secondPath,
    });
    assert.notEqual(left.runtimeId, right.runtimeId);
    assert.equal(coordinator.listWorkspace(first.workspace.id).length, 2);
  } finally {
    await coordinator.close();
    await rm(first.root, { recursive: true, force: true });
    delete process.env.MOCK_SESSION_ID;
  }
});

test('cwd mismatch fails before spawning and replacement commands are rejected', async () => {
  const fixture = await createSessionFixture();
  const otherCwd = join(fixture.root, 'other');
  await mkdir(otherCwd);
  const coordinator = new SessionRuntimeCoordinator({
    processOptions: { entryPath: fixturePath },
    createRuntimeId: () => 'runtime-a',
  });
  try {
    await assert.rejects(
      coordinator.activateExisting({ ...fixture, workspace: { ...fixture.workspace, cwd: otherCwd } }),
      (error) => error.code === 'SESSION_WORKSPACE_MISMATCH'
    );
    process.env.MOCK_SESSION_ID = 'session-a';
    await coordinator.activateExisting(fixture);
    await assert.rejects(
      executeForSession(coordinator, fixture, {
        type: 'switch_session',
        sessionPath: fixture.sessionPath,
      }),
      (error) => error.code === 'SESSION_REPLACEMENT_FORBIDDEN'
    );
  } finally {
    await coordinator.close();
    await rm(fixture.root, { recursive: true, force: true });
    delete process.env.MOCK_SESSION_ID;
  }
});

test('per-Workspace capacity evicts only that Workspace oldest safe idle runtime', async () => {
  const workspaceA = await createSessionFixture('session-a1');
  const sessionA2Path = join(workspaceA.root, 'session-a2.jsonl');
  await writeFile(
    sessionA2Path,
    `${JSON.stringify({ type: 'session', version: 3, id: 'session-a2', timestamp: new Date(0).toISOString(), cwd: workspaceA.workspace.cwd })}\n`,
    'utf8'
  );
  const workspaceB = await createSessionFixture('session-b');
  workspaceB.workspace.id = 'workspace-b';
  let nextRuntime = 0;
  const coordinator = new SessionRuntimeCoordinator({
    processOptions: { entryPath: fixturePath, requestTimeoutMs: 2_000 },
    limits: { maxActiveRuntimes: 10, maxActiveRuntimesPerWorkspace: 1, idleTtlMs: 0 },
    createRuntimeId: () => `runtime-${String(++nextRuntime)}`,
  });
  try {
    process.env.MOCK_SESSION_ID = 'session-a1';
    await coordinator.activateExisting(workspaceA);
    process.env.MOCK_SESSION_ID = 'session-b';
    const bindingB = await coordinator.activateExisting(workspaceB);
    process.env.MOCK_SESSION_ID = 'session-a2';
    const bindingA2 = await coordinator.activateExisting({
      workspace: workspaceA.workspace,
      sessionId: 'web-session-a2',
      expectedAgentSessionId: 'session-a2',
      sessionPath: sessionA2Path,
    });
    assert.equal(coordinator.listWorkspace('workspace-a').length, 1);
    assert.equal(coordinator.listWorkspace('workspace-a')[0]?.sessionId, 'web-session-a2');
    assert.equal(coordinator.getBinding(bindingB.runtimeId).sessionId, 'web-session-b');
    assert.equal(bindingA2.sessionId, 'web-session-a2');
  } finally {
    await coordinator.close();
    await Promise.all([
      rm(workspaceA.root, { recursive: true, force: true }),
      rm(workspaceB.root, { recursive: true, force: true }),
    ]);
    delete process.env.MOCK_SESSION_ID;
  }
});

test('hard capacity reclaims a safe settled runtime before its idle TTL expires', async () => {
  const fixture = await createSessionFixture('session-a');
  const secondPath = join(fixture.root, 'session-b.jsonl');
  await writeFile(
    secondPath,
    `${JSON.stringify({ type: 'session', version: 3, id: 'session-b', timestamp: new Date(0).toISOString(), cwd: fixture.workspace.cwd })}\n`,
    'utf8'
  );
  let nextRuntime = 0;
  const coordinator = new SessionRuntimeCoordinator({
    processOptions: { entryPath: fixturePath, requestTimeoutMs: 2_000 },
    limits: {
      maxActiveRuntimes: 1,
      maxActiveRuntimesPerWorkspace: 1,
      idleTtlMs: 15 * 60_000,
    },
    createRuntimeId: () => `runtime-${String(++nextRuntime)}`,
  });
  try {
    process.env.MOCK_SESSION_ID = 'session-a';
    const first = await coordinator.activateExisting(fixture);

    process.env.MOCK_SESSION_ID = 'session-b';
    const replacement = await coordinator.activateExisting({
      workspace: fixture.workspace,
      sessionId: 'web-session-b',
      expectedAgentSessionId: 'session-b',
      sessionPath: secondPath,
    });

    assert.equal(replacement.runtimeId, 'runtime-2');
    assert.equal(coordinator.listWorkspace(fixture.workspace.id).length, 1);
    await assert.rejects(
      Promise.resolve().then(() => coordinator.getBinding(first.runtimeId)),
      {
        code: 'SESSION_RUNTIME_STALE',
      }
    );
  } finally {
    await coordinator.close();
    await rm(fixture.root, { recursive: true, force: true });
    delete process.env.MOCK_SESSION_ID;
  }
});

test('operation lease prevents capacity reclaim until the complete callback releases', async () => {
  const fixture = await createSessionFixture('session-a');
  const secondPath = join(fixture.root, 'session-b.jsonl');
  await writeFile(
    secondPath,
    `${JSON.stringify({ type: 'session', version: 3, id: 'session-b', timestamp: new Date(0).toISOString(), cwd: fixture.workspace.cwd })}\n`,
    'utf8'
  );
  let nextRuntime = 0;
  let releaseOperation;
  const operationGate = new Promise((resolveOperation) => {
    releaseOperation = resolveOperation;
  });
  let operationAcquired;
  const acquired = new Promise((resolveAcquired) => {
    operationAcquired = resolveAcquired;
  });
  let retainedTarget;
  const coordinator = new SessionRuntimeCoordinator({
    processOptions: { entryPath: fixturePath, requestTimeoutMs: 2_000 },
    limits: { maxActiveRuntimes: 1, maxActiveRuntimesPerWorkspace: 1, idleTtlMs: 0 },
    createRuntimeId: () => `runtime-${String(++nextRuntime)}`,
  });
  const second = {
    workspace: fixture.workspace,
    sessionId: 'web-session-b',
    expectedAgentSessionId: 'session-b',
    sessionPath: secondPath,
  };
  try {
    process.env.MOCK_SESSION_ID = 'session-a';
    const holding = coordinator.withExisting(fixture, async (target) => {
      retainedTarget = target;
      operationAcquired();
      await operationGate;
    });
    await acquired;

    process.env.MOCK_SESSION_ID = 'session-b';
    await assert.rejects(coordinator.activateExisting(second), {
      code: 'SESSION_RUNTIME_CAPACITY',
    });

    releaseOperation();
    await holding;
    const replacement = await coordinator.activateExisting(second);
    assert.equal(replacement.runtimeId, 'runtime-2');
    await assert.rejects(retainedTarget.execute({ type: 'get_state' }), {
      code: 'SESSION_RUNTIME_STALE',
    });
  } finally {
    releaseOperation?.();
    await coordinator.close();
    await rm(fixture.root, { recursive: true, force: true });
    delete process.env.MOCK_SESSION_ID;
  }
});

test('stable Session Slot shares activation and fences capacity reclaim', async () => {
  const sessionId = 'web-session-demand';
  const sessionPath = 'C:/sessions/session-demand.jsonl';
  const slot = new SessionRuntimeSlot(sessionId, sessionPath);
  const createRuntime = (runtimeId, epoch) => ({
    getBinding() {
      return {
        runtimeId,
        epoch,
        sessionId,
        sessionPath,
        workspaceId: 'workspace-a',
        workspaceCwd: 'C:/workspace-a',
        agentSessionId: 'agent-session-demand',
        state: 'idle',
        lastActiveAt: 0,
      };
    },
    start() {},
    tryBeginReclaim() {
      return true;
    },
    beginStop() {
      return true;
    },
  });
  const firstActivation = slot.activate(async (epoch) => createRuntime('runtime-1', epoch));
  const sharedActivation = slot.activate(async (epoch) => createRuntime('unexpected', epoch));
  const [runtime, sharedRuntime] = await Promise.all([firstActivation, sharedActivation]);
  assert.equal(runtime, sharedRuntime);
  assert.equal(runtime.getBinding().epoch, 1);

  const releaseDemand = slot.acquireDemand();
  assert.equal(slot.beginDrain('runtime-1'), undefined);
  slot.assertFence('runtime-1', 1);

  releaseDemand();
  assert.equal(slot.beginDrain('runtime-1'), runtime);
  assert.equal(slot.getState(), 'draining');
  slot.retire('runtime-1');
  assert.equal(slot.getState(), 'empty');
  const replacement = await slot.activate(async (epoch) => createRuntime('runtime-2', epoch));
  assert.equal(replacement.getBinding().epoch, 2);
  assert.throws(() => slot.assertFence('runtime-1', 1), {
    code: 'SESSION_RUNTIME_BINDING_MISMATCH',
  });
});

test('concurrent stop is single-flight and activation waits for retirement', async () => {
  const fixture = await createSessionFixture('session-a');
  process.env.MOCK_SESSION_ID = 'session-a';
  let nextRuntime = 0;
  const coordinator = new SessionRuntimeCoordinator({
    processOptions: { entryPath: fixturePath, requestTimeoutMs: 2_000 },
    createRuntimeId: () => `runtime-${String(++nextRuntime)}`,
  });
  try {
    const first = await coordinator.activateExisting(fixture);
    const left = coordinator.stop(first.runtimeId);
    const right = coordinator.stop(first.runtimeId);
    assert.equal(left, right);
    const activation = coordinator.activateExisting(fixture);
    const [, replacement] = await Promise.all([left, activation]);
    assert.equal(replacement.runtimeId, 'runtime-2');
    assert.equal(coordinator.listWorkspace(fixture.workspace.id).length, 1);
  } finally {
    await coordinator.close();
    await rm(fixture.root, { recursive: true, force: true });
    delete process.env.MOCK_SESSION_ID;
  }
});

test('coordinator shutdown waits for an accepted activation before retiring it', async () => {
  const fixture = await createSessionFixture('session-a');
  process.env.MOCK_SESSION_ID = 'session-a';
  process.env.MOCK_RESPONSE_DELAY_MS = '100';
  const coordinator = new SessionRuntimeCoordinator({
    processOptions: { entryPath: fixturePath, requestTimeoutMs: 2_000 },
    createRuntimeId: () => 'runtime-1',
  });
  try {
    const activation = coordinator.activateExisting(fixture);
    const closing = coordinator.close();
    const [binding] = await Promise.all([activation, closing]);
    await assert.rejects(
      Promise.resolve().then(() => coordinator.getBinding(binding.runtimeId)),
      { code: 'SESSION_RUNTIME_STALE' }
    );
  } finally {
    await coordinator.close();
    await rm(fixture.root, { recursive: true, force: true });
    delete process.env.MOCK_SESSION_ID;
    delete process.env.MOCK_RESPONSE_DELAY_MS;
  }
});

test('running runtime is never evicted to satisfy capacity', async () => {
  const fixture = await createSessionFixture('session-a');
  const secondPath = join(fixture.root, 'session-b.jsonl');
  await writeFile(
    secondPath,
    `${JSON.stringify({ type: 'session', version: 3, id: 'session-b', timestamp: new Date(0).toISOString(), cwd: fixture.workspace.cwd })}\n`,
    'utf8'
  );
  let nextRuntime = 0;
  const coordinator = new SessionRuntimeCoordinator({
    processOptions: { entryPath: fixturePath, requestTimeoutMs: 2_000 },
    limits: { maxActiveRuntimes: 1, maxActiveRuntimesPerWorkspace: 1, idleTtlMs: 0 },
    createRuntimeId: () => `runtime-${String(++nextRuntime)}`,
  });
  const events = [];
  coordinator.onEvent((event) => events.push(event));
  try {
    process.env.MOCK_SESSION_ID = 'session-a';
    const binding = await coordinator.activateExisting(fixture);
    await executeForSession(coordinator, fixture, { type: 'prompt', message: '__running__' });
    await waitFor(() => events.some((event) => event.payload?.state === 'running'));
    process.env.MOCK_SESSION_ID = 'session-b';
    await assert.rejects(
      coordinator.activateExisting({
        workspace: fixture.workspace,
        sessionId: 'web-session-b',
        expectedAgentSessionId: 'session-b',
        sessionPath: secondPath,
      }),
      (error) => error.code === 'SESSION_RUNTIME_CAPACITY'
    );
    assert.equal(coordinator.getBinding(binding.runtimeId).state, 'running');
  } finally {
    await coordinator.close();
    await rm(fixture.root, { recursive: true, force: true });
    delete process.env.MOCK_SESSION_ID;
  }
});

test('failed compaction returns the runtime to idle after its terminal event', async () => {
  const fixture = await createSessionFixture('session-compact');
  process.env.MOCK_SESSION_ID = fixture.expectedAgentSessionId;
  const coordinator = new SessionRuntimeCoordinator({
    processOptions: { entryPath: fixturePath, requestTimeoutMs: 2_000 },
    createRuntimeId: () => 'runtime-compact',
  });
  const events = [];
  coordinator.onEvent((event) => events.push(event));
  try {
    const binding = await coordinator.activateExisting(fixture);

    await assert.rejects(
      executeForSession(coordinator, fixture, { type: 'compact' }),
      (error) =>
        error.code === 'RPC_RESPONSE_ERROR' &&
        error.message.includes('Nothing to compact (session too small)')
    );
    await waitFor(() =>
      events.some((event) => event.type === 'agent-event' && event.payload?.type === 'compaction_end')
    );

    assert.equal(coordinator.getBinding(binding.runtimeId).state, 'idle');
    assert.ok(events.some((event) => event.type === 'runtime-state' && event.payload?.state === 'running'));
    assert.ok(events.some((event) => event.type === 'runtime-state' && event.payload?.state === 'idle'));
  } finally {
    await coordinator.close();
    await rm(fixture.root, { recursive: true, force: true });
    delete process.env.MOCK_SESSION_ID;
  }
});

test('crashed runtime recovers with the same immutable Session binding', async () => {
  const fixture = await createSessionFixture('session-a');
  process.env.MOCK_SESSION_ID = 'session-a';
  const coordinator = new SessionRuntimeCoordinator({
    processOptions: { entryPath: fixturePath, requestTimeoutMs: 2_000 },
    createRuntimeId: () => 'runtime-a',
  });
  const events = [];
  coordinator.onEvent((event) => events.push(event));
  try {
    const before = await coordinator.activateExisting(fixture);
    await executeForSession(coordinator, fixture, { type: 'prompt', message: '__crash__' });
    await waitFor(() => coordinator.getBinding(before.runtimeId).state === 'recovering');
    await executeForSession(coordinator, fixture, { type: 'get_state' });
    const after = coordinator.getBinding(before.runtimeId);
    assert.equal(after.runtimeId, before.runtimeId);
    assert.equal(after.sessionId, before.sessionId);
    assert.equal(after.sessionPath, before.sessionPath);
    assert.ok(
      events.some((event) => event.type === 'runtime-state' && event.payload?.processGeneration === 2)
    );
  } finally {
    await coordinator.close();
    await rm(fixture.root, { recursive: true, force: true });
    delete process.env.MOCK_SESSION_ID;
  }
});

test('extension UI response must match a pending request on the exact runtime', async () => {
  const fixture = await createSessionFixture('session-a');
  process.env.MOCK_SESSION_ID = 'session-a';
  const coordinator = new SessionRuntimeCoordinator({
    processOptions: { entryPath: fixturePath, requestTimeoutMs: 2_000 },
    createRuntimeId: () => 'runtime-a',
  });
  const events = [];
  coordinator.onEvent((event) => events.push(event));
  try {
    await coordinator.activateExisting(fixture);
    await executeForSession(coordinator, fixture, { type: 'prompt', message: '__ui__' });
    await waitFor(() => events.some((event) => event.type === 'extension-ui'));
    await assert.rejects(
      respondForSession(coordinator, fixture, {
        type: 'extension_ui_response',
        id: 'wrong-dialog',
        confirmed: true,
      }),
      (error) => error.code === 'SESSION_EXTENSION_UI_NOT_FOUND'
    );
    await respondForSession(coordinator, fixture, {
      type: 'extension_ui_response',
      id: 'dialog-1',
      confirmed: true,
    });
  } finally {
    await coordinator.close();
    await rm(fixture.root, { recursive: true, force: true });
    delete process.env.MOCK_SESSION_ID;
  }
});
