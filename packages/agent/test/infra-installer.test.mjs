/**
 * @author Codex
 * @description 验证 Agent 离线工具的安装检测与跳过行为
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { installInfra, isInfraInstalled } from '../dist/infra/index.js';

/** 计算测试资源清单使用的 SHA-256。 */
function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

/** 创建只包含当前平台单个工具的最小 infra fixture。 */
async function createFixture(root, content) {
  const infraDir = join(root, 'infra');
  const agentDir = join(root, 'agent');
  const resourceDir = join(infraDir, 'resources');
  await mkdir(resourceDir, { recursive: true });
  await writeFile(join(resourceDir, 'tool'), content);
  await writeFile(
    join(infraDir, 'manifest.json'),
    JSON.stringify({
      schemaVersion: 1,
      infraVersion: 'test',
      resources: [
        {
          id: 'tool',
          version: '1',
          platform: process.platform,
          arch: process.arch,
          source: 'fixture',
          file: 'resources/tool',
          target: 'bin/tool',
          sha256: sha256(content),
          executable: false,
        },
      ],
    })
  );
  return { agentDir, infraDir };
}

/** 验证首次安装、完整安装检测以及再次调用时不覆盖目标文件。 */
test('skips bundled resources that are already installed and valid', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-infra-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const options = await createFixture(root, 'fixture-content');

  assert.equal(await isInfraInstalled(options), false);
  await installInfra(options);
  assert.equal(await isInfraInstalled(options), true);

  const target = join(options.agentDir, 'bin', 'tool');
  const installedAt = (await stat(target)).mtimeMs;
  await new Promise((resolve) => setTimeout(resolve, 20));
  await installInfra(options);

  assert.equal(await readFile(target, 'utf8'), 'fixture-content');
  assert.equal((await stat(target)).mtimeMs, installedAt);
});
