/**
 * @author Codex
 * @description 验证 Onboarding SDK 业务闭环、恢复语义与 InlineExtension 注册契约
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import onboardingExtension, {
  createOnboardingExtension,
  createOnboardingService,
} from '../dist/extensions/onboarding/index.js';

/**
 * @description 创建无文件副作用的 Onboarding 测试夹具。
 * @param overrides 依赖覆盖。
 * @returns SDK、状态记录与配置记录。
 */
function createFixture(overrides = {}) {
  const writes = [];
  const models = new Map();
  const runtime = {
    async getProviders() {
      return [{ id: 'anthropic', name: 'Anthropic', authenticated: false, authTypes: ['api_key'] }];
    },
    async getAvailableModels() {
      return [...models.values()];
    },
    async getAuthStatus() {
      return 'unauthenticated';
    },
    async login() {},
    async refresh() {},
    async findModel(providerId, modelId) {
      return models.get(`${providerId}/${modelId}`);
    },
    ...overrides.runtime,
  };
  const sdk = createOnboardingService({
    modelConfig: {
      async upsertLocalProvider(providerId, baseUrl, modelId) {
        writes.push({ providerId, baseUrl, modelId });
        models.set(`${providerId}/${modelId}`, { providerId, modelId });
      },
    },
    settings: {
      async exists() {
        return overrides.settingsExist ?? Boolean(overrides.defaultModel);
      },
      async getDefaultModel() {
        return overrides.defaultModel ?? {};
      },
      async setDefaultModel(providerId, modelId) {
        writes.push({ default: `${providerId}/${modelId}` });
      },
    },
    localProviders: [
      {
        info: { id: 'ollama', name: 'Ollama', defaultBaseUrl: 'http://127.0.0.1:11434' },
        async detect() {
          return { reachable: true, models: [{ id: 'qwen' }] };
        },
      },
    ],
    runtime,
  });
  return { sdk, writes };
}

test('first run requires setup', async () => {
  const { sdk } = createFixture();
  assert.deepEqual(await sdk.getStatus(), {
    ready: false,
    phase: 'setup_required',
    reason: 'FIRST_RUN',
  });
});

test('existing Pi default model is ready when settings.json exists', async () => {
  const fixture = createFixture({
    defaultModel: { providerId: 'anthropic', modelId: 'opus' },
    runtime: {
      async getAuthStatus() {
        return 'authenticated';
      },
      async findModel(providerId, modelId) {
        return providerId === 'anthropic' && modelId === 'opus' ? { providerId, modelId } : undefined;
      },
    },
  });

  assert.deepEqual(await fixture.sdk.getStatus(), {
    ready: true,
    phase: 'ready',
    providerId: 'anthropic',
    modelId: 'opus',
  });
});

test('Pi settings remain the model source when settings.json exists', async () => {
  const fixture = createFixture({
    settingsExist: true,
    defaultModel: { providerId: 'openai', modelId: 'gpt-5' },
    runtime: {
      async getAuthStatus() {
        return 'authenticated';
      },
      async findModel(providerId, modelId) {
        return providerId === 'openai' && modelId === 'gpt-5' ? { providerId, modelId } : undefined;
      },
    },
  });

  assert.deepEqual(await fixture.sdk.getStatus(), {
    ready: true,
    phase: 'ready',
    providerId: 'openai',
    modelId: 'gpt-5',
  });
});

test('existing settings without a Pi default model requires model setup', async () => {
  const fixture = createFixture({
    settingsExist: true,
  });

  assert.equal((await fixture.sdk.getStatus()).reason, 'NO_MODEL');
});

test('configured model without authentication is not ready', async () => {
  const fixture = createFixture({
    defaultModel: { providerId: 'anthropic', modelId: 'opus' },
    runtime: {
      async findModel(providerId, modelId) {
        return { providerId, modelId };
      },
    },
  });

  assert.equal((await fixture.sdk.getStatus()).reason, 'AUTH_MISSING');
});

test('real settings.json existence determines first-run status', async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), 'octopus-onboarding-'));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  const runtime = {
    async getProviders() {
      return [];
    },
    async getAvailableModels() {
      return [];
    },
    async getAuthStatus() {
      return 'authenticated';
    },
    async login() {},
    async refresh() {},
    async findModel(providerId, modelId) {
      return { providerId, modelId };
    },
  };
  const sdk = createOnboardingService({ agentDir, runtime, localProviders: [] });

  assert.equal((await sdk.getStatus()).reason, 'FIRST_RUN');
  await writeFile(
    join(agentDir, 'settings.json'),
    JSON.stringify({ defaultProvider: 'anthropic', defaultModel: 'opus' })
  );
  assert.equal((await sdk.getStatus()).ready, true);
});

