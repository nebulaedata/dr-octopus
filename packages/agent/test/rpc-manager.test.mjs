/**
 * @author Codex
 * @description Agent RPC 业务生命周期、协议故障和恢复策略测试
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { AgentProcessManager, AgentRpcProcess } from '../dist/rpc/index.js';

const fixturePath = fileURLToPath(new URL('./fixtures/mock-rpc-entry.mjs', import.meta.url));

test('failed cleanup retains the managed process for retry and blocks recovery', async () => {
  const fixture = await createFixture();
  const manager = new AgentProcessManager();
  const child = await manager.start('cleanup-retry', fixture.options);
  const originalStop = child.stop.bind(child);
  child.stop = async () => {
    throw new Error('cleanup unconfirmed');
  };
  try {
    await assert.rejects(manager.stop('cleanup-retry'), /unconfirmed/);
    assert.equal(manager.getHealth('cleanup-retry').health, 'unavailable');
    await assert.rejects(manager.ensureReady('cleanup-retry'), /cleanup is not confirmed/);
    child.stop = originalStop;
    await manager.stop('cleanup-retry');
    assert.equal(manager.getHealth('cleanup-retry'), undefined);
  } finally {
    child.stop = originalStop;
    await manager.stopAll();
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

/**
 * 创建使用测试入口的临时 RPC 配置。
 *
 * @returns 临时目录及进程配置
 */
