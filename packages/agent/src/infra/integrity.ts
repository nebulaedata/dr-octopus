/**
 * @author Codex
 * @description 校验离线发布资源的文件完整性
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/**
 * 计算文件 SHA-256。
 *
 * @param filePath 待校验文件
 * @returns 小写十六进制摘要
 */
async function calculateSha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const input = createReadStream(filePath);

  for await (const chunk of input) {
    hash.update(chunk as Buffer);
  }

  return hash.digest('hex');
}

/**
 * 验证发布文件与 manifest 声明一致，防止安装损坏或被替换的产物。
 *
 * @param filePath 发布文件路径
 * @param expectedSha256 manifest 中的预期摘要
 * @throws 文件摘要不匹配时抛出异常
 */
export async function verifyFileIntegrity(filePath: string, expectedSha256: string): Promise<void> {
  const actualSha256 = await calculateSha256(filePath);
  if (actualSha256 !== expectedSha256.toLowerCase()) {
    throw new Error(`Infra integrity check failed: ${filePath}`);
  }
}