test('real Pi runtime restores stored provider authentication', async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), 'octopus-onboarding-'));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  await writeFile(
    join(agentDir, 'settings.json'),
    JSON.stringify({ defaultProvider: 'deepseek', defaultModel: 'deepseek-v4-flash' })
  );
  await writeFile(
    join(agentDir, 'auth.json'),
    JSON.stringify({ deepseek: { type: 'api_key', key: 'test-key' } })
  );

  const status = await createOnboardingService({ agentDir, localProviders: [] }).getStatus();
  assert.equal(status.ready, true);
  assert.equal(status.providerId, 'deepseek');
});

test('local setup writes a Pi models.json provider and no onboarding.json', async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), 'octopus-onboarding-'));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  const fixture = createOnboardingService({
    agentDir,
    settings: {
      async exists() {
        return false;
      },
      async getDefaultModel() {
        return {};
      },
      async setDefaultModel() {},
    },
    runtime: {
      async getProviders() {
        return [];
      },
      async getAvailableModels() {
        return [];
      },
      async getAuthStatus() {
        return 'authenticated';
      },
      async login() {},
      async refresh() {},
      async findModel(providerId, modelId) {
        return { providerId, modelId };
      },
    },
    localProviders: [
      {
        info: { id: 'ollama', name: 'Ollama', defaultBaseUrl: 'http://127.0.0.1:11434' },
        async detect() {
          return { reachable: true, models: [{ id: 'qwen' }] };
        },
      },
    ],
  });

  await fixture.completeLocalSetup({
    runtime: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    modelId: 'qwen',
  });
  const models = JSON.parse(await readFile(join(agentDir, 'models.json'), 'utf8'));
  assert.equal(models.providers['octopus-ollama'].models[0].id, 'qwen');
  await assert.rejects(readFile(join(agentDir, 'onboarding.json'), 'utf8'), { code: 'ENOENT' });
});

test('local setup detects, persists, refreshes, selects default, and becomes ready', async () => {
  const fixture = createFixture();
  const status = await fixture.sdk.completeLocalSetup({
    runtime: 'ollama',
    baseUrl: 'http://127.0.0.1:11434/',
    modelId: 'qwen',
  });
  assert.equal(status.ready, true);
  assert.deepEqual(fixture.writes, [
    { providerId: 'octopus-ollama', baseUrl: 'http://127.0.0.1:11434', modelId: 'qwen' },
    { default: 'octopus-ollama/qwen' },
  ]);
});

test('native setup authenticates and persists the selected model', async () => {
  let authenticated = false;
  const fixture = createFixture({
    runtime: {
      async getAuthStatus() {
        return authenticated ? 'authenticated' : 'unauthenticated';
      },
      async login() {
        authenticated = true;
      },
      async findModel(providerId, modelId) {
        return providerId === 'anthropic' && modelId === 'opus' ? { providerId, modelId } : undefined;
      },
    },
  });
  assert.equal(
    (
      await fixture.sdk.startNativeAuth(
        { providerId: 'anthropic' },
        {
          async prompt() {
            return 'secret';
          },
          notify() {},
        }
      )
    ).authenticated,
    true
  );
  assert.equal(
    (await fixture.sdk.completeNativeSetup({ providerId: 'anthropic', modelId: 'opus' })).ready,
    true
  );
});

test('setup command activates the selected model in the current Pi session', async () => {
  const commands = new Map();
  const selectedModel = { provider: 'anthropic', id: 'opus' };
  createOnboardingExtension({
    async getNativeProviders() {
      return [{ id: 'anthropic', name: 'Anthropic', authenticated: true, authTypes: ['oauth'] }];
    },
    async getAvailableModels() {
      return [{ providerId: 'anthropic', modelId: 'opus' }];
    },
    async completeNativeSetup() {
      return { ready: true, phase: 'ready', providerId: 'anthropic', modelId: 'opus' };
    },
  })({
    on() {},
    registerTool() {},
    async setModel(model) {
      activated = model;
      return true;
    },
    registerCommand(name, definition) {
      commands.set(name, definition);
    },
  });
  const choices = ['Cloud models', 'OAuth', 'Anthropic (anthropic)', 'opus'];
  let activated;
  await commands.get('setup').handler('', {
    hasUI: true,
    ui: {
      async select() {
        return choices.shift();
      },
      notify() {},
    },
    modelRegistry: {
      async refresh() {},
      find() {
        return selectedModel;
      },
    },
    async waitForIdle() {},
  });

  assert.equal(activated, selectedModel);
});

