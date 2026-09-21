/**
 * @author Codex
 * @description Verifies real Pi RPC readiness and grant identity across isolated process generations.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { AgentRpcProcess } from '../dist/rpc/rpc-process.js';
import { openGrantRepository } from '../dist/extensions/permission-system/sdk/index.js';
import { permissionEvidence } from '../dist/extensions/scheduler/infrastructure/permission-evidence.js';

test(
  'real Pi exposes readiness entries before a prompt and a new process loads the persisted grant',
  { timeout: 60_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'permission-rpc-'));
    const agentDir = join(root, 'agent');
    await mkdir(agentDir);
    await writeFile(
      join(agentDir, 'settings.json'),
      JSON.stringify({ packages: [], checkForUpdates: false })
    );
    const grants = openGrantRepository(agentDir);
    const binding = {
      profileId: 'profile',
      subjectId: 'task',
      workspaceId: 'workspace',
      executionDigest: 'c'.repeat(64),
    };
    /**
     * Start and inspect one real Pi process without loading the user's normal settings or invoking a model.
     */
    async function inspect(ref) {
      const sessionId = randomUUID();
      const attemptId = randomUUID();
      const process = new AgentRpcProcess({
        workspace: { id: 'workspace', cwd: root },
        agentDir,
        sessionId,
        sessionDir: join(root, 'sessions', sessionId),
        entryPath: fileURLToPath(new URL('./fixtures/permission-rpc.mjs', import.meta.url)),
        childEnvironment: {
          DR_OCTOPUS_PROCESS_ROLE: ref === null ? 'task-tool-inspection' : 'scheduled-task',
          DR_OCTOPUS_PERMISSION_EXECUTION: JSON.stringify({
            ...binding,
            sessionId,
            attemptId,
            cwd: root,
            ref,
            inspect: ref === null,
          }),
          TEST_EFFECT_FILE: join(root, 'effects'),
        },
      });
      try {
        await process.start();
        const response = await process.execute({ type: 'get_entries' });
        assert.equal(response.command, 'get_entries');
        const evidence = permissionEvidence(response.data.entries, sessionId, attemptId);
        const active = response.data.entries.find(
          (entry) => entry.type === 'custom' && entry.customType === 'fixture-active-tools'
        );
        return { ...evidence, activeTools: active?.data.names };
      } finally {
        await process.stop();
      }
    }
    try {
      const preview = await inspect(null);
      assert.equal(preview?.ready, true);
      const tool = preview.tools.find((tool) => tool.name === 'test_ping');
      assert.ok(tool);
      assert.deepEqual(preview.activeTools, []);
      assert.ok(preview.tools.some((entry) => entry.name === 'ctx_execute'));
      assert.ok(!preview.tools.some((entry) => entry.name === 'scheduler_create'));
      const grant = grants.approve(binding, [tool], 'approve');
      const ref = { grantId: grant.id, grantRevision: 1, executionDigest: binding.executionDigest };
      const execution = await inspect(ref);
      assert.equal(execution.ready, true);
      assert.deepEqual(execution.activeTools, ['test_ping']);
      const ctxTools = preview.tools.filter((entry) => entry.name.startsWith('ctx_'));
      assert.equal(ctxTools.length, 3);
      assert.ok(!preview.tools.some((entry) => entry.name === 'ctx_upgrade'));
      const ctxGrant = grants.approve(binding, ctxTools, 'approve-context');
      const ctxExecution = await inspect({
        grantId: ctxGrant.id,
        grantRevision: 1,
        executionDigest: binding.executionDigest,
      });
      assert.equal(ctxExecution.ready, true);
      assert.deepEqual(
        ctxExecution.activeTools,
        ctxTools.map((tool) => tool.name)
      );
      grants.revoke(grant.id, 1);
      const revoked = await inspect(ref);
      assert.equal(revoked?.ready, false);
      assert.equal(revoked?.code, 'SCHEDULE_AUTHORIZATION_REVOKED');
    } finally {
      grants.close();
      await rm(root, { recursive: true, force: true });
    }
  }
);
