/**
 * @author Codex
 * @description 验证默认 Pi 扩展环境的缺失检测、补装持久化与离线降级结果。
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DefaultPackageManager, SettingsManager } from '@earendil-works/pi-coding-agent';

import {
  EXTENSION_SOURCES,
  applyContextModeMcpEnvironment,
  ensureContextModeMcpConfigured,
  ensureExtensionsInstalled,
  getExtensionInstallationStatus,
  isContextModeMcpConfigured,
  isExtensionRegistryAvailable,
} from '../dist/utils/index.js';

/**
 * 创建不访问真实 Pi 用户目录的扩展环境依赖。
 *
 * @param configured 当前已配置扩展。
 * @param install 执行缺失扩展安装的替身。
 * @returns 包管理器、设置管理器及其调用记录。
 */
function createDependencies(configured, install = async () => undefined) {
  const installs = [];
  let flushes = 0;
  return {
    installs,
    get flushes() {
      return flushes;
    },
    packageManager: {
      listConfiguredPackages() {
        return configured;
      },
      async installAndPersist(source) {
        installs.push(source);
        await install(source);
      },
    },
    settingsManager: {
      async flush() {
        flushes += 1;
      },
    },
  };
}

/**
 * 创建带真实 package.json 版本的临时扩展安装目录。
 *
 * @param version 模拟的实际安装版本。
 * @returns 临时扩展目录。
 */
async function createInstalledPackage(version) {
  const packageDir = await mkdtemp(join(tmpdir(), 'octopus-installed-extension-'));
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({ version }), 'utf8');
  return packageDir;
}

/**
 * 仅允许不依赖 Host 适配契约的扩展跟随普通 bulk update。
 */
test('keeps only host-independent extensions unpinned', () => {
  const unpinnedSources = ['npm:pi-web-access'];

  for (const source of unpinnedSources) {
    assert.equal(EXTENSION_SOURCES.includes(source), true);
  }
  assert.equal(EXTENSION_SOURCES.includes('npm:@narumitw/pi-goal@0.54.3'), true);
  assert.equal(EXTENSION_SOURCES.length, 7);
  assert.equal(EXTENSION_SOURCES.filter((source) => !source.match(/@\d+\.\d+\.\d+$/)).length, 1);
});

/**
 * 已配置且安装目录存在时不重复访问包注册表。
 */
test('skips extensions only when the configured exact version is installed', async () => {
  const installedPath = await createInstalledPackage('1.2.3');
  const dependencies = createDependencies([
    {
      source: 'npm:pi-web-access@1.2.3',
      scope: 'user',
      filtered: false,
      installedPath,
    },
  ]);

  try {
    const result = await ensureExtensionsInstalled({
      sources: ['npm:pi-web-access@1.2.3'],
      packageManager: dependencies.packageManager,
      settingsManager: dependencies.settingsManager,
    });

    assert.deepEqual(result, {
      alreadyInstalled: ['npm:pi-web-access@1.2.3'],
      installed: [],
      failures: [],
    });
    assert.deepEqual(dependencies.installs, []);
    assert.equal(dependencies.flushes, 0);
  } finally {
    await rm(installedPath, { recursive: true, force: true });
  }
});

/**
 * 只读检查会区分已有与缺失扩展，不触发安装或持久化。
 */
test('reports extension installation status without mutation', async () => {
  const installedPath = await createInstalledPackage('1.2.3');
  const dependencies = createDependencies([
    {
      source: 'npm:pi-web-access@1.2.3',
      scope: 'user',
      filtered: false,
      installedPath,
    },
  ]);

  try {
    const result = getExtensionInstallationStatus({
      sources: ['npm:pi-web-access@1.2.3', 'npm:pi-subagents@2.0.0'],
      packageManager: dependencies.packageManager,
      settingsManager: dependencies.settingsManager,
    });

    assert.deepEqual(result, {
      installed: ['npm:pi-web-access@1.2.3'],
      missing: ['npm:pi-subagents@2.0.0'],
    });
    assert.deepEqual(dependencies.installs, []);
    assert.equal(dependencies.flushes, 0);
  } finally {
    await rm(installedPath, { recursive: true, force: true });
  }
});

/**
 * settings source 正确但磁盘实际版本错位时仍必须重装固定版本。
 */
test('reinstalls when the installed package version differs from the pinned source', async () => {
  const installedPath = await createInstalledPackage('27.0.1');
  const source = 'npm:@example/pinned-extension@27.1.1';
  const dependencies = createDependencies([
    {
      source,
      scope: 'user',
      filtered: false,
      installedPath,
    },
  ]);

  try {
    const result = await ensureExtensionsInstalled({
      sources: [source],
      packageManager: dependencies.packageManager,
      settingsManager: dependencies.settingsManager,
    });

    assert.deepEqual(result, {
      alreadyInstalled: [],
      installed: [source],
      failures: [],
    });
    assert.deepEqual(dependencies.installs, [source]);
    assert.equal(dependencies.flushes, 1);
  } finally {
    await rm(installedPath, { recursive: true, force: true });
  }
});