test('cloud setup lets the user choose OAuth when the provider supports multiple auth methods', async () => {
  const commands = new Map();
  const authRequests = [];
  const selectedModel = { provider: 'anthropic', id: 'opus' };
  createOnboardingExtension({
    async getNativeProviders() {
      return [
        {
          id: 'anthropic',
          name: 'Anthropic',
          authenticated: false,
          authTypes: ['api_key', 'oauth'],
        },
      ];
    },
    async startNativeAuth(input) {
      authRequests.push(input);
      return { providerId: input.providerId, authenticated: true };
    },
    async getAvailableModels() {
      return [{ providerId: 'anthropic', modelId: 'opus' }];
    },
    async completeNativeSetup() {
      return { ready: true, phase: 'ready', providerId: 'anthropic', modelId: 'opus' };
    },
  })({
    on() {},
    registerTool() {},
    async setModel() {
      return true;
    },
    registerCommand(name, definition) {
      commands.set(name, definition);
    },
  });
  const choices = ['Cloud models', 'OAuth', 'Anthropic (anthropic)', 'opus'];

  await commands.get('setup').handler('', {
    hasUI: true,
    ui: {
      async select() {
        return choices.shift();
      },
      notify() {},
    },
    modelRegistry: {
      async refresh() {},
      find() {
        return selectedModel;
      },
    },
    async waitForIdle() {},
  });

  assert.deepEqual(authRequests, [{ providerId: 'anthropic', authType: 'oauth' }]);
});

test('cloud setup asks for API Key before a provider that supports only API Key', async () => {
  const commands = new Map();
  const authRequests = [];
  const selectedModel = { provider: 'anthropic', id: 'opus' };
  createOnboardingExtension({
    async getNativeProviders() {
      return [
        {
          id: 'anthropic',
          name: 'Anthropic',
          authenticated: false,
          authTypes: ['api_key'],
        },
      ];
    },
    async startNativeAuth(input) {
      authRequests.push(input);
      return { providerId: input.providerId, authenticated: true };
    },
    async getAvailableModels() {
      return [{ providerId: 'anthropic', modelId: 'opus' }];
    },
    async completeNativeSetup() {
      return { ready: true, phase: 'ready', providerId: 'anthropic', modelId: 'opus' };
    },
  })({
    on() {},
    registerTool() {},
    async setModel() {
      return true;
    },
    registerCommand(name, definition) {
      commands.set(name, definition);
    },
  });
  const choices = ['Cloud models', 'API Key', 'Anthropic (anthropic)', 'opus'];

  await commands.get('setup').handler('', {
    hasUI: true,
    ui: {
      async select() {
        return choices.shift();
      },
      notify() {},
    },
    modelRegistry: {
      async refresh() {},
      find() {
        return selectedModel;
      },
    },
    async waitForIdle() {},
  });

  assert.deepEqual(authRequests, [{ providerId: 'anthropic', authType: 'api_key' }]);
});

test('local setup uses the runtime default base URL when input is empty', async () => {
  const commands = new Map();
  let detectedBaseUrl;
  let inputTitle;
  createOnboardingExtension({
    getLocalRuntimes() {
      return [{ id: 'ollama', name: 'Ollama', defaultBaseUrl: 'http://127.0.0.1:11434' }];
    },
    async detectLocalRuntime(input) {
      detectedBaseUrl = input.baseUrl;
      return { reachable: true, models: [{ id: 'qwen' }] };
    },
    async completeLocalSetup(input) {
      return {
        ready: true,
        phase: 'ready',
        providerId: 'octopus-ollama',
        modelId: input.modelId,
      };
    },
  })({
    on() {},
    registerTool() {},
    async setModel() {
      return true;
    },
    registerCommand(name, definition) {
      commands.set(name, definition);
    },
  });
  const choices = ['Local models', 'Ollama', 'qwen'];
  await commands.get('setup').handler('', {
    hasUI: true,
    ui: {
      async select() {
        return choices.shift();
      },
      async input(title) {
        inputTitle = title;
        return '';
      },
      notify() {},
    },
    modelRegistry: {
      async refresh() {},
      find() {
        return { provider: 'octopus-ollama', id: 'qwen' };
      },
    },
    async waitForIdle() {},
  });

  assert.equal(detectedBaseUrl, 'http://127.0.0.1:11434');
  assert.equal(inputTitle, 'Ollama base URL (press Enter for http://127.0.0.1:11434)');
});

