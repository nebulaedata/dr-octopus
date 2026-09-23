/**
 * @author Codex
 * @description Verifies first-message admission through a real Pi child and a controlled local OpenAI-compatible Provider.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import Fastify from 'fastify';
import { createDatabase } from '../dist/db/client.js';
import { SessionRuntimeCoordinator } from '../dist/infrastructure/runtime/coordinator.js';
import { createSessionsService } from '../dist/modules/sessions/index.js';
import { ChannelService } from '../dist/modules/channel/channel.service.js';
import { ConversationStartService } from '../dist/modules/conversation-start/conversation-start.service.js';
import { ConversationStartRepository } from '../dist/modules/conversation-start/conversation-start.repository.js';
import { SettingsService } from '../dist/modules/model-settings/model-settings.service.js';
import { createPiSettingsStore } from '../dist/infrastructure/pi-settings/index.js';

for (const knowledge of [undefined, { collectionIds: ['selected-source'] }]) {
  test(
    `a newly configured Provider receives the first message from a real cold Pi runtime (${knowledge ? 'knowledge' : 'agent'})`,
    { timeout: 60000 },
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'octopus-start-provider-'));
      let received;
      let receivedUrl;
      let holdNext = false;
      let releaseHeld;
      const held = new Promise((resolve) => {
        releaseHeld = resolve;
      });
      const provider = createServer(async (request, response) => {
        let body = '';
        for await (const chunk of request) body += chunk;
        received = JSON.parse(body);
        receivedUrl = request.url;
        if (holdNext) {
          holdNext = false;
          await held;
        }
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const base = { id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-model' };
        response.write(
          `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: 'Onboarding works' }, finish_reason: null }] })}\n\n`
        );
        response.write(
          `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } })}\n\n`
        );
        response.end('data: [DONE]\n\n');
      });
      await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
      const baseUrl = `http://127.0.0.1:${provider.address().port}/v1`;
      await writeFile(
        join(root, 'models.json'),
        JSON.stringify({
          providers: {
            'onboarding-fixture': {
              baseUrl,
              api: 'openai-completions',
              apiKey: 'test-only',
              models: [
                {
                  id: 'fixture-model',
                  name: 'Fixture',
                  reasoning: false,
                  input: ['text'],
                  contextWindow: 32000,
                  maxTokens: 1024,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                },
              ],
            },
          },
        })
      );
      await writeFile(
        join(root, 'settings.json'),
        JSON.stringify({ defaultProvider: 'onboarding-fixture', defaultModel: 'fixture-model' })
      );
      const workspace = {
        id: 'w',
        schemaVersion: 1,
        kind: 'general',
        name: 'Fixture',
        slug: 'fixture',
        cwd: root,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      };
      const database = createDatabase(':memory:');
      const server = Fastify();
      server.decorate('database', database);
      const runtime = new SessionRuntimeCoordinator({
        processOptions: {
          agentDir: root,
          entryPath: fileURLToPath(
            new URL(
              knowledge
                ? './fixtures/onboarding-knowledge-pi-entry.mjs'
                : './fixtures/onboarding-pi-entry.mjs',
              import.meta.url
            )
          ),
          requestTimeoutMs: 20000,
        },
        sessionBootstrap: {
          create: async () => {
            const sessionPath = join(root, `${randomUUID()}.jsonl`);
            await writeFile(
              sessionPath,
              JSON.stringify({
                type: 'session',
                version: 3,
                id: randomUUID(),
                cwd: root,
                timestamp: new Date().toISOString(),
              }) + '\n'
            );
            return { sessionPath, cleanup: async () => {} };
          },
        },
      });
      const sessions = createSessionsService(server, {
        runtime,
        workspaceService: { resolve: async () => workspace },
        messageFeedbackRepository: { listBySession: () => [] },
      });
      const attachments = { releasePrompt() {} };
      const channel = new ChannelService(
        {
          sessionsService: sessions,
          attachmentsService: attachments,
          resolveWorkspaceCwd: async () => root,
          resolveWorkspaceReferences: async (_w, references) => references,
        },
        { maxSubscriptions: 10 }
      );
      const settings = new SettingsService(createPiSettingsStore({ agentDir: root, controlPlaneCwd: root }));
      const starts = new ConversationStartService({
        repository: new ConversationStartRepository(database),
        sessions,
        settings,
        channel,
        attachments,
        configuration: async () => 'fixture',
        assertWorkspace: async () => workspace,
      });
      try {
        const catalog = await starts.catalog();
        const candidate = catalog.models.find((model) => model.id === 'fixture-model');
        assert.deepEqual(candidate.thinkingLevels, getSupportedThinkingLevels({ reasoning: false }));
        const input = {
          submissionId: randomUUID(),
          draftId: randomUUID(),
          draftVersion: 1,
          message: 'Say hello',
          attachmentIds: [],
          workspaceReferences: [],
          selection: { mode: 'follow-default' },
          ...(knowledge ? { controls: { workMode: 'knowledge', knowledge } } : {}),
        };
        await starts.start('w', input);
        let status;
        for (let attempt = 0; attempt < 250; attempt++) {
          status = starts.get('w', input.submissionId);
          if (['running', 'failed', 'unknown'].includes(status.status)) break;
          await delay(100);
        }
        assert.equal(status.status, 'running', JSON.stringify(status));
        for (let attempt = 0; attempt < 100 && !received; attempt++) await delay(100);
        assert.equal(received?.model, 'fixture-model');
        assert.ok(received.messages.some((message) => message.role === 'user'));
        assert.equal(sessions.getSession(status.sessionId).model, 'fixture-model');
        let history;
        for (let attempt = 0; attempt < 100; attempt++) {
          history = await sessions.getHistory(status.sessionId);
          if (
            JSON.stringify(history).includes('Onboarding works') &&
            sessions.getSession(status.sessionId).runtime.state === 'idle'
          )
            break;
          await delay(100);
        }
        assert.ok(
          JSON.stringify(history).includes('Onboarding works'),
          'The actual first reply must be persisted'
        );
        if (knowledge) {
          const instructions = JSON.stringify(
            received.messages.filter((message) => message.role === 'system' || message.role === 'developer')
          );
          assert.ok(
            instructions.includes('知识库问答助手'),
            'The first inference must run in knowledge mode'
          );
          assert.ok(
            instructions.includes('selected-source'),
            'The first inference must receive the saved collection scope'
          );
          assert.ok(
            received.tools.some((tool) => tool.function?.name === 'knowledge_search'),
            'Knowledge tools must be active before the first inference'
          );
          return;
        }
        const before = sessions.getSession(status.sessionId).runtime;
        const updated = JSON.parse(
          await (await import('node:fs/promises')).readFile(join(root, 'models.json'), 'utf8')
        );
        updated.providers['onboarding-fixture'].baseUrl = baseUrl.replace('/v1', '/v2');
        await writeFile(join(root, 'models.json'), JSON.stringify(updated));
        runtime.configChanges.record('/settings/model-providers');
        assert.equal(sessions.getSession(status.sessionId).runtimeControl.restartRequired, true);
        await assert.rejects(
          sessions.execute(status.sessionId, { type: 'prompt', message: 'Again' }, before),
          {
            code: 'SESSION_CONFIGURATION_STALE',
          }
        );
        const restarted = await sessions.restart(status.sessionId, {
          expectedRuntime: { runtimeId: before.runtimeId, epoch: before.epoch },
          allowInterrupt: false,
        });
        assert.notEqual(restarted.runtime.runtimeId, before.runtimeId);
        assert.equal(restarted.runtimeControl.restartRequired, false);
        await sessions.execute(status.sessionId, { type: 'prompt', message: 'Again' }, restarted.runtime);
        for (let attempt = 0; attempt < 100 && !receivedUrl?.startsWith('/v2'); attempt++) await delay(100);
        assert.ok(receivedUrl.startsWith('/v2'), 'The existing conversation must call the updated endpoint');
        for (
          let attempt = 0;
          attempt < 100 && sessions.getSession(status.sessionId).runtime.state !== 'idle';
          attempt++
        )
          await delay(100);
        holdNext = true;
        const busy = sessions.execute(
          status.sessionId,
          { type: 'prompt', message: 'Wait for update' },
          restarted.runtime
        );
        for (
          let attempt = 0;
          attempt < 100 && sessions.getSession(status.sessionId).runtime.state !== 'running';
          attempt++
        )
          await delay(50);
        runtime.configChanges.record('/settings/model-providers');
        const queued = await sessions.restart(status.sessionId, {
          expectedRuntime: { runtimeId: restarted.runtime.runtimeId, epoch: restarted.runtime.epoch },
          allowInterrupt: false,
          whenIdle: true,
        });
        assert.equal(queued.runtimeControl.restartOnIdle, true);
        assert.equal(queued.runtime.runtimeId, restarted.runtime.runtimeId);
        releaseHeld();
        await busy;
        for (let attempt = 0; attempt < 150; attempt++) {
          const current = sessions.getSession(status.sessionId);
          if (
            current.runtime &&
            current.runtime.runtimeId !== restarted.runtime.runtimeId &&
            !current.runtimeControl.restartRequired
          )
            break;
          await delay(100);
        }
        assert.notEqual(sessions.getSession(status.sessionId).runtime.runtimeId, restarted.runtime.runtimeId);
        assert.equal(sessions.getSession(status.sessionId).runtimeControl.restartRequired, false);
      } finally {
        releaseHeld();
        await starts.close();
        channel.close();
        sessions.dispose();
        await runtime.close();
        await server.close();
        database.sqlite.close();
        provider.closeAllConnections();
        await new Promise((resolve) => provider.close(resolve));
        await rm(root, { recursive: true, force: true });
      }
    }
  );
}