/**
 * 无版本配置和其他版本都必须重装为项目锁定版本。
 */
test('reinstalls unversioned and mismatched extension sources', async () => {
  const dependencies = createDependencies([
    {
      source: 'npm:pi-subagents',
      scope: 'user',
      filtered: false,
      installedPath: '/agent/npm/node_modules/pi-subagents',
    },
    {
      source: 'npm:@example/pinned-extension@27.0.1',
      scope: 'user',
      filtered: false,
      installedPath: '/agent/npm/node_modules/@example/pinned-extension',
    },
  ]);
  const sources = ['npm:pi-subagents@0.58.0', 'npm:@example/pinned-extension@27.1.1'];

  const result = await ensureExtensionsInstalled({
    sources,
    packageManager: dependencies.packageManager,
    settingsManager: dependencies.settingsManager,
  });

  assert.deepEqual(result, {
    alreadyInstalled: [],
    installed: sources,
    failures: [],
  });
  assert.deepEqual(dependencies.installs, sources);
  assert.equal(dependencies.flushes, 2);
});

/**
 * 使用真实 Pi settings 管理器验证重装后磁盘配置保留精确版本 source，且 bulk update 跳过固定版本。
 */
test('persists the exact versioned source and excludes it from bulk updates', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'octopus-extension-settings-'));
  const workspaceDir = join(temporaryRoot, 'workspace');
  const agentDir = join(temporaryRoot, 'agent');
  const settingsManager = SettingsManager.create(workspaceDir, agentDir, { projectTrusted: false });
  settingsManager.setPackages(['npm:@example/pinned-extension']);
  await settingsManager.flush();

  /**
   * 跳过真实 npm 下载，只验证 Pi 包管理器的 source 替换与持久化契约。
   */
  class SettingsOnlyPackageManager extends DefaultPackageManager {
    bulkUpdates = 0;

    /**
     * 将安装阶段收敛为空操作，避免测试访问 npm Registry。
     *
     * @returns 已完成的 Promise。
     */
    async install() {}

    /**
     * 记录 Pi 是否错误地将固定版本纳入 npm bulk update。
     *
     * @returns 已完成的 Promise。
     */
    async updateNpmBatch() {
      this.bulkUpdates += 1;
    }
  }

  const packageManager = new SettingsOnlyPackageManager({
    cwd: workspaceDir,
    agentDir,
    settingsManager,
  });
  const source = 'npm:@example/pinned-extension@27.1.1';

  try {
    const result = await ensureExtensionsInstalled({
      sources: [source],
      packageManager,
      settingsManager,
    });
    await packageManager.update();
    const settings = JSON.parse(await readFile(join(agentDir, 'settings.json'), 'utf8'));

    assert.deepEqual(result.installed, [source]);
    assert.deepEqual(settings.packages, [source]);
    assert.equal(packageManager.bulkUpdates, 0);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

/**
 * Registry 探测将成功响应视为在线，并将网络异常安全降级为离线。
 */
test('checks extension registry availability without throwing', async () => {
  let requestedUrl;
  const online = await isExtensionRegistryAvailable({
    registryUrl: 'https://registry.example.test/custom',
    fetchImpl: async (input) => {
      requestedUrl = String(input);
      return { ok: true };
    },
  });
  const offline = await isExtensionRegistryAvailable({
    fetchImpl: async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    },
  });
  const invalidRegistry = await isExtensionRegistryAvailable({ registryUrl: 'not a URL' });

  assert.equal(online, true);
  assert.equal(requestedUrl, 'https://registry.example.test/custom/-/ping');
  assert.equal(offline, false);
  assert.equal(invalidRegistry, false);
});

/**
 * context-mode 安装完成后会自动补充用户级 MCP server 配置。
 */
