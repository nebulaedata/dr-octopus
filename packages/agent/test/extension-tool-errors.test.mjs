/**
 * @author Codex
 * @description Verifies legacy Workspace and Onboarding tools expose failures through Pi's thrown-error contract.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerWorkspaceTool } from '../dist/extensions/workspace/extension/tools.js';
import { registerOnboardingTools } from '../dist/extensions/onboarding/extension/tools.js';

/**
 * Capture public tool registrations without starting Pi, accessing user settings or calling a model.
 */
function toolsFor(register, service) {
  const tools = new Map();
  register({ registerTool: (tool) => tools.set(tool.name, tool) }, service);
  return tools;
}

test('workspace_current returns the selected Workspace and rejects an unmanaged cwd', async () => {
  const workspace = { id: 'general', name: 'General', cwd: process.cwd() };
  let workspaces = [workspace];
  const tool = toolsFor(registerWorkspaceTool, {
    async list() {
      return workspaces;
    },
  }).get('workspace_current');
  const execute = () => tool.execute('current', {}, undefined, undefined, { cwd: workspace.cwd });
  const result = await execute();
  assert.deepEqual(result.details, { workspace });
  assert.match(result.content[0].text, /General/u);
  assert.equal(Object.hasOwn(result, 'isError'), false);
  workspaces = [];
  await assert.rejects(execute(), /not a managed Octopus Workspace/u);
});

test('octopus_model_status preserves ready results and throws for every not-ready reason', async () => {
  let status = { ready: true, phase: 'ready', providerId: 'local', modelId: 'model' };
  const tool = toolsFor(registerOnboardingTools, {
    async getStatus() {
      return status;
    },
  }).get('octopus_model_status');
  const result = await tool.execute('ready', {});
  assert.deepEqual(result.details, { status });
  assert.equal(result.content[0].text, 'Ready: local/model');
  assert.equal(Object.hasOwn(result, 'isError'), false);
  for (const reason of ['FIRST_RUN', 'NO_MODEL', 'AUTH_MISSING', 'MODEL_REMOVED']) {
    status = { ready: false, phase: 'setup_required', reason };
    await assert.rejects(tool.execute('not-ready', {}), {
      name: 'OnboardingError',
      code: reason,
      message: 'Model is not ready: ' + reason + '. Configure the default model and authentication.',
    });
  }
  status = { ready: false, phase: 'checking' };
  await assert.rejects(tool.execute('checking', {}), { code: 'MODEL_NOT_READY' });
});

test('local runtime checks distinguish reachable empty catalogs from unreachable endpoints', async () => {
  let detection = { reachable: true, models: [{ id: 'model' }] };
  const tool = toolsFor(registerOnboardingTools, {
    async detectLocalRuntime() {
      return detection;
    },
  }).get('octopus_check_local_runtime');
  const params = { runtime: 'ollama', baseUrl: 'http://127.0.0.1:11434' };
  const result = await tool.execute('reachable', params);
  assert.deepEqual(result.details, detection);
  assert.equal(result.content[0].text, 'Reachable; models: model');
  assert.equal(Object.hasOwn(result, 'isError'), false);
  detection = { reachable: true, models: [] };
  assert.equal((await tool.execute('empty', params)).content[0].text, 'Reachable; models: (none)');
  detection = { reachable: false, models: [] };
  await assert.rejects(tool.execute('offline', params), {
    name: 'OnboardingError',
    code: 'LOCAL_RUNTIME_OFFLINE',
    message: 'The local runtime is not reachable. Start it and try again.',
  });
});

test('local runtime checks forward cancellation without turning it into a successful result', async () => {
  const controller = new AbortController();
  const cancelled = new Error('Detection cancelled');
  controller.abort(cancelled);
  const params = { runtime: 'ollama', baseUrl: 'http://127.0.0.1:11434' };
  const tool = toolsFor(registerOnboardingTools, {
    async detectLocalRuntime(input) {
      assert.deepEqual(input, { ...params, signal: controller.signal });
      input.signal.throwIfAborted();
    },
  }).get('octopus_check_local_runtime');
  await assert.rejects(tool.execute('cancelled', params, controller.signal), (error) => error === cancelled);
});

test('Workspace and Onboarding tools propagate service failures instead of returning success text', async () => {
  const failure = new Error('Service unavailable');
  const workspace = toolsFor(registerWorkspaceTool, {
    async list() {
      throw failure;
    },
  }).get('workspace_current');
  await assert.rejects(
    workspace.execute('failed', {}, undefined, undefined, { cwd: process.cwd() }),
    (error) => error === failure
  );
  const onboarding = toolsFor(registerOnboardingTools, {
    async getStatus() {
      throw failure;
    },
    async detectLocalRuntime() {
      throw failure;
    },
  });
  for (const tool of onboarding.values()) {
    await assert.rejects(tool.execute('failed', {}), (error) => error === failure);
  }
});