async function createFixture() {
  const workspace = await mkdtemp(join(tmpdir(), 'dr-octopus-rpc-'));
  const timestamp = new Date(0).toISOString();
  return {
    workspace,
    options: {
      workspace: {
        schemaVersion: 1,
        id: 'test-workspace',
        kind: 'project',
        name: 'Test Workspace',
        slug: 'test-workspace',
        cwd: workspace,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      entryPath: fixturePath,
      requestTimeoutMs: 2_000,
    },
  };
}

test('strict JSONL decoder preserves split UTF-8 and U+2028', async () => {
  const fixture = await createFixture();
  const process = new AgentRpcProcess(fixture.options);
  try {
    await process.start();
    const response = await process.request({ type: 'test_split_utf8' });
    assert.equal(response.success, true);
    assert.equal(response.data.text, '汉字\u2028仍在同一帧');
  } finally {
    await process.stop();
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test('protocol corruption fails pending requests and terminates the process', async () => {
  const fixture = await createFixture();
  const process = new AgentRpcProcess(fixture.options);
  try {
    await process.start();
    await assert.rejects(
      process.request({ type: 'test_invalid_json' }),
      (error) => error.code === 'RPC_PROTOCOL_ERROR'
    );
    assert.equal(process.getState(), 'failed');
  } finally {
    await process.stop();
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test('execute converts a Pi failure response into a stable business error', async () => {
  const fixture = await createFixture();
  const process = new AgentRpcProcess(fixture.options);
  try {
    await process.start();
    await assert.rejects(
      process.execute({ type: 'test_failure' }),
      (error) => error.code === 'RPC_RESPONSE_ERROR' && error.message === 'fixture rejected command'
    );
  } finally {
    await process.stop();
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test('manager removes a crashed instance and single-flights on-demand recovery', async () => {
  const fixture = await createFixture();
  fixture.options.sessionPath = join(fixture.workspace, 'bound-session.jsonl');
  const manager = new AgentProcessManager({ restartPolicy: { mode: 'on-demand' } });
  try {
    const first = await manager.start('workspace', fixture.options);
    const originalSessionPath = first.getLastSessionState().sessionFile;
    assert.equal(originalSessionPath, fixture.options.sessionPath);
    await assert.rejects(
      first.request({ type: 'test_crash' }),
      (error) => error.code === 'PROCESS_EXITED' && error.message.includes('fixture crash diagnostic')
    );
    assert.equal(manager.get('workspace'), undefined);
    assert.equal(manager.getHealth('workspace').health, 'unavailable');

    const [second, sameSecond] = await Promise.all([
      manager.ensureReady('workspace'),
      manager.ensureReady('workspace'),
    ]);
    assert.equal(second, sameSecond);
    assert.notEqual(second, first);
    assert.equal(second.getLastSessionState().sessionFile, originalSessionPath);
    assert.equal(manager.getHealth('workspace').health, 'healthy');
  } finally {
    await manager.stopAll();
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test('restart circuit opens after the configured number of recoveries', async () => {
  const fixture = await createFixture();
  const manager = new AgentProcessManager({
    restartPolicy: { mode: 'on-demand', maxRestarts: 1, windowMs: 60_000 },
  });
  try {
    const first = await manager.start('workspace', fixture.options);
    await assert.rejects(first.request({ type: 'test_crash' }));
    const second = await manager.ensureReady('workspace');
    await assert.rejects(second.request({ type: 'test_crash' }));
    await assert.rejects(manager.ensureReady('workspace'), (error) => error.code === 'RESTART_CIRCUIT_OPEN');
    assert.equal(manager.getHealth('workspace').health, 'circuit-open');
  } finally {
    await manager.stopAll();
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test('manager shutdown gate prevents process resurrection', async () => {
  const fixture = await createFixture();
  const manager = new AgentProcessManager();
  try {
    await manager.start('workspace', fixture.options);
    await manager.stopAll();
    await assert.rejects(
      manager.ensureReady('workspace', fixture.options),
      (error) => error.code === 'MANAGER_SHUTTING_DOWN'
    );
  } finally {
    await manager.stopAll();
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test('stop aborts active generation and observes agent_settled before termination', async () => {
  const fixture = await createFixture();
  const process = new AgentRpcProcess({ ...fixture.options, settleTimeoutMs: 500 });
  const events = [];
  process.onEvent((event) => events.push(event.type));
  try {
    await process.start();
    await process.execute({ type: 'test_begin' });
    await process.stop();
    assert.equal(process.getState(), 'stopped');
    assert.ok(events.includes('agent_settled'));
  } finally {
    await process.stop();
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test('parallel RPC children isolate overrides and inherit the parent environment', async () => {
  const fixture = await createFixture();
  const original = process.env.OCTOPUS_TEST_PARENT_VALUE;
  const originalChild = process.env.OCTOPUS_TEST_CHILD_VALUE;
  process.env.OCTOPUS_TEST_PARENT_VALUE = 'inherited';
  const children = ['first', 'second'].map(
    (value) =>
      new AgentRpcProcess({
        ...fixture.options,
        childEnvironment: { OCTOPUS_TEST_CHILD_VALUE: value },
      })
  );
  try {
    await Promise.all(children.map((child) => child.start()));
    const results = await Promise.all(children.map((child) => child.execute({ type: 'test_environment' })));
    assert.deepEqual(
      results.map((result) => result.data),
      [
        { value: 'first', inherited: 'inherited' },
        { value: 'second', inherited: 'inherited' },
      ]
    );
    assert.equal(process.env.OCTOPUS_TEST_CHILD_VALUE, originalChild);
    assert.equal(process.env.OCTOPUS_TEST_PARENT_VALUE, 'inherited');
  } finally {
    await Promise.all(children.map((child) => child.stop()));
    if (original === undefined) delete process.env.OCTOPUS_TEST_PARENT_VALUE;
    else process.env.OCTOPUS_TEST_PARENT_VALUE = original;
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test('RPC rejects invalid environment overrides before starting a child', async () => {
  const fixture = await createFixture();
  try {
    for (const childEnvironment of [
      { NODE_OPTIONS: '--require=bad' },
      { PATH: 'bad' },
      { DR_OCTOPUS_CODING_AGENT_DIR: 'bad' },
      { 'INVALID=KEY': 'bad' },
      { OCTOPUS_TEST_CHILD_VALUE: 'bad\0value' },
      { OCTOPUS_TEST_CHILD_VALUE: 'x'.repeat(8193) },
    ]) {
      const child = new AgentRpcProcess({ ...fixture.options, childEnvironment });
      await assert.rejects(child.start(), (error) => error.code === 'PROCESS_START_FAILED');
      assert.equal(child.getState(), 'idle');
    }
  } finally {
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});