test('startup status failures degrade to a warning', async () => {
  let sessionStart;
  const notifications = [];
  createOnboardingExtension({
    async getStatus() {
      throw new Error('invalid settings.json');
    },
  })({
    on(name, handler) {
      if (name === 'session_start') sessionStart = handler;
    },
    registerCommand() {},
    registerTool() {},
  });

  await sessionStart(
    { reason: 'startup' },
    { hasUI: true, ui: { notify: (...args) => notifications.push(args) } }
  );
  assert.deepEqual(notifications, [['Unable to check model setup: invalid settings.json', 'warning']]);
});

test('startup automatically runs interactive setup when a model is required', async () => {
  let sessionStart;
  let activated;
  const selectedModel = { provider: 'anthropic', id: 'opus' };
  const choices = ['Cloud models', 'OAuth', 'Anthropic (anthropic)', 'opus'];
  createOnboardingExtension({
    async getStatus() {
      return { ready: false, phase: 'setup_required', reason: 'FIRST_RUN' };
    },
    async getNativeProviders() {
      return [{ id: 'anthropic', name: 'Anthropic', authenticated: true, authTypes: ['oauth'] }];
    },
    async getAvailableModels() {
      return [{ providerId: 'anthropic', modelId: 'opus' }];
    },
    async completeNativeSetup() {
      return { ready: true, phase: 'ready', providerId: 'anthropic', modelId: 'opus' };
    },
  })({
    on(name, handler) {
      if (name === 'session_start') sessionStart = handler;
    },
    registerCommand() {},
    registerTool() {},
    async setModel(model) {
      activated = model;
      return true;
    },
  });

  await sessionStart(
    { reason: 'startup' },
    {
      mode: 'tui',
      hasUI: true,
      ui: {
        async custom() {
          return choices.shift();
        },
        async select() {
          return choices.shift();
        },
        notify() {},
      },
      modelRegistry: {
        async refresh() {},
        find() {
          return selectedModel;
        },
      },
    }
  );

  assert.equal(activated, selectedModel);
});

test('startup does not run interactive setup without dialog UI', async () => {
  let sessionStart;
  let setupStarted = false;
  createOnboardingExtension({
    async getStatus() {
      return { ready: false, phase: 'setup_required', reason: 'NO_MODEL' };
    },
    async getNativeProviders() {
      setupStarted = true;
      return [];
    },
  })({
    on(name, handler) {
      if (name === 'session_start') sessionStart = handler;
    },
    registerCommand() {},
    registerTool() {},
  });

  await sessionStart({ reason: 'startup' }, { hasUI: false, ui: {} });

  assert.equal(setupStarted, false);
});

test('RPC startup never blocks readiness on interactive model setup', async () => {
  let sessionStart;
  let setupStarted = false;
  createOnboardingExtension({
    async getStatus() {
      return { ready: false, phase: 'setup_required', reason: 'FIRST_RUN' };
    },
    async getNativeProviders() {
      setupStarted = true;
      return [];
    },
  })({
    on(name, handler) {
      if (name === 'session_start') sessionStart = handler;
    },
    registerCommand() {},
    registerTool() {},
  });

  await sessionStart({ reason: 'startup' }, { mode: 'rpc', hasUI: true, ui: { notify() {} } });

  assert.equal(setupStarted, false);
});

test('extension registers lifecycle, commands, and read-only tools', () => {
  const events = [];
  const commands = [];
  const tools = [];
  onboardingExtension({
    on(name) {
      events.push(name);
    },
    registerCommand(name) {
      commands.push(name);
    },
    registerTool(definition) {
      tools.push(definition.name);
    },
  });
  assert.deepEqual(events, ['session_start']);
  assert.deepEqual(commands, ['setup', 'octopus-model']);
  assert.deepEqual(tools, ['octopus_model_status', 'octopus_check_local_runtime']);
});
