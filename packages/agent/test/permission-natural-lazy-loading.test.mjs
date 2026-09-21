/**
 * @author Codex
 * @description Verifies that scheduled execution waits for natural provider initialization and checks real identities.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createAgentSession,
  createSyntheticSourceInfo,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { capability } from '../dist/extensions/permission-system/extension/unattended.js';
import {
  createPermissionSystemExtension,
  openGrantRepository,
} from '../dist/extensions/permission-system/index.js';

test(
  'task startup does not warm tools; the normal first turn validates lazy tools before execution',
  { timeout: 30000 },
  async (t) => {
    for (const changed of [false, true]) {
      await t.test(changed ? 'changed identity is blocked' : 'matching identity executes', async (t) => {
        const root = await mkdtemp(join(tmpdir(), 'natural-lazy-'));
        const agentDir = join(root, 'agent');
        await mkdir(agentDir);
        const prior = [process.env.DR_OCTOPUS_CODING_AGENT_DIR, process.env.DR_OCTOPUS_PERMISSION_EXECUTION];
        process.env.DR_OCTOPUS_CODING_AGENT_DIR = agentDir;
        const sessionManager = SessionManager.inMemory(root);
        const definition = {
          name: 'lazy_ping',
          description: 'Lazy ping',
          parameters: { type: 'object', properties: {} },
          sourceInfo: createSyntheticSourceInfo('<inline:lazy-provider>', { source: 'inline' }),
        };
        const repository = openGrantRepository(agentDir);
        const binding = {
          profileId: 'profile',
          subjectId: 'task',
          workspaceId: 'workspace',
          executionDigest: 'a'.repeat(64),
        };
        const grant = repository.approve(binding, [capability(definition)], 'approve');
        process.env.DR_OCTOPUS_PERMISSION_EXECUTION = JSON.stringify({
          ...binding,
          sessionId: sessionManager.getSessionId(),
          attemptId: 'attempt',
          cwd: root,
          inspect: false,
          ref: { grantId: grant.id, grantRevision: grant.revision, executionDigest: binding.executionDigest },
        });
        let initialized = 0;
        let effects = 0;
        const requests = [];
        const http = createServer(async (req, res) => {
          let raw = '';
          for await (const chunk of req) raw += chunk;
          requests.push(JSON.parse(raw));
          const call = !changed && requests.length === 1;
          const delta = call
            ? {
                role: 'assistant',
                tool_calls: [
                  {
                    index: 0,
                    id: 'call-1',
                    type: 'function',
                    function: { name: definition.name, arguments: '{}' },
                  },
                ],
              }
            : { role: 'assistant', content: 'Done' };
          const frame = { id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture' };
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          for (const choice of [
            { index: 0, delta, finish_reason: null },
            { index: 0, delta: {}, finish_reason: call ? 'tool_calls' : 'stop' },
          ])
            res.write('data: ' + JSON.stringify({ ...frame, choices: [choice] }) + '\n\n');
          res.end('data: [DONE]\n\n');
        });
        await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
        let session;
        t.after(async () => {
          if (session) {
            await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
            session.dispose();
          }
          repository.close();
          await new Promise((resolve) => http.close(resolve));
          for (const [index, key] of [
            'DR_OCTOPUS_CODING_AGENT_DIR',
            'DR_OCTOPUS_PERMISSION_EXECUTION',
          ].entries()) {
            if (prior[index] === undefined) delete process.env[key];
            else process.env[key] = prior[index];
          }
          await rm(root, { recursive: true, force: true });
        });
        await writeFile(
          join(agentDir, 'models.json'),
          JSON.stringify({
            providers: {
              fixture: {
                api: 'openai-completions',
                apiKey: 'fixture-only',
                baseUrl: `http://127.0.0.1:${http.address().port}/v1`,
                models: [
                  {
                    id: 'fixture',
                    name: 'Fixture',
                    reasoning: false,
                    input: ['text'],
                    contextWindow: 32000,
                    maxTokens: 128,
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  },
                ],
              },
            },
          })
        );
        const settingsManager = SettingsManager.inMemory({
          compaction: { enabled: false },
          retry: { enabled: false },
        });
        const modelRuntime = await ModelRuntime.create({
          modelsPath: join(agentDir, 'models.json'),
          authPath: join(agentDir, 'auth.json'),
          modelsStorePath: join(agentDir, 'models-store.json'),
        });
        const resourceLoader = new DefaultResourceLoader({
          cwd: root,
          agentDir,
          settingsManager,
          noExtensions: true,
          noSkills: true,
          noContextFiles: true,
          extensionFactories: [
            {
              name: 'lazy-provider',
              factory(pi) {
                pi.on('before_agent_start', async () => {
                  initialized++;
                  await Promise.resolve();
                  pi.registerTool({
                    ...definition,
                    label: 'Ping',
                    description: changed ? 'Changed definition' : definition.description,
                    async execute() {
                      effects++;
                      return { content: [{ type: 'text', text: 'pong' }] };
                    },
                  });
                  pi.registerTool({
                    ...definition,
                    name: 'ungranted',
                    label: 'Unapproved',
                    async execute() {
                      throw new Error('Must not execute');
                    },
                  });
                });
              },
            },
            { name: 'permissions', factory: createPermissionSystemExtension() },
          ],
        });
        await resourceLoader.reload();
        ({ session } = await createAgentSession({
          cwd: root,
          agentDir,
          settingsManager,
          modelRuntime,
          model: modelRuntime.getModel('fixture', 'fixture'),
          resourceLoader,
          sessionManager,
        }));
        const errors = [];
        await session.bindExtensions({ mode: 'rpc', onError: (error) => errors.push(error) });
        assert.equal(initialized, 0);
        assert.equal(requests.length, 0);
        assert.deepEqual(session.getActiveToolNames(), []);
        await session.prompt('Use the authorized tool.');
        assert.equal(initialized, 1);
        assert.equal(effects, changed ? 0 : 1);
        assert.deepEqual(
          requests[0].tools?.map((tool) => tool.function.name) ?? [],
          changed ? [] : [definition.name]
        );
        if (changed) {
          assert.ok(errors.length);
          const evidence = sessionManager
            .getEntries()
            .filter((entry) => entry.customType === 'octopus-permission-execution')
            .at(-1).data;
          assert.equal(evidence.ready, false);
          assert.equal(evidence.code, 'SCHEDULE_AUTHORIZATION_STALE');
        } else assert.deepEqual(errors, []);
      });
    }
  }
);
