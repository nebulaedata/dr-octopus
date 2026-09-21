/**
 * @author Codex
 * @description 读取并校验 Agent 离线基础设施清单
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { InfraManifest } from './types.js';

/**
 * 读取基础设施 manifest，并拒绝当前实现不支持的 schema。
 *
 * @param infraDir 随 Agent 包发布的 infra 目录
 * @returns 经过基础结构校验的 manifest
 */
export async function readInfraManifest(infraDir: string): Promise<InfraManifest> {
  const content = await readFile(join(infraDir, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(content) as Partial<InfraManifest>;

  if (
    manifest.schemaVersion !== 1 ||
    typeof manifest.infraVersion !== 'string' ||
    !Array.isArray(manifest.resources)
  ) {
    throw new Error('Unsupported or invalid Agent infra manifest');
  }

  return manifest as InfraManifest;
}
