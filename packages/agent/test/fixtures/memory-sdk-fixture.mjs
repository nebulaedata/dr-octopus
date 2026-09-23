/**
 * @author Codex
 * @description Exercise real Pi sessions and SQLite against a deterministic HTTP model provider.
 */
import assert from 'node:assert/strict';
import { stopMemoryService } from '../../dist/extensions/memory/sdk/lifecycle.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import {
  createAgentSession,
  createAgentSessionRuntime,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { createMemoryExtension, createMemoryService } from '../../dist/extensions/memory/index.js';

/**
 * Emit provider-compatible SSE, including native function calls when requested.
 */
function respond(res, content, tool) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const frame = { id: 'memory-e2e', object: 'chat.completion.chunk', created: 1, model: 'fixture' };
  const delta = tool
    ? {
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: 'call-' + tool.name,
            type: 'function',
            function: { name: tool.name, arguments: JSON.stringify(tool.input) },
          },
        ],
      }
    : { role: 'assistant', content };
  for (const [value, reason] of [
    [delta, null],
    [{}, tool ? 'tool_calls' : 'stop'],
  ]) {
    res.write(
      'data: ' +
        JSON.stringify({ ...frame, choices: [{ index: 0, delta: value, finish_reason: reason }] }) +
        '\n\n'
    );
  }
  res.end('data: [DONE]\n\n');
}

/**
 * Keep model decisions controlled while traversing real transport, extension events and storage.
 */
