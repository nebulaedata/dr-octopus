/**
 * @author Codex
 * @description Verifies permission mode policy semantics and the built-in Pi extension registration contract.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createPermissionModeService,
  createPermissionSystemExtension,
} from '../dist/extensions/permission-system/index.js';

/**
 * Creates a service whose global policy path is isolated from the real user profile.
 *
 * @returns Runtime-local permission service with product defaults.
 */
function createTestService() {
  return createPermissionModeService({
    agentDir: join(tmpdir(), 'octopus-permission-test-no-config'),
  });
}

const CONTEXT_MODE_SHELL_TOOLS = ['ctx_batch_execute', 'ctx_execute', 'ctx_execute_file'];

test('background start requires bash permission while bounded observations remain readable', async () => {
  const service = createTestService();
  const events = new Map();
  createPermissionSystemExtension(service)({
    registerCommand() {},
    registerTool() {},
    on(name, handler) {
      events.set(name, handler);
    },
  });
  const ctx = { cwd: '/workspace', isProjectTrusted: () => false, hasUI: false };
  const authorize = (input) =>
    events.get('tool_call')(
      { type: 'tool_call', toolCallId: 'background', toolName: 'background_task', input },
      ctx
    );
  assert.equal((await authorize({ action: 'start', command: 'echo hello' })).block, true);
  assert.deepEqual(await authorize({ action: 'list' }), {});
  service.setMode('auto');
  assert.deepEqual(await authorize({ action: 'start', command: 'echo hello' }), {});
  assert.equal((await authorize({ action: 'start', command: 'sudo anything' })).block, true);
});
const CONTEXT_MODE_AUTO_TOOLS = [
  ...CONTEXT_MODE_SHELL_TOOLS,
  'ctx_doctor',
  'ctx_fetch_and_index',
  'ctx_index',
  'ctx_insight',
  'ctx_purge',
  'ctx_search',
  'ctx_stats',
  'ctx_upgrade',
];

test('permission mode remains runtime-local and preserves hard safety boundaries', () => {
  const service = createTestService();
  assert.deepEqual(service.getState(), {
    mode: 'ask',
    scope: 'runtime-generation',
    persisted: false,
  });
  assert.equal(
    service.decide({ toolName: 'read', kind: 'read', external: false, sensitive: false }),
    'allow'
  );
  assert.equal(
    service.decide({ toolName: 'write', kind: 'write', external: false, sensitive: false }),
    'ask'
  );
  assert.equal(
    service.decide({
      toolName: 'permission_audit_query',
      kind: 'custom',
      external: false,
      sensitive: false,
    }),
    'allow'
  );

  service.setMode('auto');
  assert.equal(
    service.decide({ toolName: 'write', kind: 'write', external: false, sensitive: false }),
    'allow'
  );
  for (const toolName of ['bash', 'powershell', 'user_bash']) {
    assert.equal(service.decide({ toolName, kind: 'shell', external: false, sensitive: false }), 'allow');
    assert.equal(service.decide({ toolName, kind: 'shell', external: true, sensitive: false }), 'ask');
  }
  assert.equal(
    service.decide({
      toolName: 'ask_user_question',
      kind: 'custom',
      external: false,
      sensitive: false,
    }),
    'allow'
  );
  assert.equal(
    service.decide({
      toolName: 'plan_mode_question',
      kind: 'custom',
      external: false,
      sensitive: false,
    }),
    'allow'
  );
  assert.equal(
    service.decide({
      toolName: 'plan_mode_complete',
      kind: 'custom',
      external: false,
      sensitive: false,
    }),
    'allow'
  );
  assert.equal(
    service.decide({
      toolName: 'subagent',
      kind: 'custom',
      external: false,
      sensitive: false,
    }),
    'allow'
  );
  assert.equal(
    service.decide({
      toolName: 'bg_wait',
      kind: 'custom',
      external: false,
      sensitive: false,
    }),
    'allow'
  );
  for (const toolName of CONTEXT_MODE_AUTO_TOOLS) {
    const kind = service.getConfiguration().toolRules[toolName].kind;
    assert.equal(
      service.decide({ toolName, kind, external: false, sensitive: false }),
      'allow',
      `${toolName} should be auto-approved by exact name`
    );
  }
  assert.equal(
    service.decide({
      toolName: 'ctx_future_tool',
      kind: 'custom',
      external: false,
      sensitive: false,
    }),
    'ask'
  );
  assert.equal(
    service.decide({
      toolName: 'ctx_execute_file',
      kind: 'shell',
      external: true,
      sensitive: false,
    }),
    'ask'
  );
  assert.equal(
    service.decide({
      toolName: 'ctx_execute_file',
      kind: 'shell',
      external: false,
      sensitive: true,
    }),
    'deny'
  );

  service.setMode('full');
  assert.equal(
    service.decide({ toolName: 'custom', kind: 'custom', external: true, sensitive: false }),
    'allow'
  );
  assert.equal(
    service.decide({ toolName: 'write', kind: 'write', external: false, sensitive: true }),
    'deny'
  );
});

