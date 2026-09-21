/**
 * @author Codex
 * @description Verifies Scheduler Pi registration, request identity, native errors, lifecycle.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';
import { createSchedulerExtension } from '../dist/extensions/scheduler/index.js';

const clientOptions = {
  agentDir: tmpdir(),
  workspaceId: 'workspace',
  cwd: tmpdir(),
  configRevision: 'revision',
  autoEnsure: false,
};

test('extension registers Scheduler tools, captures Session identity and closes on replacement', async () => {
  const tools = new Map();
  const commands = new Map();
  const events = new Map();
  const renderers = new Map();
  const requests = [];
  const callers = [];
  const settingsUpdates = [];
  let closed = false;
  const pi = {
    registerTool: (tool) => tools.set(tool.name, tool),
    registerCommand: (name, command) => commands.set(name, command),
    registerMessageRenderer: (name, renderer) => renderers.set(name, renderer),
    on: (name, fn) => events.set(name, fn),
  };
  createSchedulerExtension()(pi);
  assert.equal(tools.size, 0);
  createSchedulerExtension(clientOptions, () => ({
    async request(request, caller) {
      if (closed) throw new Error('SCHEDULE_REQUEST_CANCELLED_OR_TIMED_OUT');
      requests.push(request);
      callers.push(caller);
      return { outcome: 'applied' };
    },
    async getSettings() {
      return {
        timezone: 'Asia/Shanghai',
        maxConcurrentRuns: 3,
        revision: 1,
        updatedAt: '2026-09-06T00:00:00.000Z',
      };
    },
    async updateSettings(input) {
      settingsUpdates.push(input);
      return { ...input, revision: input.revision + 1, updatedAt: '2026-09-06T00:01:00.000Z' };
    },
    close() {
      closed = true;
    },
  }))(pi);
  assert.equal(tools.size, 8);
  assert.ok(commands.has('scheduler'));
  assert.ok(renderers.has('octopus-scheduler-completion'));
  for (const tool of tools.values()) assert.equal(tool.parameters.additionalProperties, false);
  const signal = new AbortController().signal;
  const result = await tools
    .get('scheduler_update')
    .execute('call-id', { taskId: 'task', revision: 2, patch: { enabled: false } }, signal, undefined, {
      sessionManager: { getSessionId: () => 'source-session' },
    });
  assert.deepEqual(result.details, { outcome: 'applied' });
  assert.equal(requests[0].key, 'call-id');
  assert.equal(requests[0].signal, signal);
  assert.deepEqual(requests[0].input, { enabled: false });
  assert.deepEqual(callers[0], { originSessionRef: 'source-session' });
  const messages = [];
  pi.sendMessage = (message) => messages.push(message);
  await commands.get('scheduler').handler('settings timezone UTC', {
    hasUI: false,
    sessionManager: { getSessionId: () => 'source-session' },
  });
  await commands.get('scheduler').handler('settings concurrency 4', {
    hasUI: false,
    sessionManager: { getSessionId: () => 'source-session' },
  });
  assert.deepEqual(settingsUpdates, [
    {
      timezone: 'UTC',
      maxConcurrentRuns: 3,
      revision: 1,
    },
    {
      timezone: 'Asia/Shanghai',
      maxConcurrentRuns: 4,
      revision: 1,
    },
  ]);
  assert.equal(messages.length, 2);
  events.get('session_shutdown')();
  events.get('session_shutdown')();
  await assert.rejects(
    tools.get('scheduler_list').execute('read', {}, signal),
    /SCHEDULE_REQUEST_CANCELLED_OR_TIMED_OUT/
  );
});

test('public Pi resource loader loads the inline Scheduler factory without private APIs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'scheduler-pi-loader-'));
  try {
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir: root,
      settingsManager: SettingsManager.inMemory(),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        {
          name: 'scheduler',
          factory: createSchedulerExtension(clientOptions, () => ({
            async request() {
              return {};
            },
            close() {},
          })),
        },
      ],
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    const extension = loader.getExtensions().extensions.find((item) => item.tools.has('scheduler_create'));
    assert.ok(extension);
    assert.equal(extension.tools.size, 8);
    assert.ok(extension.commands.has('scheduler'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Scheduler slash command updates the shared cron.json through the Agent client', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'scheduler-command-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const commands = new Map();
  const events = new Map();
  const extension = createSchedulerExtension({
    agentDir: join(root, 'agent'),
    workspaceId: 'workspace',
    cwd: root,
    configRevision: 'revision',
    autoEnsure: false,
  });
  const pi = {
    registerTool() {},
    registerCommand(name, command) {
      commands.set(name, command);
    },
    registerMessageRenderer() {},
    on(name, handler) {
      events.set(name, handler);
    },
    sendMessage() {},
  };
  extension(pi);
  const context = {
    hasUI: false,
    sessionManager: { getSessionId: () => 'source-session' },
  };

  await commands.get('scheduler').handler('settings timezone UTC', context);
  await commands.get('scheduler').handler('settings concurrency 4', context);

  const settings = JSON.parse(await readFile(join(root, 'scheduler', 'cron.json'), 'utf8'));
  assert.equal(settings.timezone, 'UTC');
  assert.equal(settings.maxConcurrentRuns, 4);
  assert.equal(settings.revision, 3);
  const oldCommand = commands.get('scheduler');
  events.get('session_shutdown')();
  events.get('session_shutdown')();
  await assert.rejects(oldCommand.handler('settings timezone UTC', context), /Scheduler client is closed/);
  extension(pi);
  await commands.get('scheduler').handler('settings timezone Asia/Shanghai', context);
  const reopenedSettings = JSON.parse(await readFile(join(root, 'scheduler', 'cron.json'), 'utf8'));
  assert.equal(reopenedSettings.timezone, 'Asia/Shanghai');
  events.get('session_shutdown')();
});
