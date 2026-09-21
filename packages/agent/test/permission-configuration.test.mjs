/**
 * @author Codex
 * @description Exercises overlay persistence, invalid reloads and declarative tool scopes through the real permission runtime.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  PermissionConfigurationStore,
  createPermissionModeService,
  createPermissionSystemExtension,
} from '../dist/extensions/permission-system/index.js';
import { normalizePermissionRequest } from '../dist/extensions/permission-system/services/permission-request.js';

/**
 * Isolate every configuration layer and remove only this test's temporary directory.
 */
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'octopus-permission-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agentDir = join(root, 'agent');
  const cwd = join(root, 'workspace');
  await mkdir(agentDir);
  await mkdir(cwd);
  return { root, agentDir, cwd, store: new PermissionConfigurationStore(agentDir, '.pi') };
}

test('settings persists only overlays, checks inherited revisions and restores inheritance', async (t) => {
  const { store, cwd, agentDir } = await fixture(t);
  const global = store.get();
  assert.deepEqual(global.overrides, {});
  const workspaceBefore = store.get(cwd);
  const saved = await store.update({
    revision: global.revision,
    config: { policy: { tools: { demo: 'deny' } } },
  });
  assert.equal(store.get(cwd).effective.policy.tools.demo, 'deny');
  assert.equal(store.get(cwd).inherited.policy.tools.demo, 'deny');
  assert.deepEqual(JSON.parse(await readFile(join(agentDir, 'permission-system.json'), 'utf8')), {
    version: 2,
    policy: { tools: { demo: 'deny' } },
  });
  await assert.rejects(store.update({ revision: workspaceBefore.revision, config: {} }, cwd), {
    code: 'PERMISSION_CONFIG_CONFLICT',
  });
  const local = await store.update(
    {
      revision: store.get(cwd).revision,
      config: { policy: { tools: { demo: 'ask' } }, toolRules: { demo: { kind: 'read' }, read: null } },
    },
    cwd
  );
  assert.equal(local.effective.policy.tools.demo, 'ask');
  assert.equal(local.effective.toolRules.read, undefined);
  assert.equal(store.get().effective.policy.tools.demo, 'deny');
  const service = createPermissionModeService({ agentDir, configDirName: '.pi' });
  assert.equal(service.reloadPolicy(cwd, false).policy.tools.demo, 'deny');
  assert.equal(service.reloadPolicy(cwd, true).policy.tools.demo, 'ask');
  const reset = await store.update({ revision: local.revision, config: {} }, cwd);
  assert.equal(reset.effective.policy.tools.demo, 'deny');
  await assert.rejects(store.update({ revision: global.revision, config: {} }), {
    code: 'PERMISSION_CONFIG_CONFLICT',
  });
  assert.equal(store.get().revision, saved.revision);
});

test('malformed and empty files block runtime execution, remain repairable and never restore old grants', async (t) => {
  const { store, agentDir, cwd } = await fixture(t);
  const service = createPermissionModeService({ agentDir });
  service.reloadPolicy(cwd, false);
  const request = {
    toolName: 'write',
    kind: 'write',
    external: false,
    sensitive: false,
    sessionApprovalKey: 'scope',
  };
  service.recordSessionApproval('scope');
  assert.equal(service.decide(request), 'allow');
  const valid = service.getConfiguration();
  await writeFile(join(agentDir, 'permission-system.json'), '');
  assert.equal(service.reloadPolicy(cwd, false).diagnostics.length, 1);
  assert.equal(service.decide(request), 'deny');
  assert.deepEqual(service.getConfiguration(), valid);
  assert.throws(() => createPermissionModeService({ agentDir }), { code: 'PERMISSION_CONFIG_INVALID' });
  const broken = store.get();
  assert.equal(broken.effective, null);
  await store.update({ revision: broken.revision, config: {} });
  service.reloadPolicy(cwd, false);
  assert.equal(service.decide(request), 'ask');
  service.recordSessionApproval('scope');
  await store.update({
    revision: store.get().revision,
    config: { modes: { ask: { tools: { write: 'deny' } } } },
  });
  service.reloadPolicy(cwd, false);
  assert.equal(service.decide(request), 'deny');
  service.setMode('full');
  assert.equal(service.decide({ ...request, sensitive: true }), 'deny');
});

