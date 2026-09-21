/**
 * @author Codex
 * @description 验证 Server 直接消费 @octopus/agent/rpc 的真实进程管理公共入口
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { AgentProcessManager } from '@octopus/agent/rpc';

const fixturePath = fileURLToPath(new URL('./fixtures/mock-rpc-entry.mjs', import.meta.url));

test('AgentProcessManager starts, requests and stops an isolated RPC process', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'dr-octopus-agent-'));
  const manager = new AgentProcessManager();
  const timestamp = new Date(0).toISOString();
  const descriptor = {
    schemaVersion: 1,
    id: 'test-workspace',
    kind: 'project',
    name: 'Test Workspace',
    slug: 'test-workspace',
    cwd: workspace,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  try {
    const agent = await manager.start('workspace', {
      workspace: descriptor,
      entryPath: fixturePath,
      requestTimeoutMs: 2_000,
    });

    const response = await agent.request({ type: 'get_state' });
    assert.equal(response.success, true);
    assert.equal(manager.get('workspace'), agent);

    await assert.rejects(
      manager.start('workspace', {
        workspace: descriptor,
        entryPath: fixturePath,
      }),
      /already exists/u
    );
  } finally {
    await manager.stopAll();
    await rm(workspace, { recursive: true, force: true });
  }
});
