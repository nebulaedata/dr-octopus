/**
 * @author Codex
 * @description Verifies Workspace references cross every Session user-message command as private Pi context.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { ChannelService } from '../dist/modules/channel/channel.service.js';

test('Channel validates and projects Workspace references for prompt, steer, and follow-up', async () => {
  const server = Fastify();
  const executions = [];
  const resolved = [];
  const sessionsService = {
    onEvent: () => () => undefined,
    acquireSubscription: async () => ({
      runtime: {
        runtimeId: 'runtime-a',
        epoch: 1,
        workspaceId: 'workspace-a',
        sessionId: 'session-a',
        state: 'idle',
        lastActiveAt: 0,
      },
      release: () => undefined,
    }),
    getSession: () => ({ workspaceId: 'workspace-a' }),
    execute: async (sessionId, command) => executions.push({ sessionId, command }),
  };
  const service = new ChannelService(
    server,
    {
      sessionsService,
      attachmentsService: {},
      resolveWorkspaceCwd: async () => 'unused',
      resolveWorkspaceReferences: async (workspaceId, references) => {
        resolved.push({ workspaceId, references });
        return references;
      },
    },
    { maxSubscriptions: 1 }
  );
  service.connect('connection-a', () => undefined);
  await service.handleMessage('connection-a', {
    type: 'session.subscribe',
    requestId: 'subscribe-a',
    sessionId: 'session-a',
  });

  try {
    for (const [type, commandType] of [
      ['agent.prompt', 'prompt'],
      ['agent.steer', 'steer'],
      ['agent.follow-up', 'follow_up'],
    ]) {
      await service.handleMessage('connection-a', {
        type,
        requestId: `${commandType}-a`,
        sessionId: 'session-a',
        runtimeId: 'runtime-a',
        epoch: 1,
        payload: {
          message: 'Read @src/a.ts',
          workspaceReferences: [{ kind: 'file', path: 'src/a.ts' }],
        },
      });
    }

    assert.equal(resolved.length, 3);
    assert.equal(executions.length, 3);
    assert.deepEqual(
      executions.map(({ command }) => command.type),
      ['prompt', 'steer', 'follow_up']
    );
    for (const { command } of executions) {
      assert.match(command.message, /^Read @src\/a\.ts\n<host_workspace_reference_request/);
      assert.match(command.message, /<reference kind="file" path="src\/a\.ts" \/>/);
    }
  } finally {
    service.close();
    await server.close();
  }
});