test('permission policy merges global and trusted project exact-tool rules', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'octopus-permission-policy-'));
  const agentDir = join(temporaryRoot, 'agent');
  const workspaceDir = join(temporaryRoot, 'workspace');
  const projectConfigDir = join(workspaceDir, '.pi');
  await mkdir(agentDir, { recursive: true });
  await mkdir(projectConfigDir, { recursive: true });
  await writeFile(
    join(agentDir, 'permission-system.json'),
    JSON.stringify({
      permissionReviewLog: false,
      reviewLogFieldMaxWidth: 25,
      policy: { tools: { blocked_tool: 'deny', read: 'ask' } },
      modes: { auto: { tools: { custom_safe_tool: 'allow' } } },
    }),
    'utf8'
  );
  await writeFile(
    join(projectConfigDir, 'permission-system.json'),
    JSON.stringify({
      permissionReviewLog: true,
      reviewLogFieldMaxWidth: 50,
      modes: { auto: { tools: { ask_user_question: 'ask' } } },
    }),
    'utf8'
  );

  try {
    const service = createPermissionModeService({
      agentDir,
      cwd: workspaceDir,
      configDirName: '.pi',
    });
    service.setMode('auto');
    assert.equal(
      service.decide({
        toolName: 'custom_safe_tool',
        kind: 'custom',
        external: false,
        sensitive: false,
      }),
      'allow'
    );
    assert.equal(
      service.decide({
        toolName: 'blocked_tool',
        kind: 'custom',
        external: false,
        sensitive: false,
      }),
      'deny'
    );
    assert.equal(
      service.decide({
        toolName: 'read',
        kind: 'read',
        external: false,
        sensitive: false,
      }),
      'ask'
    );

    const result = service.reloadPolicy(workspaceDir, true);
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.audit, {
      permissionReviewLog: true,
      reviewLogFieldMaxWidth: 50,
    });
    assert.equal(
      service.decide({
        toolName: 'ask_user_question',
        kind: 'custom',
        external: false,
        sensitive: false,
      }),
      'ask'
    );
    assert.equal(
      service.decide({
        toolName: 'custom_safe_tool',
        kind: 'custom',
        external: true,
        sensitive: false,
      }),
      'ask'
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('invalid permission config rejects startup instead of dropping restrictions', async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), 'octopus-permission-invalid-'));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  await writeFile(
    join(agentDir, 'permission-system.json'),
    JSON.stringify({ modes: { auto: { tools: { ask_user_question: 'sometimes' } } } })
  );
  assert.throws(() => createPermissionModeService({ agentDir }), { code: 'PERMISSION_CONFIG_INVALID' });
});

test('permission extension registers one fallback command and both execution gates', () => {
  const commands = new Map();
  const tools = new Map();
  const events = new Map();
  const pi = {
    registerCommand(name, options) {
      commands.set(name, options);
    },
    registerTool(definition) {
      tools.set(definition.name, definition);
    },
    on(name, handler) {
      events.set(name, handler);
    },
  };

  createPermissionSystemExtension(createTestService())(pi);

  assert.deepEqual([...commands.keys()], ['permission-mode']);
  assert.deepEqual([...tools.keys()], ['permission_audit_query']);
  assert.deepEqual([...events.keys()], ['session_start', 'tool_call', 'session_shutdown', 'user_bash']);
});

test('permission-mode command changes the service used by execution gates', async () => {
  const service = createTestService();
  const commands = new Map();
  const notifications = [];
  const pi = {
    registerCommand(name, options) {
      commands.set(name, options);
    },
    registerTool() {},
    on() {},
  };
  createPermissionSystemExtension(service)(pi);

  await commands.get('permission-mode').handler('auto', {
    ui: {
      notify(message, level) {
        notifications.push({ message, level });
      },
    },
  });

  assert.equal(service.getState().mode, 'auto');
  assert.deepEqual(notifications, [{ message: 'Permission mode: auto', level: 'info' }]);
});

