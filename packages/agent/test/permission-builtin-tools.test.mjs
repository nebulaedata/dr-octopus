/**
 * @author Codex
 * @description Verifies bundled tool permissions through request normalization, mode evaluation and user overrides.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPermissionModeService } from '../dist/extensions/permission-system/index.js';
import { normalizePermissionRequest } from '../dist/extensions/permission-system/services/permission-request.js';

const readTools = [
  'fetch_content',
  'ctx_search',
  'ctx_stats',
  'ctx_doctor',
  'memory_recall',
  'memory_read',
  'workspace_current',
  'octopus_model_status',
  'octopus_check_local_runtime',
  'web_search',
  'source_check',
  'get_search_content',
  'scheduler_list',
  'scheduler_get',
  'scheduler_history',
];
const mutationTools = [
  'ctx_index',
  'ctx_fetch_and_index',
  'ctx_purge',
  'scheduler_create',
  'scheduler_update',
  'scheduler_delete',
  'scheduler_run_now',
  'scheduler_cancel',
  'goal_complete',
  'goal_blocked',
  'goal_wait',
  'subagent_supervisor',
  'contact_supervisor',
];

/**
 * Isolate configuration overlays and normalize requests with the shipped runtime configuration.
 */
async function fixture(t) {
  const agentDir = await mkdtemp(join(tmpdir(), 'octopus-builtin-permissions-'));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  const service = createPermissionModeService({ agentDir });
  const cwd = join(agentDir, 'workspace');
  const request = (name, input = {}) =>
    normalizePermissionRequest(name, input, cwd, service.getConfiguration()).request;
  return { service, request, agentDir, cwd };
}

test('bundled extension tools have explicit descriptors and auto decisions', async (t) => {
  const { service, request } = await fixture(t);
  const config = service.getConfiguration();
  const files = [
    'memory/extension/tools.ts',
    'workspace/extension/tools.ts',
    'onboarding/extension/tools.ts',
    'scheduler/extension/tools.ts',
    'knowledge/extension/tools.ts',
    'knowledge/sdk/tools.ts',
    'permission-system/extension/tools.ts',
  ];
  service.setMode('auto');
  for (const file of files) {
    const source = await readFile(new URL(`../src/extensions/${file}`, import.meta.url), 'utf8');
    for (const [, name] of source.matchAll(/\bname: '([^']+)'/g)) {
      assert.ok(config.toolRules[name], `${name} must declare its permission kind`);
      assert.equal(service.decide(request(name)), 'allow', name);
    }
  }
  for (const name of [...readTools, ...mutationTools]) {
    assert.equal(config.modes.auto.tools[name], 'allow', name);
    assert.equal(service.decide(request(name)), 'allow', name);
  }
  for (const name of Object.keys(config.modes.auto.tools)) {
    assert.ok(config.toolRules[name], `${name} must declare its permission kind`);
  }
  for (const name of ['mcp', 'mcpScript', 'unknown_plugin_tool', 'scheduler_unknown']) {
    assert.equal(service.decide(request(name)), 'ask', name);
  }
  service.setMode('ask');
  for (const name of readTools) assert.equal(service.decide(request(name)), 'allow', name);
  for (const name of mutationTools) assert.equal(service.decide(request(name)), 'ask', name);
});

test('context execute tools use the shell kind', async (t) => {
  const { service } = await fixture(t);
  const config = service.getConfiguration();
  for (const name of ['ctx_batch_execute', 'ctx_execute', 'ctx_execute_file']) {
    assert.equal(config.toolRules[name]?.kind, 'shell', name);
  }
});

test('auto grants retain external checks, hard denies and user policy precedence', async (t) => {
  const { service, request, agentDir, cwd } = await fixture(t);
  service.setMode('auto');
  assert.equal(service.decide(request('scheduler_create', { cwd: '../elsewhere' })), 'ask');
  assert.equal(service.decide(request('fetch_content', { path: '.env' })), 'deny');
  await writeFile(
    join(agentDir, 'permission-system.json'),
    JSON.stringify({
      version: 2,
      policy: { tools: { web_search: 'deny', scheduler_delete: 'ask' } },
      modes: { auto: { tools: { goal_complete: 'deny' } } },
    })
  );
  assert.deepEqual(service.reloadPolicy(cwd, false).diagnostics, []);
  assert.equal(service.decide(request('web_search')), 'deny');
  assert.equal(service.decide(request('scheduler_delete')), 'ask');
  assert.equal(service.decide(request('goal_complete')), 'deny');
  assert.equal(service.decide(request('scheduler_list')), 'allow');
});
