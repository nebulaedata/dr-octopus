/**
 * @author Codex
 * @description Validates same-session knowledge controls and model-facing contracts through the real public Pi SDK.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { modelToolNames } from '../dist/extensions/knowledge/definitions/model-tool-schemas.js';
import { createKnowledgeExtension } from '../dist/extensions/knowledge/extension/index.js';
import { createKnowledgeTuiExtension } from '../dist/extensions/knowledge/extension/tui-commands.js';

test(
  'Pi preserves identity/history and Session model selection while mode controls switch tools and prompts',
  { timeout: 60000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'octopus-kb-mode-sdk-'));
    const requests = [];
    const http = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
      }
      requests.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const frame = { id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'base' };
      res.write(
        'data: ' +
          JSON.stringify({
            ...frame,
            choices: [
              { index: 0, delta: { role: 'assistant', content: 'Fixture answer' }, finish_reason: null },
            ],
          }) +
          '\n\n'
      );
      res.write(
        'data: ' +
          JSON.stringify({ ...frame, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) +
          '\n\n'
      );
      res.end('data: [DONE]\n\n');
    });
    await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
      await new Promise((resolve) => http.close(resolve));
      await rm(directory, { recursive: true, force: true });
    });
    await writeFile(
      join(directory, 'models.json'),
      JSON.stringify({
        providers: {
          fixture: {
            api: 'openai-completions',
            apiKey: 'fixture-only',
            baseUrl: `http://127.0.0.1:${http.address().port}/v1`,
            models: ['base', 'answer'].map((id) => ({
              id,
              name: id,
              reasoning: false,
              input: ['text'],
              contextWindow: 32000,
              maxTokens: 256,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            })),
          },
        },
      })
    );
    const settingsManager = SettingsManager.inMemory({
      autoCompactionEnabled: false,
      autoRetryEnabled: false,
    });
    const modelRuntime = await ModelRuntime.create({
      modelsPath: join(directory, 'models.json'),
      authPath: join(directory, 'auth.json'),
      modelsStorePath: join(directory, 'models-store.json'),
    });
    const resourceLoader = new DefaultResourceLoader({
      cwd: directory,
      agentDir: directory,
      settingsManager,
      noExtensions: !process.env.OCTOPUS_TEST_PLAN_EXTENSION,
      additionalExtensionPaths: process.env.OCTOPUS_TEST_PLAN_EXTENSION
        ? [process.env.OCTOPUS_TEST_PLAN_EXTENSION]
        : [],
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        {
          name: 'knowledge',
          factory: createKnowledgeExtension({ agentDir: directory, cwd: directory, workspaceId: 'test' }),
        },
      ],
    });
    await resourceLoader.reload();
    const sessionManager = SessionManager.create(directory, directory);
    const { session } = await createAgentSession({
      cwd: directory,
      agentDir: directory,
      settingsManager,
      modelRuntime,
      model: modelRuntime.getModel('fixture', 'base'),
      resourceLoader,
      sessionManager,
    });
    t.after(() => session.dispose());
    const states = [];
    const errors = [];
    await session.bindExtensions({
      mode: 'rpc',
      uiContext: {
        setWidget() {},
        setFooter() {},
        setEditorText() {},
        setHeader() {},
        setTitle() {},
        setStatus: (key, value) => {
          if (key === 'octopus-knowledge-mode') {
            states.push(JSON.parse(value));
          }
        },
        notify() {},
      },
      onError: (error) => errors.push(error),
    });
    if (process.env.OCTOPUS_TEST_PLAN_EXTENSION) {
      await session.prompt('/plan start');
      await session.prompt('/knowledge on');
      assert.equal(states.at(-1).enabled, false);
      assert.ok(errors.some((error) => /Plan/.test(error.error)));
      errors.length = 0;
      await session.prompt('/plan exit');
    }
    const originalTools = session.getActiveToolNames();
    assert.ok(!originalTools.some((name) => name.startsWith('knowledge_') && !modelToolNames.includes(name)));
    assert.ok(modelToolNames.every((name) => originalTools.includes(name)));
    const id = sessionManager.getSessionId();
    await session.prompt('/knowledge config {"collectionIds":["policies"]}');
    await session.prompt('/knowledge on');
    assert.equal(states.at(-1).enabled, true, JSON.stringify(errors));
    assert.equal(requests.length, 0, 'mode controls must never call a model');
    assert.equal(session.model.id, 'base');
    await session.setModel(modelRuntime.getModel('fixture', 'answer'));
    await session.prompt('/knowledge config {"collectionIds":["policies"]}');
    assert.equal(session.model.id, 'answer');
    assert.deepEqual(states.at(-1), { version: 1, enabled: true, collectionIds: ['policies'] });
    if (process.env.OCTOPUS_TEST_PLAN_EXTENSION) {
      await session.prompt('/plan start');
      const plan = sessionManager
        .getBranch()
        .findLast((entry) => entry.type === 'custom' && entry.customType === 'plan-mode-state');
      assert.equal(plan?.data?.enabled, false);
      assert.equal(states.at(-1).enabled, true);
    }
    await session.prompt('What is the policy?');
    assert.equal(sessionManager.getSessionId(), id);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].model, 'answer');
    assert.equal(requests[0].tools.length, 11);
    assert.ok(
      requests[0].tools.every(
        (tool) => tool.function.name.startsWith('knowledge_') || modelToolNames.includes(tool.function.name)
      )
    );
    assert.match(JSON.stringify(requests[0].messages), /知识库问答助手/);
    assert.match(JSON.stringify(requests[0].messages), /policies/);
    await session.prompt('/knowledge off');
    assert.equal(session.model.id, 'answer');
    assert.deepEqual(session.getActiveToolNames(), originalTools);
    await session.prompt('Continue normal work');
    assert.equal(requests.length, 2);
    assert.equal(requests[1].model, 'answer');
    assert.ok(
      !requests[1].tools.some(
        (tool) => tool.function.name.startsWith('knowledge_') && !modelToolNames.includes(tool.function.name)
      )
    );
    assert.ok(
      requests[1].messages.some(
        (message) =>
          message.role === 'user' && JSON.stringify(message.content).includes('What is the policy?')
      )
    );
    assert.ok(
      requests[1].messages.some(
        (message) =>
          message.role === 'user' && JSON.stringify(message.content).includes('Continue normal work')
      )
    );
    assert.doesNotMatch(
      String(requests[1].messages.find((message) => message.role === 'system')?.content),
      /知识库问答助手/
    );
    assert.match(
      String(requests[1].messages.find((message) => message.role === 'system')?.content),
      /知识问答模式已退出/
    );
    assert.deepEqual(errors, []);

    await session.prompt('/knowledge on');
    assert.equal(session.model.id, 'answer');
    await session.prompt('/knowledge off');

    const terminalLoader = new DefaultResourceLoader({
      cwd: directory,
      agentDir: directory,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        {
          name: 'knowledge',
          factory: createKnowledgeTuiExtension(join(directory, 'terminal-profile', 'agent')),
        },
      ],
    });
    await terminalLoader.reload();
    const terminalManager = SessionManager.inMemory(directory);
    terminalManager.appendCustomEntry('octopus-knowledge-mode', {
      version: 1,
      enabled: true,
      collectionIds: ['policies'],
      model: { provider: 'fixture', id: 'answer' },
    });
    const { session: terminal } = await createAgentSession({
      cwd: directory,
      agentDir: directory,
      settingsManager,
      modelRuntime,
      model: modelRuntime.getModel('fixture', 'base'),
      resourceLoader: terminalLoader,
      sessionManager: terminalManager,
    });
    t.after(() => terminal.dispose());
    const notices = [];
    await terminal.bindExtensions({
      mode: 'tui',
      uiContext: { notify: (message) => notices.push(message) },
      onError: (error) => errors.push(error),
    });
    const terminalTools = terminal.getActiveToolNames();
    const entryCount = terminalManager.getBranch().length;
    await terminal.prompt('/knowledge service status');
    assert.equal(requests.length, 2, 'TUI controls must not invoke an answer model');
    assert.equal(terminal.model.id, 'base', 'old QA state must not restore the answer model');
    assert.deepEqual(terminal.getActiveToolNames(), terminalTools);
    assert.ok(!terminalTools.some((name) => name.startsWith('knowledge_') && !modelToolNames.includes(name)));
    assert.equal(terminalManager.getBranch().length, entryCount);
    assert.equal(notices.length, 1);
    assert.equal(JSON.parse(notices[0]).state, 'absent');
    assert.deepEqual(errors, []);
  }
);
