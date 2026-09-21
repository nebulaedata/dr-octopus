/**
 * @author Codex
 * @description 验证 Web 控制面 Session Repository 与附件暂存的隔离和安全约束
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { SessionsService } from '../dist/modules/sessions/sessions.service.js';
import { createDatabase } from '../dist/db/client.js';
import { SessionsRepository } from '../dist/modules/sessions/sessions.repository.js';

const serviceServer = Fastify();
test.after(() => serviceServer.close());

test('Session repository exposes the Pi session path alongside catalog metadata', () => {
  const database = createDatabase(':memory:');
  try {
    const repository = new SessionsRepository(database);
    const timestamp = new Date(0).toISOString();
    repository.upsert({
      id: 'session-a',
      workspaceId: 'workspace-a',
      agentSessionId: 'agent-session-a',
      agentSessionPath: 'C:\\private\\session-a.jsonl',
      title: 'Architecture review',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    repository.upsert({
      id: 'session-b',
      workspaceId: 'workspace-b',
      agentSessionId: 'agent-session-b',
      agentSessionPath: 'C:\\private\\session-b.jsonl',
      title: 'Unrelated',
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const [session] = repository.list({ workspaceId: 'workspace-a', search: 'Architecture' });
    assert.equal(session?.id, 'session-a');
    assert.equal(session?.agentSessionPath, 'C:\\private\\session-a.jsonl');
    assert.equal(repository.list({ workspaceId: 'workspace-b' }).length, 1);

    const updated = repository.updatePreferences('session-a', {
      steeringMode: 'all',
      autoRetryEnabled: false,
    });
    assert.equal(updated.preferences.steeringMode, 'all');
    assert.equal(updated.preferences.autoRetryEnabled, false);
  } finally {
    database.sqlite.close();
  }
});

test('Web titles stay catalog-only while Pi mutations project runtime preferences', async () => {
  const database = createDatabase(':memory:');
  const sessions = new SessionsRepository(database);
  const timestamp = new Date(0).toISOString();
  sessions.upsert({
    id: 'session-a',
    workspaceId: 'workspace-a',
    agentSessionId: 'agent-session-a',
    agentSessionPath: 'C:\\private\\session-a.jsonl',
    title: 'Original',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const binding = {
    runtimeId: 'runtime-a',
    workspaceId: 'workspace-a',
    workspaceCwd: 'C:\\workspace',
    agentSessionId: 'agent-session-a',
    sessionId: 'session-a',
    sessionPath: 'C:\\private\\session-a.jsonl',
    state: 'idle',
    lastActiveAt: 0,
  };
  const executions = [];
  let thinkingLevel = 'medium';
  let runtimeCloseCount = 0;
  const coordinator = {
    getBindingBySessionId: () => binding,
    withExisting: async (_input, operation) => {
      return operation({
        binding,
        execute: async (command) => {
          executions.push(command);
          if (command.type === 'set_thinking_level') {
            thinkingLevel = command.level;
          }
          return {
            type: 'response',
            command: command.type,
            success: true,
            ...(command.type === 'get_state' ? { data: { thinkingLevel } } : {}),
            ...(command.type === 'get_available_thinking_levels'
              ? { data: { levels: ['off', 'low', 'medium', 'high'] } }
              : {}),
          };
        },
        respondToExtensionUi: async () => undefined,
      });
    },
    onEvent: () => () => undefined,
    close: async () => {
      runtimeCloseCount += 1;
    },
  };
  const service = new SessionsService(serviceServer, {
    runtime: coordinator,
    sessionsRepository: sessions,
    workspaceService: { resolve: async () => ({}) },
  });
  try {
    await service.execute('session-a', { type: 'set_model', provider: 'openai', modelId: 'gpt-5' });
    const thinking = await service.executeThinkingControl('session-a', {
      type: 'set_thinking_level',
      level: 'high',
    });
    await service.renameSession('session-a', 'Renamed');

    const projected = sessions.get('session-a');
    assert.equal(projected?.provider, 'openai');
    assert.equal(projected?.model, 'gpt-5');
    assert.equal(projected?.preferences.thinkingLevel, 'high');
    assert.deepEqual(thinking, {
      level: 'high',
      availableLevels: ['off', 'low', 'medium', 'high'],
    });
    assert.equal(projected?.title, 'Renamed');
    assert.equal(
      executions.some((command) => command.type === 'set_session_name'),
      false
    );
  } finally {
    service.dispose();
    assert.equal(runtimeCloseCount, 0);
    database.sqlite.close();
  }
});

test('Session snapshot reads one runtime generation under one operation lease', async () => {
  const database = createDatabase(':memory:');
  const sessions = new SessionsRepository(database);
  const timestamp = new Date(0).toISOString();
  sessions.upsert({
    id: 'session-snapshot',
    workspaceId: 'workspace-a',
    agentSessionId: 'agent-session-snapshot',
    agentSessionPath: 'C:\\private\\snapshot.jsonl',
    title: 'Snapshot',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const binding = {
    runtimeId: 'runtime-snapshot',
    workspaceId: 'workspace-a',
    workspaceCwd: 'C:\\workspace',
    agentSessionId: 'agent-session-snapshot',
    sessionId: 'session-snapshot',
    sessionPath: 'C:\\private\\snapshot.jsonl',
    state: 'idle',
    lastActiveAt: 0,
  };
  const commands = [];
  let operationCount = 0;
  const service = new SessionsService(serviceServer, {
    runtime: {
      getBindingBySessionId: () => binding,
      getControl: () => ({ restartRequired: false, changedConfigRoutes: [], restart: { status: 'idle' } }),
      withExisting: async (_input, operation) => {
        operationCount += 1;
        return operation({
          binding,
          getCurrentBinding: () => binding,
          execute: async (command) => {
            commands.push(command.type);
            return {
              type: 'response',
              command: command.type,
              success: true,
              ...(command.type === 'get_state'
                ? {
                    data: {
                      model: { provider: 'anthropic', id: 'claude-sonnet', name: 'Claude Sonnet' },
                      thinkingLevel: 'medium',
                      isStreaming: false,
                      isCompacting: false,
                      steeringMode: 'one-at-a-time',
                      followUpMode: 'one-at-a-time',
                      sessionId: 'agent-session-snapshot',
                      autoCompactionEnabled: true,
                      messageCount: 0,
                      pendingMessageCount: 0,
                    },
                  }
                : {}),
              ...(command.type === 'get_messages' ? { data: { messages: [] } } : {}),
              ...(command.type === 'get_available_thinking_levels'
                ? { data: { levels: ['off', 'minimal', 'low', 'medium', 'high'] } }
                : {}),
              ...(command.type === 'get_entries' ? { data: { entries: [], leafId: null } } : {}),
              ...(command.type === 'get_session_stats'
                ? {
                    data: {
                      contextUsage: { tokens: 32000, contextWindow: 200000, percent: 16 },
                    },
                  }
                : {}),
              ...(command.type === 'get_commands' ? { data: { commands: [] } } : {}),
            };
          },
          respondToExtensionUi: async () => undefined,
          getPermissionState: async () => ({
            mode: 'ask',
            scope: 'runtime-generation',
            persisted: false,
          }),
        });
      },
      onEvent: () => () => undefined,
      close: async () => undefined,
    },
    sessionsRepository: sessions,
    messageFeedbackRepository: {
      listBySession: () => [],
      upsert: () => ({ entryId: '', rating: 'up' }),
    },
    workspaceService: {
      resolve: async () => ({ id: 'workspace-a', cwd: 'C:\\workspace' }),
    },
  });
  try {
    const snapshot = await service.getSnapshot('session-snapshot');
    assert.equal(operationCount, 1);
    assert.deepEqual(commands.sort(), [
      'get_available_thinking_levels',
      'get_commands',
      'get_entries',
      'get_messages',
      'get_session_stats',
      'get_state',
    ]);
    assert.equal(snapshot.runtime?.runtimeId, 'runtime-snapshot');
    assert.equal(snapshot.session.provider, 'anthropic');
    assert.equal(snapshot.session.model, 'claude-sonnet');
    assert.deepEqual(snapshot.thinking, {
      level: 'medium',
      availableLevels: ['off', 'minimal', 'low', 'medium', 'high'],
    });
    assert.deepEqual(snapshot.permission, {
      mode: 'ask',
      scope: 'runtime-generation',
      persisted: false,
    });
    assert.deepEqual(snapshot.contextUsage, { tokens: 32000, contextWindow: 200000, percent: 16 });
    assert.equal(sessions.get('session-snapshot')?.model, 'claude-sonnet');
  } finally {
    service.dispose();
    database.sqlite.close();
  }
});