test('configures the context-mode MCP server after installation', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'octopus-context-mode-mcp-'));
  const agentDir = join(temporaryRoot, 'agent');
  const dependencies = createDependencies([]);
  const source = 'npm:context-mode@1.0.169';

  try {
    const result = await ensureExtensionsInstalled({
      agentDir,
      sources: [source],
      packageManager: dependencies.packageManager,
      settingsManager: dependencies.settingsManager,
    });
    const config = JSON.parse(await readFile(join(agentDir, 'mcp.json'), 'utf8'));

    assert.deepEqual(result, {
      alreadyInstalled: [],
      installed: [source],
      failures: [],
    });
    assert.deepEqual(config, {
      mcpServers: {
        'context-mode': {
          command: 'context-mode',
          env: {
            CONTEXT_MODE_DATA_DIR: temporaryRoot,
            CONTEXT_MODE_DIR: join(temporaryRoot, 'context-mode'),
          },
        },
      },
    });
    assert.equal(await isContextModeMcpConfigured(agentDir), true);
    const agentEnv = {};
    assert.equal(await applyContextModeMcpEnvironment(agentDir, agentEnv), true);
    assert.deepEqual(agentEnv, {
      CONTEXT_MODE_DATA_DIR: temporaryRoot,
      CONTEXT_MODE_DIR: join(temporaryRoot, 'context-mode'),
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

/**
 * 自动配置必须保留其他 MCP server，并尊重用户已有的 context-mode 自定义项。
 */
test('merges MCP configuration and preserves a custom context-mode server', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'octopus-context-mode-existing-'));
  const agentDir = join(temporaryRoot, 'agent');
  const configPath = join(agentDir, 'mcp.json');
  const existingConfig = {
    metadata: { owner: 'user' },
    mcpServers: {
      existing: { command: 'existing-server' },
    },
  };
  const customContextModeConfig = {
    ...existingConfig,
    mcpServers: {
      ...existingConfig.mcpServers,
      'context-mode': {
        command: 'npx',
        args: ['-y', 'context-mode'],
      },
    },
  };
  await mkdir(agentDir, { recursive: true });
  await writeFile(configPath, JSON.stringify(existingConfig), 'utf8');

  try {
    const added = await ensureContextModeMcpConfigured(agentDir);
    const mergedConfig = JSON.parse(await readFile(configPath, 'utf8'));
    await writeFile(configPath, JSON.stringify(customContextModeConfig), 'utf8');
    const changedCustomConfig = await ensureContextModeMcpConfigured(agentDir);
    const preservedConfig = JSON.parse(await readFile(configPath, 'utf8'));

    assert.equal(added, true);
    assert.deepEqual(mergedConfig, {
      ...existingConfig,
      mcpServers: {
        ...existingConfig.mcpServers,
        'context-mode': {
          command: 'context-mode',
          env: {
            CONTEXT_MODE_DATA_DIR: temporaryRoot,
            CONTEXT_MODE_DIR: join(temporaryRoot, 'context-mode'),
          },
        },
      },
    });
    assert.equal(changedCustomConfig, false);
    assert.deepEqual(preservedConfig, customContextModeConfig);
    assert.equal(await isContextModeMcpConfigured(agentDir), true);
    assert.equal(await applyContextModeMcpEnvironment(agentDir, {}), false);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

/**
 * 缺失扩展会被逐个安装，并在每次成功后立即持久化。
 */
test('installs and persists only missing extensions', async () => {
  const dependencies = createDependencies([]);
  const sources = ['npm:pi-web-access', 'npm:@narumitw/pi-plan-mode'];

  const result = await ensureExtensionsInstalled({
    sources,
    packageManager: dependencies.packageManager,
    settingsManager: dependencies.settingsManager,
  });

  assert.deepEqual(result, {
    alreadyInstalled: [],
    installed: sources,
    failures: [],
  });
  assert.deepEqual(dependencies.installs, sources);
  assert.equal(dependencies.flushes, 2);
});

/**
 * 自动补装在包管理器调用期间静默 npm，并在完成后恢复宿主环境。
 */
test('silences npm output while ensuring missing extensions', async () => {
  const previousNpmLogLevel = process.env.NPM_CONFIG_LOGLEVEL;
  process.env.NPM_CONFIG_LOGLEVEL = 'warn';
  const observedLogLevels = [];
  const dependencies = createDependencies([], async () => {
    observedLogLevels.push(process.env.NPM_CONFIG_LOGLEVEL);
  });

  try {
    await ensureExtensionsInstalled({
      sources: ['npm:pi-web-access'],
      packageManager: dependencies.packageManager,
      settingsManager: dependencies.settingsManager,
    });

    assert.deepEqual(observedLogLevels, ['silent']);
    assert.equal(process.env.NPM_CONFIG_LOGLEVEL, 'warn');
  } finally {
    if (previousNpmLogLevel === undefined) {
      delete process.env.NPM_CONFIG_LOGLEVEL;
    } else {
      process.env.NPM_CONFIG_LOGLEVEL = previousNpmLogLevel;
    }
  }
});

/**
 * 网络不可达不会阻断后续扩展检查，并返回可供 Server 警告的分类结果。
 */
test('reports offline failures without aborting the remaining installs', async () => {
  const dependencies = createDependencies([], async (source) => {
    if (source === 'npm:pi-web-access') {
      const error = new Error('request to registry failed');
      error.cause = Object.assign(new Error('getaddrinfo ENOTFOUND registry.npmjs.org'), {
        code: 'ENOTFOUND',
      });
      throw error;
    }
  });
  const sources = ['npm:pi-web-access', 'npm:pi-subagents'];

  const result = await ensureExtensionsInstalled({
    sources,
    packageManager: dependencies.packageManager,
    settingsManager: dependencies.settingsManager,
  });

  assert.deepEqual(result.alreadyInstalled, []);
  assert.deepEqual(result.installed, ['npm:pi-subagents']);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].source, 'npm:pi-web-access');
  assert.equal(result.failures[0].networkUnavailable, true);
  assert.deepEqual(dependencies.installs, sources);
  assert.equal(dependencies.flushes, 1);
});
