/**
 * @author Codex
 * @description Verifies bundled memory and knowledge skill discovery, lazy reading and reload through real Pi sessions using a local model fixture.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DefaultResourceLoader,
  ModelRuntime,
  SettingsManager,
  SessionManager,
  createAgentSession,
} from '@earendil-works/pi-coding-agent';
import { registerMemoryEvents } from '../dist/extensions/memory/extension/events.js';
import { createKnowledgeExtension } from '../dist/extensions/knowledge/extension/index.js';

for (const name of ['memory', 'knowledge'])
  for (const mode of ['tui', 'rpc']) {
    test(`the built ${name} skill is discovered and read on demand in a real Pi ${mode} session and survives reload`, async (t) => {
      const cwd = await mkdtemp(join(tmpdir(), 'octopus-extension-skill-'));
      t.after(() => rm(cwd, { recursive: true, force: true }));
      const requests = [];
      const skillPath = fileURLToPath(
        new URL(`../dist/extensions/${name}/skills/${name}/SKILL.md`, import.meta.url)
      );
      const http = createServer(async (req, res) => {
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
        }
        requests.push(JSON.parse(raw));
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const frame = { id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'base' };
        if (requests.length === 3) {
          res.write(
            'data: ' +
              JSON.stringify({
                ...frame,
                choices: [
                  {
                    index: 0,
                    delta: {
                      role: 'assistant',
                      tool_calls: [
                        {
                          index: 0,
                          id: 'read-bundled-skill',
                          type: 'function',
                          function: { name: 'read', arguments: JSON.stringify({ path: skillPath }) },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              }) +
              '\n\n'
          );
          res.write(
            'data: ' +
              JSON.stringify({
                ...frame,
                choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
              }) +
              '\n\n'
          );
          res.end('data: [DONE]\n\n');
          return;
        }
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
            JSON.stringify({
              ...frame,
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            }) +
            '\n\n'
        );
        res.end('data: [DONE]\n\n');
      });
      await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
      t.after(() => new Promise((resolve) => http.close(resolve)));
      await writeFile(
        join(cwd, 'models.json'),
        JSON.stringify({
          providers: {
            fixture: {
              api: 'openai-completions',
              apiKey: 'fixture-only',
              baseUrl: `http://127.0.0.1:${http.address().port}/v1`,
              models: [
                {
                  id: 'base',
                  name: 'base',
                  reasoning: false,
                  input: ['text'],
                  contextWindow: 32000,
                  maxTokens: 256,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                },
              ],
            },
          },
        })
      );
      const modelRuntime = await ModelRuntime.create({
        modelsPath: join(cwd, 'models.json'),
        authPath: join(cwd, 'auth.json'),
        modelsStorePath: join(cwd, 'models-store.json'),
      });
      const settingsManager = SettingsManager.inMemory({
        autoCompactionEnabled: false,
        autoRetryEnabled: false,
      });
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir: cwd,
        settingsManager,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        extensionFactories: [
          {
            name: `octopus-${name}`,
            factory:
              name === 'knowledge'
                ? createKnowledgeExtension({ agentDir: cwd, cwd, workspaceId: 'fixture' })
                : (pi) =>
                    registerMemoryEvents(
                      pi,
                      {
                        getStatus: async () => ({
                          version: 1,
                          mode: 'off',
                          revision: 0,
                          writeEpoch: 0,
                          count: 0,
                          availability: 'ready',
                        }),
                        dispose: async () => {},
                      },
                      true
                    ),
          },
        ],
      });
      await loader.reload();
      const { session } = await createAgentSession({
        cwd,
        agentDir: cwd,
        settingsManager,
        modelRuntime,
        model: modelRuntime.getModel('fixture', 'base'),
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(cwd),
        tools: ['read'],
      });
      t.after(() => session.dispose());
      const errors = [];
      await session.bindExtensions({
        mode,
        uiContext: { theme: { fg: (_color, text) => text }, setStatus() {} },
        onError: (error) => errors.push(error),
      });
      assert.deepEqual(loader.getSkills().diagnostics, []);
      assert.equal(loader.getSkills().skills.filter((entry) => entry.name === name).length, 1);
      assert.equal(loader.getSkills().skills.find((entry) => entry.name === name).filePath, skillPath);
      if (name === 'knowledge') await session.prompt('/knowledge on');
      assert.ok(session.getActiveToolNames().includes('read'));
      const bundled = (
        await readFile(new URL(`../dist/extensions/${name}/skills/${name}/SKILL.md`, import.meta.url), 'utf8')
      ).replace(/^---[\s\S]*?---\s*/u, '');
      await session.prompt('Explain the current mode without invoking tools.');
      assert.equal(requests.length, 1);
      const firstPrompt = requests[0].messages.find((message) => message.role === 'system').content;
      assert.ok(firstPrompt.includes('<available_skills>'));
      assert.ok(firstPrompt.includes(`<name>${name}</name>`));
      assert.ok(firstPrompt.includes(skillPath));
      assert.equal(firstPrompt.includes(bundled), false, 'the catalogue excludes the skill body');
      await session.reload();
      await session.prompt('Explain the current mode after reload without invoking tools.');
      assert.equal(requests.length, 2);
      const secondPrompt = requests[1].messages.find((message) => message.role === 'system').content;
      assert.equal(secondPrompt.includes(bundled), false);
      assert.equal(secondPrompt.split(`<name>${name}</name>`).length - 1, 1);
      assert.deepEqual(loader.getSkills().diagnostics, []);
      assert.equal(loader.getSkills().skills.filter((entry) => entry.name === name).length, 1);
      assert.equal(loader.getSkills().skills.find((entry) => entry.name === name).filePath, skillPath);
      await session.prompt('Read the current skill.');
      assert.equal(requests.length, 4);
      const skillResult = requests[3].messages.find((message) => message.role === 'tool');
      assert.ok(
        skillResult.content.includes(bundled),
        'the public read tool loads the complete skill on demand'
      );
      assert.deepEqual(errors, []);
    });
  }
