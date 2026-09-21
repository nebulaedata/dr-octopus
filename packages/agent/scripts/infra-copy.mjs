/**
 * @author Codex
 * @description 将 Agent 离线基础设施资源复制到构建产物，只在构建阶段(build)使用。
 */
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 用源码 infra 完整替换构建输出中的发布资源。
 */
async function copyInfra() {
  const agentDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const source = resolve(agentDir, 'infra');
  const target = resolve(agentDir, 'dist', 'assets', 'infra');

  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });

  const manifest = JSON.parse(await readFile(resolve(source, 'manifest.json'), 'utf8'));
  const files = new Set([
    'README.md',
    'manifest.json',
    ...manifest.resources.map((resource) => resource.file),
  ]);

  for (const relativePath of files) {
    const sourceFile = resolve(source, relativePath);
    const targetFile = resolve(target, relativePath);
    await mkdir(dirname(targetFile), { recursive: true });
    await cp(sourceFile, targetFile, { recursive: true, force: true });
  }
}

await copyInfra();
