/**
 * @author Codex
 * @description Verifies per-call revocation, mandatory policy and path boundaries with real grant storage.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createPermissionModeService,
  openGrantRepository,
} from '../dist/extensions/permission-system/sdk/index.js';
import {
  registerUnattendedExecution,
  capability,
} from '../dist/extensions/permission-system/extension/unattended.js';
import { checkUnattendedPath } from '../dist/extensions/permission-system/lib/unattended-path.js';

test('every call observes revocation; full mode and global allow cannot enlarge a grant', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unattended-gate-'));
  const agentDir = join(root, 'agent');
  await mkdir(agentDir);
  const previousDir = process.env.DR_OCTOPUS_CODING_AGENT_DIR;
  const previousContext = process.env.DR_OCTOPUS_PERMISSION_EXECUTION;
  const repository = openGrantRepository(agentDir);
  const tool = {
    name: 'test_ping',
    description: 'Ping',
    parameters: { type: 'object' },
    sourceInfo: { source: 'test', path: 'test', scope: 'user', origin: 'top-level' },
  };
  const binding = {
    profileId: 'profile',
    subjectId: 'task',
    workspaceId: 'workspace',
    executionDigest: 'a'.repeat(64),
  };
  const contextTools = ['ctx_execute', 'ctx_execute_file', 'ctx_batch_execute', 'ctx_upgrade'].map(
    (name) => ({ ...tool, name })
  );
  const grantableContextTools = contextTools.filter((tool) => tool.name !== 'ctx_upgrade');
  const grant = repository.approve(
    binding,
    [tool, ...grantableContextTools].map(capability),
    'user-approved'
  );
  process.env.DR_OCTOPUS_CODING_AGENT_DIR = agentDir;
  process.env.DR_OCTOPUS_PERMISSION_EXECUTION = JSON.stringify({
    ...binding,
    ref: { grantId: grant.id, grantRevision: 1, executionDigest: binding.executionDigest },
    sessionId: 'session',
    attemptId: 'attempt',
    cwd: root,
    inspect: false,
  });
  const handlers = new Map();
  const evidence = [];
  const service = createPermissionModeService({ agentDir });
  const ctx = { cwd: root, sessionManager: { getSessionId: () => 'session' }, isProjectTrusted: () => false };
  let activeTools = [];
  const pi = {
    setActiveTools: (names) => {
      activeTools = names;
    },
    on: (name, handler) => handlers.set(name, handler),
    getAllTools: () => [
      tool,
      ...contextTools,
      { ...tool, name: 'ungranted' },
      { ...tool, name: 'scheduler_create' },
    ],
    appendEntry: (_type, data) => evidence.push(data),
  };
  try {
    const gate = registerUnattendedExecution(pi, service);
    await handlers.get('session_start')({}, ctx);
    assert.deepEqual(activeTools, ['test_ping', 'ctx_execute', 'ctx_execute_file', 'ctx_batch_execute']);
    activeTools.push('ungranted', 'scheduler_create');
    const prompt = handlers.get('before_agent_start')({ systemPrompt: 'Use ctx tools when available.' }, ctx);
    assert.match(prompt.systemPrompt, /Only these tools are authorized/);
    assert.ok(!activeTools.includes('ungranted'));
    for (const tool of grantableContextTools) {
      gate.check({ toolName: tool.name, kind: 'custom', sensitive: false, external: false }, ctx);
    }
    activeTools.push('ungranted');
    handlers.get('turn_end')({}, ctx);
    assert.ok(!activeTools.includes('ungranted'));
    const request = { toolName: 'test_ping', kind: 'custom', sensitive: false, external: false };
    gate.check(request, ctx);
    service.setMode('full');
    await writeFile(
      join(agentDir, 'permission-system.json'),
      JSON.stringify({ policy: { tools: { ungranted: 'allow' } } })
    );
    assert.throws(() => gate.check({ ...request, toolName: 'ungranted' }, ctx), {
      code: 'SCHEDULE_PERMISSION_DENIED',
    });
    assert.deepEqual(activeTools, []);
    await handlers.get('session_start')({}, ctx);
    await writeFile(
      join(agentDir, 'permission-system.json'),
      JSON.stringify({ policy: { tools: { test_ping: 'deny' } } })
    );
    assert.throws(() => gate.check(request, ctx), { code: 'SCHEDULE_PERMISSION_DENIED' });
    await writeFile(join(agentDir, 'permission-system.json'), '{}');
    await handlers.get('session_start')({}, ctx);
    gate.check(request, ctx);
    await writeFile(
      join(agentDir, 'permission-system.json'),
      JSON.stringify({ policy: { tools: { ctx_execute: 'ask' } } })
    );
    handlers.get('turn_end')({}, ctx);
    assert.ok(!activeTools.includes('ctx_execute'));
    await writeFile(join(agentDir, 'permission-system.json'), '{}');
    repository.revoke(grant.id, 1);
    assert.throws(() => gate.check(request, ctx), { code: 'SCHEDULE_AUTHORIZATION_REVOKED' });
    assert.equal(evidence.at(-1).code, 'SCHEDULE_AUTHORIZATION_REVOKED');
    assert.deepEqual(activeTools, []);
    handlers.get('session_shutdown')();
    const emptyGrant = repository.approve(binding, [], 'empty-grant');
    process.env.DR_OCTOPUS_PERMISSION_EXECUTION = JSON.stringify({
      ...JSON.parse(process.env.DR_OCTOPUS_PERMISSION_EXECUTION),
      ref: { grantId: emptyGrant.id, grantRevision: 1, executionDigest: binding.executionDigest },
    });
    registerUnattendedExecution(pi, service);
    await handlers.get('session_start')({}, ctx);
    assert.deepEqual(activeTools, []);
  } finally {
    handlers.get('session_shutdown')();
    repository.close();
    if (previousDir === undefined) delete process.env.DR_OCTOPUS_CODING_AGENT_DIR;
    else process.env.DR_OCTOPUS_CODING_AGENT_DIR = previousDir;
    if (previousContext === undefined) delete process.env.DR_OCTOPUS_PERMISSION_EXECUTION;
    else process.env.DR_OCTOPUS_PERMISSION_EXECUTION = previousContext;
    await rm(root, { recursive: true, force: true });
  }
});

test('self-modifying tools stay ineligible even when a grant contains them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unattended-self-modifying-'));
  const agentDir = join(root, 'agent');
  await mkdir(agentDir);
  const previousDir = process.env.DR_OCTOPUS_CODING_AGENT_DIR;
  const previousContext = process.env.DR_OCTOPUS_PERMISSION_EXECUTION;
  const repository = openGrantRepository(agentDir);
  const tool = {
    name: 'test_ping',
    description: 'Ping',
    parameters: { type: 'object' },
    sourceInfo: { source: 'test', path: 'test', scope: 'user', origin: 'top-level' },
  };
  const upgrade = { ...tool, name: 'ctx_upgrade' };
  const binding = {
    profileId: 'profile',
    subjectId: 'task',
    workspaceId: 'workspace',
    executionDigest: 'b'.repeat(64),
  };
  const staleGrant = repository.approve(binding, [tool, upgrade].map(capability), 'approve-upgrade');
  process.env.DR_OCTOPUS_CODING_AGENT_DIR = agentDir;
  process.env.DR_OCTOPUS_PERMISSION_EXECUTION = JSON.stringify({
    ...binding,
    ref: { grantId: staleGrant.id, grantRevision: 1, executionDigest: binding.executionDigest },
    sessionId: 'session',
    attemptId: 'attempt',
    cwd: root,
    inspect: false,
  });
  const handlers = new Map();
  const evidence = [];
  const service = createPermissionModeService({ agentDir });
  const ctx = { cwd: root, sessionManager: { getSessionId: () => 'session' }, isProjectTrusted: () => false };
  let activeTools = ['sentinel'];
  const pi = {
    setActiveTools: (names) => {
      activeTools = names;
    },
    on: (name, handler) => handlers.set(name, handler),
    getAllTools: () => [tool, upgrade],
    appendEntry: (_type, data) => evidence.push(data),
  };
  try {
    registerUnattendedExecution(pi, service);
    assert.throws(() => handlers.get('session_start')({}, ctx), {
      code: 'SCHEDULE_AUTHORIZATION_STALE',
    });
    assert.equal(evidence.at(-1).ready, false);
    assert.equal(evidence.at(-1).code, 'SCHEDULE_AUTHORIZATION_STALE');
    assert.deepEqual(activeTools, []);
    handlers.get('session_shutdown')();
    process.env.DR_OCTOPUS_PERMISSION_EXECUTION = JSON.stringify({
      ...binding,
      sessionId: 'session',
      attemptId: 'attempt',
      cwd: root,
      inspect: true,
    });
    registerUnattendedExecution(pi, service);
    handlers.get('session_start')({}, ctx);
    assert.equal(evidence.at(-1).ready, true);
    assert.deepEqual(
      evidence.at(-1).tools.map((entry) => entry.name),
      ['test_ping']
    );
  } finally {
    handlers.get('session_shutdown')?.();
    repository.close();
    if (previousDir === undefined) delete process.env.DR_OCTOPUS_CODING_AGENT_DIR;
    else process.env.DR_OCTOPUS_CODING_AGENT_DIR = previousDir;
    if (previousContext === undefined) delete process.env.DR_OCTOPUS_PERMISSION_EXECUTION;
    else process.env.DR_OCTOPUS_PERMISSION_EXECUTION = previousContext;
    await rm(root, { recursive: true, force: true });
  }
});

test('junctions and new files under linked parents cannot escape an unattended workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unattended-path-'));
  const workspace = join(root, 'workspace');
  const outside = join(root, 'outside');
  await mkdir(workspace);
  await mkdir(outside);
  try {
    await symlink(outside, join(workspace, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => checkUnattendedPath(workspace, { path: 'linked/new-file.txt' }), {
      code: 'SCHEDULE_PERMISSION_DENIED',
    });
    assert.throws(() => checkUnattendedPath(workspace, { path: '.env' }), {
      code: 'SCHEDULE_PERMISSION_DENIED',
    });
    checkUnattendedPath(workspace, { path: 'new-directory/result.txt' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('inspection includes every eligible registered tool and explains deny and ask', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tool-catalog-'));
  const prior = process.env.DR_OCTOPUS_PERMISSION_EXECUTION;
  const handlers = new Map();
  const evidence = [];
  const tools = Array.from({ length: 150 }, (_, i) => ({
    name: `tool_${i}`,
    description: 'Tool',
    parameters: { type: 'object' },
    sourceInfo: { source: 'npm:example', path: 'index.ts', scope: 'user', origin: 'package' },
  }));
  const contextNames = ['ctx_execute', 'ctx_execute_file', 'ctx_batch_execute', 'ctx_upgrade'];
  tools.push(...contextNames.map((name) => ({ ...tools[0], name })));
  tools.push(
    ...['scheduler_create', 'permission_allow', 'subagent', 'ask_user', 'plan_mode', 'user_bash'].map(
      (name) => ({ ...tools[0], name })
    )
  );
  process.env.DR_OCTOPUS_PERMISSION_EXECUTION = JSON.stringify({
    sessionId: 'session',
    attemptId: 'attempt',
    profileId: 'profile',
    cwd: root,
    inspect: true,
  });
  try {
    await writeFile(
      join(root, 'permission-system.json'),
      JSON.stringify({ policy: { tools: { tool_0: 'deny', tool_1: 'ask' } } })
    );
    const service = createPermissionModeService({ agentDir: root });
    registerUnattendedExecution(
      {
        on: (name, handler) => handlers.set(name, handler),
        getAllTools: () => tools,
        setActiveTools: (names) => assert.deepEqual(names, []),
        appendEntry: (_type, data) => evidence.push(data),
      },
      service
    );
    await handlers.get('session_start')(
      {},
      { cwd: root, isProjectTrusted: () => false, sessionManager: { getSessionId: () => 'session' } }
    );
    const catalog = evidence.at(-1).tools;
    assert.equal(catalog.length, 153);
    assert.deepEqual(
      catalog.slice(150).map((tool) => tool.name),
      ['ctx_execute', 'ctx_execute_file', 'ctx_batch_execute']
    );
    assert.ok(!catalog.some((tool) => tool.name === 'ctx_upgrade'));
    assert.ok(!catalog.some((tool) => tool.name === 'scheduler_create'));
    assert.match(catalog[0].unavailableReason, /deny/);
    assert.match(catalog[1].unavailableReason, /ask/);
    assert.equal(catalog[149].unavailableReason, null);
    assert.equal(catalog[0].source, 'npm:example');
  } finally {
    handlers.get('session_shutdown')?.();
    if (prior === undefined) delete process.env.DR_OCTOPUS_PERMISSION_EXECUTION;
    else process.env.DR_OCTOPUS_PERMISSION_EXECUTION = prior;
    await rm(root, { recursive: true, force: true });
  }
});

test('task process roles reject missing authorization context instead of using interactive permissions', () => {
  const previousRole = process.env.DR_OCTOPUS_PROCESS_ROLE;
  const previousContext = process.env.DR_OCTOPUS_PERMISSION_EXECUTION;
  delete process.env.DR_OCTOPUS_PERMISSION_EXECUTION;
  try {
    delete process.env.DR_OCTOPUS_PROCESS_ROLE;
    assert.equal(registerUnattendedExecution({}, {}), undefined);
    for (const role of ['scheduled-task', 'task-tool-inspection']) {
      process.env.DR_OCTOPUS_PROCESS_ROLE = role;
      const handlers = new Map();
      const evidence = [];
      const gate = registerUnattendedExecution(
        {
          on: (name, handler) => handlers.set(name, handler),
          setActiveTools: (names) => assert.deepEqual(names, []),
          appendEntry: (_type, data) => evidence.push(data),
        },
        {}
      );
      assert.ok(gate);
      assert.throws(
        () =>
          handlers.get('session_start')(
            {},
            {
              cwd: tmpdir(),
              sessionManager: { getSessionId: () => 'session' },
            }
          ),
        { code: 'SCHEDULE_AUTHORIZATION_STALE' }
      );
      assert.equal(evidence.at(-1).ready, false);
      handlers.get('session_shutdown')();
    }
  } finally {
    if (previousRole === undefined) delete process.env.DR_OCTOPUS_PROCESS_ROLE;
    else process.env.DR_OCTOPUS_PROCESS_ROLE = previousRole;
    if (previousContext === undefined) delete process.env.DR_OCTOPUS_PERMISSION_EXECUTION;
    else process.env.DR_OCTOPUS_PERMISSION_EXECUTION = previousContext;
  }
});