test('custom tool fields check every target and command while missing scopes cannot broaden approval', async (t) => {
  const { store, agentDir, cwd } = await fixture(t);
  await store.update({
    revision: store.get().revision,
    config: {
      toolRules: {
        plugin_import: {
          kind: 'write',
          pathFields: ['payload.files'],
          commandFields: ['payload.exec'],
          sessionApproval: { fields: ['collectionId'] },
        },
      },
    },
  });
  const config = createPermissionModeService({ agentDir }).getConfiguration();
  const normalize = (input) => normalizePermissionRequest('plugin_import', input, cwd, config);
  assert.equal(
    normalize({ collectionId: 'a', payload: { files: ['src/a', '../private/b'] } }).request.external,
    true
  );
  assert.equal(
    normalize({ collectionId: 'a', payload: { exec: 'sudo cat /etc/passwd' } }).request.sensitive,
    true
  );
  assert.equal(normalize({ collectionId: 'a', payload: { files: ['.env'] } }).request.sensitive, true);
  const a = normalize({ collectionId: 'a', payload: { files: ['src/a'] } });
  const b = normalize({ collectionId: 'b', payload: { files: ['src/a'] } });
  assert.notEqual(a.request.sessionApprovalKey, b.request.sessionApprovalKey);
  const missing = normalize({ payload: { files: ['src/a'] } });
  assert.equal(missing.request.sessionApprovalKey, undefined);
  assert.equal(missing.sessionLabel, undefined);
  assert.equal(normalizePermissionRequest('unknown', {}, cwd, config).request.kind, 'custom');
  const shellA = normalizePermissionRequest('bash', { command: 'git status' }, cwd, config);
  const shellB = normalizePermissionRequest('bash', { command: 'git status; dangerous-action' }, cwd, config);
  assert.notEqual(shellA.request.sessionApprovalKey, shellB.request.sessionApprovalKey);
  const knowledgeA = normalizePermissionRequest('knowledge_add_text', { collectionId: 'a' }, cwd, config);
  const knowledgeB = normalizePermissionRequest('knowledge_add_text', { collectionId: 'b' }, cwd, config);
  assert.notEqual(knowledgeA.request.sessionApprovalKey, knowledgeB.request.sessionApprovalKey);
  await assert.rejects(
    store.update({
      revision: store.get().revision,
      config: { toolRules: { bad: { kind: 'write', pathFields: ['__proto__.path'] } } },
    }),
    { code: 'PERMISSION_CONFIG_INVALID' }
  );
});

test('tool gates reload on each call and reject approvals obtained against a stale configuration', async (t) => {
  const { store, agentDir, cwd } = await fixture(t);
  const service = createPermissionModeService({ agentDir });
  const events = new Map();
  createPermissionSystemExtension(service)({
    registerCommand() {},
    registerTool() {},
    on(name, handler) {
      events.set(name, handler);
    },
  });
  let prompts = 0;
  const ctx = {
    cwd,
    isProjectTrusted: () => false,
    hasUI: true,
    ui: {
      select: async () => {
        prompts += 1;
        await store.update({
          revision: store.get().revision,
          config: { policy: { tools: { write: 'deny' } } },
        });
        return 'Yes';
      },
      input: async () => undefined,
    },
  };
  const event = { type: 'tool_call', toolCallId: 'demo', toolName: 'write', input: { path: 'a.txt' } };
  const stale = await events.get('tool_call')(event, ctx);
  assert.equal(stale.block, true);
  assert.match(stale.reason, /changed while awaiting approval/);
  assert.equal((await events.get('tool_call')(event, ctx)).block, true);
  assert.equal(prompts, 1);
});

test('external path rules cannot weaken configured type restrictions or explicit asks', async (t) => {
  const { store, agentDir } = await fixture(t);
  await store.update({
    revision: store.get().revision,
    config: { modes: { full: { kinds: { read: 'deny', shell: 'ask' }, external: 'allow' } } },
  });
  const service = createPermissionModeService({ agentDir });
  service.setMode('full');
  service.recordSessionApproval('old-scope');
  assert.equal(
    service.decide({
      toolName: 'read',
      kind: 'read',
      external: true,
      sensitive: false,
      sessionApprovalKey: 'old-scope',
    }),
    'deny'
  );
  assert.equal(service.decide({ toolName: 'bash', kind: 'shell', external: true, sensitive: false }), 'ask');
});
