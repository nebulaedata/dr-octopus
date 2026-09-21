/**
 * @author Codex
 * @description Verifies terminal service commands manage an isolated real daemon without tools, QA state or inference.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKnowledgeTuiExtension } from '../dist/extensions/knowledge/extension/tui-commands.js';
import { stopKnowledgeService } from '../dist/extensions/knowledge/sdk/lifecycle.js';

test(
  'TUI manages service start/restart/stop and checks health without enabling QA',
  { timeout: 90000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'octopus-knowledge-tui-'));
    const directory = join(root, 'agent');
    t.after(async () => {
      await stopKnowledgeService(directory);
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });
    let command;
    const notices = [];
    // Any tool, event or session mutation would fail: this adapter only owns a command.
    createKnowledgeTuiExtension(directory)({
      registerCommand(name, definition) {
        assert.equal(name, 'knowledge');
        command = definition;
      },
    });
    const ctx = {
      hasUI: true,
      ui: { notify: (message) => notices.push(JSON.parse(message)) },
    };
    assert.doesNotMatch(command.description, /config/);
    for (const value of [
      '',
      'on',
      'off',
      'status',
      'config {}',
      'service',
      'service status extra',
      'service health',
      'service unknown',
    ]) {
      await assert.rejects(
        command.handler(value, ctx),
        /用法：\/knowledge service start\|stop\|restart\|status/
      );
    }
    await assert.rejects(access(directory), { code: 'ENOENT' });
    await command.handler(' service   status ', ctx);
    assert.equal(notices.pop().state, 'absent');
    await assert.rejects(access(directory), { code: 'ENOENT' });
    await command.handler('service start', ctx);
    const started = notices.pop();
    assert.equal(started.state, 'running');
    await command.handler('service status', ctx);
    const health = notices.pop();
    assert.equal(health.daemonId, started.daemonId);
    assert.equal(health.health, 'degraded');
    assert.ok(health.checks.some((check) => check.name === 'embedding' && check.status === 'not-configured'));
    await command.handler('service restart', ctx);
    const restarted = notices.pop();
    assert.equal(restarted.state, 'running');
    assert.notEqual(restarted.daemonId, started.daemonId);
    await command.handler('service stop', ctx);
    assert.equal(notices.pop().state, 'stopped');
    await command.handler('service status', ctx);
    const stopped = notices.pop();
    assert.equal(stopped.state, 'stopped');
    assert.equal(stopped.autostartSuppressed, true);
    await command.handler('service status', { hasUI: false });
    assert.equal(notices.length, 0);
  }
);
