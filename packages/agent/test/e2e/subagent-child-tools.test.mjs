/**
 * @author Codex
 * @description Exercises real foreground and detached Pi children against isolated local model and knowledge endpoints.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { knowledgeProfile } from '../../dist/extensions/knowledge/lib/profile.js';

/**
 * Emit one complete OpenAI-compatible streaming response without external inference.
 */
function completion(res, model, call, content = 'Completed child retrieval.') {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const delta = call
    ? {
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: `call-${model}-${Date.now()}`,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.input) },
          },
        ],
      }
    : { role: 'assistant', content };
  for (const [value, reason] of [
    [delta, null],
    [{}, call ? 'tool_calls' : 'stop'],
  ]) {
    res.write(
      `data: ${JSON.stringify({
        id: 'probe',
        object: 'chat.completion.chunk',
        model,
        choices: [{ index: 0, delta: value, finish_reason: reason }],
      })}\n\n`
    );
  }
  res.end('data: [DONE]\n\n');
}

for (const { background, kind, slash = false } of [
  { background: false, kind: 'knowledge' },
  { background: true, kind: 'knowledge' },
  { background: false, kind: 'memory' },
  { background: true, kind: 'memory' },
  { background: false, kind: 'models' },
  { background: true, kind: 'models' },
  { background: false, kind: 'restricted-models' },
  { background: true, kind: 'restricted-models' },
  { background: false, kind: 'restricted-models', slash: true },
  { background: true, kind: 'restricted-models', slash: true },
]) {
  test(
    `real ${kind} retrieval through ${background ? 'detached runner' : 'foreground session'}${slash ? ' with stale slash admission' : ''}`,
    { timeout: 120_000 },
    async (t) => {
      const packagePath = process.env.PI_SUBAGENTS_TEST_PATH
        ? dirname(process.env.PI_SUBAGENTS_TEST_PATH)
        : join(homedir(), '.dr-octopus/agent/npm/node_modules/pi-subagents');
      const installed = JSON.parse(await readFile(join(packagePath, 'package.json'), 'utf8'));
      assert.equal(installed.version, '0.68.0');
      const root = await mkdtemp(join(tmpdir(), 'octopus-child-real-'));
      const evidence = `CHILD_${kind.toUpperCase()}_EVIDENCE`;
      const restrictedModels = kind === 'restricted-models';
      const isModels = kind === 'models' || restrictedModels;
      const modelTools = ['ocr_image', 'embed_text', 'rerank_documents'];
      const parentTools = isModels
        ? modelTools
        : kind === 'memory'
          ? ['memory_recall', 'memory_read']
          : ['knowledge_list_collections', 'knowledge_search', 'knowledge_read'];
      await writeFile(
        join(root, 'page.png'),
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
          'base64'
        )
      );
      t.diagnostic(`Evidence directory: ${root}`);
      const agentDir = join(root, 'agent');
      await mkdir(join(agentDir, 'npm', 'node_modules'), { recursive: true });
      await symlink(
        packagePath,
        join(agentDir, 'npm/node_modules/pi-subagents'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      const requests = [],
        failures = [],
        childMenus = [];
      let parentTurns = 0,
        childTurns = 0,
        childDone = false;
      const http = createServer(async (req, res) => {
        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          if (req.url === '/knowledge/v1/blobs') {
            assert.equal(isModels, true);
            assert.equal(restrictedModels, false, 'denied OCR must not upload');
            assert.ok(Buffer.concat(chunks).length > 0);
            assert.equal(req.headers.authorization, 'Bearer isolated-test-token');
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ sha256: 'a'.repeat(64), size: Buffer.concat(chunks).length }));
            return;
          }
          const body = JSON.parse(Buffer.concat(chunks).toString());
          if (req.url === '/knowledge/v1/call') {
            requests.push(body);
            assert.equal(body.context.workspaceId, 'workspace-a');
            assert.equal(body.context.globalWrite, false);
            assert.equal(body.context.modelAccess, 'invoke');
            assert.equal(req.headers.authorization, 'Bearer isolated-test-token');
            const outputs = {
              'models.ocr': { text: evidence },
              'models.embed': { vectors: [[1, 2]], dimensions: 2 },
              'models.rerank': { results: [{ index: 0, score: 0.9 }] },
              'collections.get': {
                id: 'allowed',
                name: 'Allowed collection',
                scope: { kind: 'workspace', workspaceId: 'workspace-a' },
              },
              search: { items: [{ citationId: 'citation-one', text: 'CHILD_KNOWLEDGE_EVIDENCE' }] },
              read: { collectionId: 'allowed', text: 'CHILD_KNOWLEDGE_EVIDENCE' },
            };
            assert.ok(outputs[body.operation], `unexpected operation ${body.operation}`);
            if (body.operation === 'search') assert.deepEqual(body.input.collectionIds, ['allowed']);
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(outputs[body.operation]));
            return;
          }
          if (body.model === 'child') {
            childMenus.push(body.tools.map((tool) => tool.function.name));
            const calls = isModels
              ? [
                  { name: 'ocr_image', input: { path: 'page.png' } },
                  { name: 'embed_text', input: { texts: ['one'] } },
                  { name: 'rerank_documents', input: { query: 'q', documents: ['one'] } },
                ]
              : kind === 'memory'
                ? [
                    {
                      name: 'memory_recall',
                      input: { mode: 'search', query: 'E2E_ISOLATED_MEMORY_PROBE' },
                    },
                    {
                      name: 'memory_read',
                      input: { refs: [{ storeId: 'missing-test-store', indexId: 1 }] },
                    },
                    {
                      name: 'knowledge_search',
                      input: { collectionIds: ['forbidden'], query: 'DENIAL_ONLY' },
                    },
                  ]
                : [
                    { name: 'knowledge_list_collections', input: {} },
                    { name: 'knowledge_search', input: { collectionIds: ['allowed'], query: 'test' } },
                    { name: 'knowledge_read', input: { citationId: 'citation-one' } },
                  ];
            if (childTurns === calls.length) {
              if (restrictedModels) {
                assert.match(
                  JSON.stringify(body.messages),
                  /CHILD_TOOL_NOT_AUTHORIZED|Tool ocr_image not found/
                );
                assert.match(
                  JSON.stringify(body.messages),
                  /CHILD_TOOL_NOT_AUTHORIZED|Tool embed_text not found/
                );
              } else
                assert.match(
                  JSON.stringify(body.messages),
                  kind === 'memory' ? /NOT_FOUND/ : new RegExp(evidence)
                );
              if (kind === 'memory') {
                assert.match(
                  JSON.stringify(body.messages),
                  /CHILD_TOOL_NOT_AUTHORIZED|Tool knowledge_search not found/
                );
              }
              childDone = true;
            }
            completion(res, body.model, calls[childTurns++], evidence);
            return;
          }
          if (slash) {
            completion(res, body.model, undefined, 'Parent received ' + evidence);
            return;
          }
          if (parentTurns++ === 0) {
            completion(res, body.model, {
              name: 'subagent',
              input:
                kind !== 'knowledge'
                  ? {
                      async: background,
                      agent: 'octopus-explorer',
                      model: 'probe/child',
                      acceptance: false,
                      task: 'Call the available delegated tools and return the test evidence.',
                    }
                  : {
                      async: background,
                      workflowScript:
                        'return await runs.all([{key:"retrieval",agent:"octopus-explorer",model:"probe/child",acceptance:false,task:"Retrieve the test knowledge and return its evidence."}]);',
                    },
            });
          } else if (
            background &&
            (!childDone ||
              !JSON.stringify(
                body.messages.filter((message) => message.role !== 'assistant' && message.role !== 'system')
              ).includes(evidence))
          ) {
            completion(res, body.model, undefined, 'Waiting for native child completion notification.');
          } else {
            assert.match(
              JSON.stringify(
                body.messages.filter((message) => message.role !== 'assistant' && message.role !== 'system')
              ),
              new RegExp(evidence)
            );
            completion(res, body.model, undefined, 'Parent received ' + evidence);
          }
        } catch (error) {
          failures.push(String(error.stack));
          res.writeHead(500);
          res.end('test failure');
        }
      });
      await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
      t.after(() => {
        http.closeAllConnections();
        http.close();
      });
      const profile = await knowledgeProfile(agentDir, true);
      await writeFile(
        join(profile.directory, 'endpoint.json'),
        JSON.stringify({
          protocolVersion: 1,
          profileId: profile.profileId,
          daemonId: 'test-daemon',
          port: http.address().port,
        })
      );
      await writeFile(join(profile.directory, 'control-token'), 'isolated-test-token');
      await writeFile(
        join(agentDir, 'models.json'),
        JSON.stringify({
          providers: {
            probe: {
              api: 'openai-completions',
              apiKey: 'local-only',
              baseUrl: `http://127.0.0.1:${http.address().port}/v1`,
              models: ['parent', 'child'].map((id) => ({
                id,
                name: id,
                reasoning: false,
                input: ['text'],
                contextWindow: 32000,
                maxTokens: 1000,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              })),
            },
          },
        })
      );
      await writeFile(
        join(agentDir, 'settings.json'),
        JSON.stringify({ packages: [], retry: { enabled: false }, compaction: { enabled: false } })
      );
      if (restrictedModels && !slash) {
        await writeFile(
          join(agentDir, 'permission-system.json'),
          JSON.stringify({
            policy: { tools: { ocr_image: 'deny', embed_text: 'ask' } },
          })
        );
      }
      const bridgeUrl = new URL('../../dist/extensions/subagent-bridge/index.js', import.meta.url).href;
      const parentEntry = join(root, 'parent.mjs');
      await writeFile(
        parentEntry,
        `import { createSubagentBridgeExtension } from ${JSON.stringify(bridgeUrl)};
import { createPermissionModeService } from ${JSON.stringify(new URL('../../dist/extensions/permission-system/sdk/index.js', import.meta.url).href)};
import { writeFileSync } from 'node:fs';
export default function(pi) {
  if (${slash}) pi.registerCommand('restrict-child-tools', { description: 'Test permission change',
    handler: async () => { writeFileSync(${JSON.stringify(join(agentDir, 'permission-system.json'))}, JSON.stringify({ policy: { tools: { ocr_image: 'deny', embed_text: 'ask' } } })); } });
  const permissionService = createPermissionModeService({ agentDir: ${JSON.stringify(agentDir)} });
  permissionService.setMode('full');
  for (const name of ${JSON.stringify(parentTools)}) {
    pi.registerTool({ name, label: name, description: name, parameters: {type:'object',properties:{}},
      execute: async () => ({content:[{type:'text',text:'parent placeholder'}],details:{}}) });
  }
  pi.on('session_start', () => pi.appendEntry('octopus-knowledge-mode', {version:1, enabled:${!isModels}, collectionIds:['allowed']}));
  createSubagentBridgeExtension({ ...${JSON.stringify({ agentDir, workspaceId: 'workspace-a' })}, permissionService })(pi);
}`
      );
      const cli = join(
        dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))),
        'bundle/cli.js'
      );
      const child = spawn(
        process.execPath,
        [
          cli,
          '--mode',
          'rpc',
          '--no-extensions',
          '--no-skills',
          '-e',
          join(packagePath, 'index.ts'),
          '-e',
          parentEntry,
          '--session',
          join(root, 'parent.jsonl'),
          '--model',
          'probe/parent',
        ],
        {
          cwd: root,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            USERPROFILE: root,
            HOME: root,
            DR_OCTOPUS_CODING_AGENT_DIR: agentDir,
            PI_CODING_AGENT_DIR: agentDir,
            PI_OFFLINE: '1',
            PI_SUBAGENTS_TEMP_ROOT: join(root, 'runs'),
          },
        }
      );
      let stdout = '',
        stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        appendFileSync(join(root, 'rpc.jsonl'), chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
        appendFileSync(join(root, 'stderr.log'), chunk);
      });
      t.after(async () => {
        if (child.exitCode === null) {
          if (process.platform === 'win32') {
            try {
              execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
                windowsHide: true,
                stdio: 'ignore',
              });
            } catch {
              /* Process may already have exited. */
            }
          } else child.kill();
        }
        await writeFile(join(root, 'rpc.jsonl'), stdout);
        await writeFile(join(root, 'stderr.log'), stderr);
      });
      if (slash) {
        child.stdin.write(
          JSON.stringify({ id: 'restrict', type: 'prompt', message: '/restrict-child-tools' }) + '\n'
        );
        const readyDeadline = Date.now() + 30000;
        while (!stdout.includes('"id":"restrict"')) {
          if (Date.now() > readyDeadline || child.exitCode !== null)
            assert.fail(stderr + stdout.slice(-5000));
          await delay(50);
        }
        const message =
          '/run octopus-explorer[model=probe/child] Read the test evidence.' + (background ? ' --bg' : '');
        child.stdin.write(JSON.stringify({ id: 'stale-run', type: 'prompt', message }) + '\n');
        const staleDeadline = Date.now() + 30000;
        while (!stdout.includes('CHILD_SCOPE_STALE')) {
          if (Date.now() > staleDeadline || child.exitCode !== null || childTurns > 0) {
            assert.fail(
              'Stale slash launch must fail before any child model call: ' + stderr + stdout.slice(-5000)
            );
          }
          await delay(50);
        }
        child.stdin.write(JSON.stringify({ id: 'fresh-run', type: 'prompt', message }) + '\n');
      } else {
        child.stdin.write(
          JSON.stringify({
            id: 'prompt',
            type: 'prompt',
            message: 'Delegate the isolated knowledge retrieval.',
          }) + '\n'
        );
      }
      const deadline = Date.now() + 100_000;
      while (!childDone || !stdout.includes(slash ? evidence : 'Parent received ' + evidence)) {
        if (failures.length || Date.now() > deadline || child.exitCode !== null) {
          assert.fail(
            JSON.stringify({ failures, childTurns, parentTurns, stderr, stdout: stdout.slice(-18000) })
          );
        }
        await delay(100);
      }
      assert.deepEqual(failures, []);
      assert.deepEqual(
        requests.map((item) => item.operation),
        isModels
          ? restrictedModels
            ? ['models.rerank']
            : ['models.ocr', 'models.embed', 'models.rerank']
          : kind === 'memory'
            ? []
            : ['collections.get', 'search', 'read']
      );
      for (const menu of childMenus) {
        for (const name of parentTools) {
          assert.equal(menu.includes(name), !restrictedModels || name === 'rerank_documents', name);
        }
        if (!isModels) for (const name of modelTools) assert.equal(menu.includes(name), false);
        assert.equal(menu.includes(kind === 'memory' ? 'knowledge_search' : 'memory_read'), false);
        assert.equal(
          menu.some((name) => /^(scheduler_|workspace_|knowledge_import|memory_remember)/u.test(name)),
          false
        );
      }
      assert.match(stdout, new RegExp(evidence));
    }
  );
}