test('tool gate exposes four decisions and keeps sensitive paths denied in full mode', async () => {
  const service = createTestService();
  const events = new Map();
  const pi = {
    registerCommand() {},
    registerTool() {},
    on(name, handler) {
      events.set(name, handler);
    },
  };
  createPermissionSystemExtension(service)(pi);
  let prompts = 0;
  let promptOptions;
  const ctx = {
    cwd: '/workspace',
    isProjectTrusted: () => false,
    hasUI: true,
    ui: {
      select: async (_title, options) => {
        prompts += 1;
        promptOptions = options;
        return 'No';
      },
      input: async () => undefined,
    },
  };
  const authorizeTool = events.get('tool_call');

  assert.deepEqual(
    await authorizeTool(
      { type: 'tool_call', toolCallId: 'write-a', toolName: 'write', input: { path: 'src/a.ts' } },
      ctx
    ),
    { block: true, reason: 'Blocked by the Octopus permission policy.' }
  );
  assert.equal(prompts, 1);
  assert.equal(promptOptions.length, 4);
  assert.match(promptOptions[1], /allow.*write.*directory.*src.*for this session/u);

  service.setMode('auto');
  assert.deepEqual(
    await authorizeTool(
      {
        type: 'tool_call',
        toolCallId: 'question-a',
        toolName: 'ask_user_question',
        input: { questions: [] },
      },
      ctx
    ),
    {}
  );
  assert.deepEqual(
    await authorizeTool(
      {
        type: 'tool_call',
        toolCallId: 'plan-question-a',
        toolName: 'plan_mode_question',
        input: { questions: [] },
      },
      ctx
    ),
    {}
  );
  assert.deepEqual(
    await authorizeTool(
      {
        type: 'tool_call',
        toolCallId: 'plan-complete-a',
        toolName: 'plan_mode_complete',
        input: { plan: '# Plan' },
      },
      ctx
    ),
    {}
  );
  assert.deepEqual(
    await authorizeTool(
      {
        type: 'tool_call',
        toolCallId: 'subagent-a',
        toolName: 'subagent',
        input: { agent: 'explorer', task: 'Inspect the permission flow' },
      },
      ctx
    ),
    {}
  );
  assert.deepEqual(
    await authorizeTool(
      {
        type: 'tool_call',
        toolCallId: 'bg-wait-a',
        toolName: 'bg_wait',
        input: { timeoutMs: 60000 },
      },
      ctx
    ),
    {}
  );
  assert.equal(prompts, 1);

  service.setMode('full');
  assert.deepEqual(
    await authorizeTool(
      { type: 'tool_call', toolCallId: 'write-b', toolName: 'write', input: { path: 'src/a.ts' } },
      ctx
    ),
    {}
  );
  assert.deepEqual(
    await authorizeTool(
      { type: 'tool_call', toolCallId: 'write-c', toolName: 'write', input: { path: '.env' } },
      ctx
    ),
    { block: true, reason: 'Blocked by the Octopus permission policy.' }
  );
  assert.equal(prompts, 1);
});

test('session approval skips matching prompts until session shutdown', async () => {
  const service = createTestService();
  const events = new Map();
  const pi = {
    registerCommand() {},
    registerTool() {},
    on(name, handler) {
      events.set(name, handler);
    },
  };
  createPermissionSystemExtension(service)(pi);
  let prompts = 0;
  const ctx = {
    cwd: '/workspace',
    isProjectTrusted: () => false,
    hasUI: true,
    ui: {
      select: async (_title, options) => {
        prompts += 1;
        return options[1];
      },
      input: async () => undefined,
    },
  };
  const authorizeTool = events.get('tool_call');
  const write = (id, filePath) =>
    authorizeTool({ type: 'tool_call', toolCallId: id, toolName: 'write', input: { path: filePath } }, ctx);

  assert.deepEqual(await write('write-a', 'src/a.ts'), {});
  assert.deepEqual(await write('write-b', 'src/b.ts'), {});
  assert.equal(prompts, 1);

  await events.get('session_shutdown')({}, ctx);
  assert.deepEqual(await write('write-c', 'src/c.ts'), {});
  assert.equal(prompts, 2);
});

test('denial reason is returned to the invoking agent', async () => {
  const events = new Map();
  const pi = {
    registerCommand() {},
    registerTool() {},
    on(name, handler) {
      events.set(name, handler);
    },
  };
  createPermissionSystemExtension(createTestService())(pi);
  const ctx = {
    cwd: '/workspace',
    isProjectTrusted: () => false,
    hasUI: true,
    ui: {
      select: async () => 'No, provide reason',
      input: async () => 'Use the generated directory instead',
    },
  };

  assert.deepEqual(
    await events.get('tool_call')(
      { type: 'tool_call', toolCallId: 'write-a', toolName: 'write', input: { path: 'src/a.ts' } },
      ctx
    ),
    {
      block: true,
      reason: 'Blocked by the Octopus permission policy: Use the generated directory instead',
    }
  );
});