export async function memorySdkFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'octopus-memory-sdk-'));
  const requests = [];
  const sessions = [];
  const states = [];
  const errors = [];
  let curatorOutput;
  const http = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const request = JSON.parse(raw);
    requests.push(request);
    const curator = request.messages.some((m) =>
      String(m.content).includes('You curate global long-term memory.')
    );
    if (curator) {
      const input = JSON.parse(request.messages.at(-1).content);
      const source = input.sources.findLast((s) => s.evidence.includes('QA_MEMORY'));
      const existing = input.existing.find((d) => d.canonicalKey === 'qa.memory.preference');
      const candidate = source
        ? [
            {
              requestId: 'model-placeholder',
              canonicalKey: 'qa.memory.preference',
              topic: '测试偏好',
              type: 'preference',
              indexText: 'QA_MEMORY 偏好',
              bodyMd: source.evidence,
              sources: [{ sessionId: source.sessionId, entryId: source.entryId }],
              action: existing ? 'update' : 'create',
              ...(existing
                ? {
                    target: { storeId: existing.storeId, indexId: existing.indexId },
                    expectedRevision: existing.revision,
                  }
                : {}),
            },
          ]
        : [];
      respond(
        res,
        (Array.isArray(curatorOutput) ? curatorOutput.shift() : curatorOutput) ?? JSON.stringify(candidate)
      );
      return;
    }
    const lastUser = request.messages.findLastIndex(
      (m) => m.role === 'user' && !JSON.stringify(m.content).includes('Historical navigation only.')
    );
    const prompt = JSON.stringify(request.messages[lastUser]?.content);
    if (prompt.includes('FAIL_MAIN')) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Deterministic provider failure', type: 'invalid_request_error' },
        })
      );
      return;
    }
    const recent = request.messages.slice(lastUser + 1);
    if (prompt.includes('RECALL_MEMORY')) {
      const outputs = recent.filter((m) => m.role === 'tool');
      if (!outputs.length) {
        respond(res, '', { name: 'memory_recall', input: { mode: 'search', query: 'QA_MEMORY' } });
        return;
      }
      const recalled = JSON.parse(outputs[0].content);
      if (outputs.length === 1 && recalled.items?.length) {
        respond(res, '', {
          name: 'memory_read',
          input: { refs: recalled.items.map(({ storeId, indexId }) => ({ storeId, indexId })) },
        });
        return;
      }
      respond(res, outputs.at(-1).content);
      return;
    }
    respond(res, '收到，会按你的要求处理；保存结果以提交回执为准。');
  });
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  await writeFile(
    join(root, 'models.json'),
    JSON.stringify({
      providers: {
        fixture: {
          api: 'openai-completions',
          apiKey: 'fixture-only',
          baseUrl: `http://127.0.0.1:${http.address().port}/v1`,
          models: [
            {
              id: 'fixture',
              name: 'Memory test',
              reasoning: false,
              input: ['text'],
              contextWindow: 32000,
              maxTokens: 2000,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        },
      },
    })
  );
  const modelRuntime = await ModelRuntime.create({
    modelsPath: join(root, 'models.json'),
    authPath: join(root, 'auth.json'),
    modelsStorePath: join(root, 'models-store.json'),
  });
  const service = createMemoryService({ dataRoot: root });
  t.after(async () => {
    for (const { session, shutdown } of sessions) {
      await session.abort();
      await shutdown();
      session.dispose();
    }
    await service.dispose();
    http.closeAllConnections();
    await new Promise((resolve) => http.close(resolve));
    await stopMemoryService(root);
    await rm(root, { recursive: true, force: true });
  });
  /**
   * Create a fresh workspace/session while sharing only global memory and model transport.
   */
  async function create({ readOnly = false, trusted = true, mode = 'rpc', target } = {}) {
    const cwd = target?.cwd ?? join(root, 'workspace-' + sessions.length);
    await mkdir(cwd, { recursive: true });
    const settingsManager = SettingsManager.inMemory(
      { autoCompactionEnabled: false, autoRetryEnabled: false },
      { projectTrusted: trusted }
    );
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: root,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        {
          name: 'octopus-memory',
          hidden: true,
          factory: createMemoryExtension({ dataRoot: root, readOnly }),
        },
      ],
    });
    await resourceLoader.reload();
    const extension = resourceLoader.getExtensions().extensions[0];
    assert.equal(extension.handlers.has('resources_discover'), false);
    const shutdown = () =>
      Promise.all(
        extension.handlers.get('session_shutdown').map((handler) => handler({ type: 'session_shutdown' }, {}))
      );
    const { session, extensionsResult } = await createAgentSession({
      cwd,
      agentDir: root,
      settingsManager,
      modelRuntime,
      model: modelRuntime.getModel('fixture', 'fixture'),
      resourceLoader,
      sessionManager: target?.sessionManager ?? SessionManager.inMemory(cwd),
      sessionStartEvent: target?.sessionStartEvent,
      tools: ['memory_read', 'memory_recall', 'read'],
    });
    assert.deepEqual(extensionsResult.errors, []);
    await session.bindExtensions({
      mode,
      uiContext: {
        theme: { fg: (_color, text) => text },
        setStatus: (key, value) => states.push({ key, value }),
        notify() {},
      },
      onError: (error) => errors.push(error),
    });
    sessions.push({ session, shutdown });
    return {
      session,
      extensionsResult,
      diagnostics: [],
      services: { cwd, agentDir: root, settingsManager, modelRuntime, resourceLoader, diagnostics: [] },
    };
  }
  /**
   * Open an independent Session without lifecycle replacement orchestration.
   */
  async function open(options) {
    return (await create(options)).session;
  }
  /**
   * Use the public Pi owner for new/resume flows with isolated persisted session files.
   */
  async function openRuntime() {
    const cwd = join(root, 'runtime-workspace');
    await mkdir(cwd, { recursive: true });
    return createAgentSessionRuntime((target) => create({ target }), {
      cwd,
      agentDir: root,
      sessionManager: SessionManager.create(cwd, join(root, 'sessions')),
    });
  }
  return {
    root,
    service,
    open,
    openRuntime,
    requests,
    states,
    errors,
    setCuratorOutput: (value) => {
      curatorOutput = value;
    },
  };
}
