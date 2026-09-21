/**
 * @author Codex
 * @description Exercises aligned knowledge CLI and Scheduler TUI lifecycle commands against isolated real services.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createSchedulerExtension } from '../dist/extensions/scheduler/index.js';
import { stopSchedulerService } from '../dist/extensions/scheduler/sdk/lifecycle.js';
import { stopKnowledgeService } from '../dist/extensions/knowledge/sdk/lifecycle.js';

test(
  'Scheduler TUI service commands preserve explicit stop and never add lifecycle model tools',
  { timeout: 90000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'octopus-scheduler-tui-service-'));
    const directory = join(root, 'agent');
    const commands = new Map();
    const events = new Map();
    const tools = [];
    const results = [];
    createSchedulerExtension({ agentDir: directory, cwd: root, workspaceId: 'test', configRevision: '1' })({
      registerTool: (tool) => tools.push(tool.name),
      registerCommand: (name, command) => commands.set(name, command),
      registerMessageRenderer() {},
      on: (name, handler) => events.set(name, handler),
      sendMessage: (message) => results.push(JSON.parse(message.content)),
    });
    t.after(async () => {
      events.get('session_shutdown')();
      await stopSchedulerService(directory);
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });
    const command = commands.get('scheduler');
    const context = { hasUI: true, ui: { notify() {} } };
    assert.equal(tools.length, 8);
    assert.ok(!tools.some((name) => /service|restart|stop|start/.test(name)));
    for (const args of ['service', 'service invalid', 'service stop extra']) {
      await assert.rejects(command.handler(args, context), /Usage: \/scheduler service/);
    }
    await command.handler('service status', context);
    assert.equal(results.pop().state, 'absent');
    await assert.rejects(access(directory), { code: 'ENOENT' });
    await command.handler('service start', context);
    const started = results.pop();
    assert.equal(started.state, 'control-ready');
    await command.handler('service restart', context);
    const restarted = results.pop();
    assert.equal(restarted.state, 'control-ready');
    assert.notEqual(restarted.daemonId, started.daemonId);
    await command.handler('service stop', context);
    assert.equal(results.pop().state, 'stopped');
    await command.handler('service status', context);
    assert.equal(results.pop().state, 'stopped');
    await command.handler('status', { ...context, sessionManager: { getSessionId: () => 'test' } });
    assert.equal(results.pop().state, 'stopped');
    await command.handler('service start', context);
    assert.equal(results.pop().state, 'control-ready');
    events.get('session_shutdown')();
    await assert.rejects(command.handler('service stop', context), /Scheduler client is closed/);
  }
);

test(
  'knowledge service CLI supports all four actions without Workspace or model setup',
  { timeout: 90000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'octopus-knowledge-cli-service-'));
    const directory = join(root, 'agent');
    t.after(async () => {
      await stopKnowledgeService(directory);
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });
    const run = promisify(execFile);
    const cli = fileURLToPath(new URL('../dist/bin/octopus.js', import.meta.url));
    /**
     * Invoke the real public CLI with an isolated profile and no shell interpolation.
     */
    async function command(action) {
      const result = await run(
        process.execPath,
        [cli, 'knowledge', 'service', action, '--agent-dir', directory],
        {
          cwd: root,
          timeout: 40000,
        }
      );
      return JSON.parse(result.stdout.trim());
    }
    assert.equal((await command('status')).state, 'absent');
    await assert.rejects(access(directory), { code: 'ENOENT' });
    const started = await command('start');
    assert.equal(started.state, 'running');
    const restarted = await command('restart');
    assert.equal(restarted.state, 'running');
    assert.notEqual(restarted.daemonId, started.daemonId);
    assert.equal((await command('status')).daemonId, restarted.daemonId);
    assert.equal((await command('stop')).state, 'stopped');
    assert.equal((await command('status')).state, 'stopped');
  }
);
