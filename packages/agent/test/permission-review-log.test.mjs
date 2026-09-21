/**
 * @author Codex
 * @description Verifies durable permission review logging, redaction, configuration, and fail-closed audit behavior.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createPermissionModeService,
  createPermissionSystemExtension,
  getPermissionReviewLogDirectory,
} from '../dist/extensions/permission-system/index.js';
import { FilePermissionReviewLogger } from '../dist/extensions/permission-system/lib/file-permission-review-logger.js';

test('permission audit tool exposes bounded filtered JSON entries to the agent', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'octopus-permission-audit-query-'));
  const agentDir = join(temporaryRoot, 'agent');
  const logsDir = getPermissionReviewLogDirectory(agentDir);
  const firstLogPath = join(logsDir, 'permission-review.1788582000000-14320-a81f2c4d.000.jsonl');
  const secondLogPath = join(logsDir, 'permission-review.1788582060000-20544-b12e8a91.000.jsonl');
  await mkdir(logsDir, { recursive: true });
  await writeFile(
    firstLogPath,
    [
      JSON.stringify({
        timestamp: '2026-08-29T01:00:00.000Z',
        event: 'permission_request.approved',
        requestId: 'request-a',
        sessionId: 'session-a',
        toolName: 'write',
        resolution: 'approved',
      }),
      'not-json',
    ].join('\n'),
    'utf8'
  );
  await writeFile(
    secondLogPath,
    [
      JSON.stringify({
        timestamp: '2026-08-29T02:00:00.000Z',
        event: 'permission_request.blocked',
        requestId: 'request-b',
        sessionId: 'session-b',
        toolName: 'bash',
        resolution: 'denied',
      }),
      JSON.stringify({
        timestamp: '2026-08-29T03:00:00.000Z',
        event: 'permission_request.approved',
        requestId: 'request-c',
        sessionId: 'session-a',
        toolName: 'write',
        resolution: 'approved',
      }),
    ].join('\n'),
    'utf8'
  );

  try {
    const tools = new Map();
    createPermissionSystemExtension(createPermissionModeService({ agentDir }))({
      registerCommand() {},
      registerTool(definition) {
        tools.set(definition.name, definition);
      },
      on() {},
    });
    const tool = tools.get('permission_audit_query');

    assert.equal(tool.parameters.additionalProperties, false);
    assert.match(tool.description, /read-only/u);
    const result = await tool.execute('audit-query-a', {
      limit: 1,
      sessionId: 'session-a',
      resolution: 'approved',
      since: '2026-08-29T00:00:00.000Z',
    });

    assert.equal(result.details.matched, 2);
    assert.equal(result.details.truncated, true);
    assert.equal(result.details.malformedLines, 1);
    assert.deepEqual(
      result.details.entries.map((entry) => entry.requestId),
      ['request-c']
    );
    assert.match(result.content[0].text, /Returned 1 of 2/u);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('session startup reloads policy without writing lifecycle audit records', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'octopus-permission-review-lifecycle-'));
  const agentDir = join(temporaryRoot, 'agent');

  try {
    const service = createPermissionModeService({ agentDir });
    const events = new Map();
    createPermissionSystemExtension(service)({
      registerCommand() {},
      registerTool() {},
      on(name, handler) {
        events.set(name, handler);
      },
    });

    await events.get('session_start')(
      { type: 'session_start', reason: 'startup' },
      {
        cwd: temporaryRoot,
        isProjectTrusted: () => true,
      }
    );

    assert.deepEqual(await service.queryReviewLog({ limit: 20 }), {
      entries: [],
      matched: 0,
      malformedLines: 0,
      truncated: false,
      logExists: false,
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('permission review logs rotate into process-owned segments with bounded history', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'octopus-permission-review-rotation-'));
  const agentDir = join(temporaryRoot, 'agent');
  const logger = new FilePermissionReviewLogger(agentDir, {
    maxSegmentBytes: 400,
    maxHistoryFiles: 1,
    maxHistoryBytes: 10_000,
    processStartedAt: 1788582000000,
    processId: 14320,
    instanceId: 'a81f2c4d',
    isProcessAlive: () => false,
  });

  try {
    for (let index = 0; index < 5; index += 1) {
      assert.equal(
        logger.write(
          'permission_request.allowed',
          {
            requestId: `request-${String(index)}`,
            sessionId: 'session-rotation',
            toolName: 'read',
            resolution: 'policy_allowed',
            detail: 'x'.repeat(180),
          },
          1_000
        ),
        undefined
      );
    }

    const filenames = (await readdir(getPermissionReviewLogDirectory(agentDir))).sort();
    assert.equal(filenames.length, 2);
    assert.ok(
      filenames.every((name) => /^permission-review\.1788582000000-14320-a81f2c4d\.\d{3}\.jsonl$/u.test(name))
    );
    assert.ok(filenames.some((name) => name.endsWith('.004.jsonl')));

    const result = await createPermissionModeService({ agentDir }).queryReviewLog({ limit: 20 });
    assert.equal(result.logExists, true);
    assert.equal(result.entries.length, 2);
    assert.deepEqual(
      result.entries.map((entry) => entry.requestId),
      ['request-3', 'request-4']
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('permission audit query handles an absent log and honors cancellation', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'octopus-permission-audit-empty-'));

  try {
    const service = createPermissionModeService({ agentDir: join(temporaryRoot, 'agent') });
    assert.deepEqual(await service.queryReviewLog({ limit: 20 }), {
      entries: [],
      matched: 0,
      malformedLines: 0,
      truncated: false,
      logExists: false,
    });

    const controller = new AbortController();
    controller.abort();
    await assert.rejects(service.queryReviewLog({ limit: 20 }, controller.signal), {
      name: 'AbortError',
    });
    await assert.rejects(service.queryReviewLog({ limit: 20, since: 'not-a-date' }), TypeError);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('permission review log records auto approvals with bounded redacted JSONL facts', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'octopus-permission-review-'));
  const agentDir = join(temporaryRoot, 'agent');
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    join(agentDir, 'permission-system.json'),
    JSON.stringify({ permissionReviewLog: true, reviewLogFieldMaxWidth: 100 }),
    'utf8'
  );

  try {
    const service = createPermissionModeService({ agentDir });
    const events = new Map();
    createPermissionSystemExtension(service)({
      registerCommand() {},
      registerTool() {},
      on(name, handler) {
        events.set(name, handler);
      },
    });
    service.setMode('auto');

    assert.deepEqual(
      await events.get('tool_call')(
        {
          type: 'tool_call',
          toolCallId: 'subagent-audit-a',
          toolName: 'subagent',
          input: {
            agent: 'explorer',
            task: 'Inspect permission behavior',
            authorization: 'Bearer TEST_SECRET',
          },
        },
        {
          cwd: temporaryRoot,
          isProjectTrusted: () => false,
          hasUI: true,
          sessionManager: { getSessionId: () => 'session-audit-a' },
          ui: {
            notify() {},
            select: async () => 'No',
            input: async () => undefined,
          },
        }
      ),
      {}
    );

    const entries = await readReviewEntries(agentDir);
    assert.equal(entries.length, 1);
    assert.deepEqual(
      {
        extension: entries[0].extension,
        stream: entries[0].stream,
        event: entries[0].event,
        source: entries[0].source,
        sessionId: entries[0].sessionId,
        mode: entries[0].mode,
        toolName: entries[0].toolName,
        resolution: entries[0].resolution,
      },
      {
        extension: 'pi-permission-system',
        stream: 'review',
        event: 'permission_request.auto_approved',
        source: 'tool_call',
        sessionId: 'session-audit-a',
        mode: 'auto',
        toolName: 'subagent',
        resolution: 'auto_approved',
      }
    );
    assert.match(entries[0].timestamp, /^\d{4}-\d{2}-\d{2}T/u);
    assert.match(entries[0].toolInputPreview, /\[redacted\]/u);
    assert.doesNotMatch(entries[0].toolInputPreview, /TEST_SECRET/u);
    assert.ok(entries[0].toolInputPreview.length <= 101);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('permission review log can be disabled from the current global config', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'octopus-permission-review-off-'));
  const agentDir = join(temporaryRoot, 'agent');
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    join(agentDir, 'permission-system.json'),
    JSON.stringify({ permissionReviewLog: false }),
    'utf8'
  );

  try {
    const service = createPermissionModeService({ agentDir });
    assert.equal(service.writeReviewLog('permission_request.allowed', { toolName: 'read' }), undefined);
    await assert.rejects(readdir(getPermissionReviewLogDirectory(agentDir)), { code: 'ENOENT' });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('interactive and session approvals share correlated review-log events', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'octopus-permission-review-ask-'));
  const agentDir = join(temporaryRoot, 'agent');

  try {
    const service = createPermissionModeService({ agentDir });
    const events = new Map();
    createPermissionSystemExtension(service)({
      registerCommand() {},
      registerTool() {},
      on(name, handler) {
        events.set(name, handler);
      },
    });
    const ctx = {
      cwd: temporaryRoot,
      isProjectTrusted: () => false,
      hasUI: true,
      sessionManager: { getSessionId: () => 'session-ask-a' },
      ui: {
        notify() {},
        select: async (_title, options) => options[1],
        input: async () => undefined,
      },
    };
    const authorizeTool = events.get('tool_call');

    assert.deepEqual(
      await authorizeTool(
        { type: 'tool_call', toolCallId: 'write-a', toolName: 'write', input: { path: 'src/a.ts' } },
        ctx
      ),
      {}
    );
    assert.deepEqual(
      await authorizeTool(
        { type: 'tool_call', toolCallId: 'write-b', toolName: 'write', input: { path: 'src/b.ts' } },
        ctx
      ),
      {}
    );

    const entries = await readReviewEntries(agentDir);
    assert.deepEqual(
      entries.map((entry) => entry.event),
      ['permission_request.waiting', 'permission_request.approved', 'permission_request.session_approved']
    );
    assert.equal(entries[0].requestId, entries[1].requestId);
    assert.notEqual(entries[1].requestId, entries[2].requestId);
    assert.equal(entries[1].resolution, 'approved_for_session');
    assert.equal(entries[2].resolution, 'session_approved');
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('review-log IO failures warn once without changing the permission decision', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'octopus-permission-review-io-'));
  const agentDir = join(temporaryRoot, 'agent');
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(temporaryRoot, 'permission-system'), 'directory barrier', 'utf8');

  try {
    const service = createPermissionModeService({ agentDir });
    const events = new Map();
    const warnings = [];
    createPermissionSystemExtension(service)({
      registerCommand() {},
      registerTool() {},
      on(name, handler) {
        events.set(name, handler);
      },
    });
    service.setMode('auto');
    const ctx = {
      cwd: temporaryRoot,
      isProjectTrusted: () => false,
      hasUI: true,
      sessionManager: { getSessionId: () => 'session-io-a' },
      ui: {
        notify(message, level) {
          warnings.push({ message, level });
        },
        select: async () => 'No',
        input: async () => undefined,
      },
    };
    const authorizeTool = events.get('tool_call');

    assert.deepEqual(
      await authorizeTool(
        { type: 'tool_call', toolCallId: 'subagent-io-a', toolName: 'subagent', input: {} },
        ctx
      ),
      {}
    );
    assert.deepEqual(
      await authorizeTool(
        { type: 'tool_call', toolCallId: 'subagent-io-b', toolName: 'subagent', input: {} },
        ctx
      ),
      {}
    );
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].level, 'warning');
    assert.match(warnings[0].message, /Failed to write permission-system review log/u);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('unexpected gate errors fail closed and leave a gate_error review entry', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'octopus-permission-gate-error-'));
  const agentDir = join(temporaryRoot, 'agent');

  try {
    const service = createPermissionModeService({ agentDir });
    service.evaluate = () => {
      throw new Error('parser init failed');
    };
    const events = new Map();
    createPermissionSystemExtension(service)({
      registerCommand() {},
      registerTool() {},
      on(name, handler) {
        events.set(name, handler);
      },
    });

    assert.deepEqual(
      await events.get('tool_call')(
        { type: 'tool_call', toolCallId: 'broken-a', toolName: 'write', input: { path: 'a.ts' } },
        {
          cwd: temporaryRoot,
          isProjectTrusted: () => false,
          hasUI: false,
          sessionManager: { getSessionId: () => 'session-broken-a' },
          ui: {},
        }
      ),
      {
        block: true,
        reason: 'Blocked by the Octopus permission policy: parser init failed',
      }
    );

    const [entry] = await readReviewEntries(agentDir);
    assert.ok(entry);
    assert.equal(entry.event, 'permission_request.blocked');
    assert.equal(entry.resolution, 'gate_error');
    assert.deepEqual(entry.decidedBy, { kind: 'gate_error', reason: 'parser init failed' });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

/**
 * Reads every managed test shard in filename order.
 *
 * @param {string} agentDir Isolated Pi Agent directory.
 * @returns {Promise<Record<string, unknown>[]>} Parsed review entries.
 */
async function readReviewEntries(agentDir) {
  const logsDir = getPermissionReviewLogDirectory(agentDir);
  const filenames = (await readdir(logsDir))
    .filter((name) => /^permission-review\.\d+-\d+-[a-f0-9]{8}\.\d{3,}\.jsonl$/u.test(name))
    .sort();
  const entries = [];
  for (const filename of filenames) {
    const content = await readFile(join(logsDir, filename), 'utf8');
    entries.push(
      ...content
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    );
  }
  return entries;
}
