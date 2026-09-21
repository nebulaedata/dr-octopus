/**
 * @author Codex
 * @description Owns bounded permission JSON reads, revision hashes and validation errors without changing files.
 */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { PermissionConfigSchema } from '@octopus/shared/protocol';
import type { PermissionConfig } from '@octopus/shared/protocol';

export class PermissionConfigurationError extends Error {
  /**
   * Retain a stable error code and source path without exposing configuration contents.
   */
  constructor(
    public readonly code:
      'PERMISSION_CONFIG_INVALID' | 'PERMISSION_CONFIG_CONFLICT' | 'PERMISSION_CONFIG_BUSY',
    message: string,
    public readonly path?: string
  ) {
    super(message);
  }
}

/**
 * Read only ordinary bounded files; an absent overlay is distinct from a malformed one.
 */
export function readPermissionFile(path: string): { raw: string; revision: string } {
  let raw = '{}';
  let exists = false;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) {
      throw new Error('文件类型或大小无效');
    }
    exists = true;
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new PermissionConfigurationError('PERMISSION_CONFIG_INVALID', '权限配置文件不可读取', path);
    }
  }
  return {
    raw,
    revision: createHash('sha256')
      .update(JSON.stringify([exists, raw]))
      .digest('hex'),
  };
}

/**
 * Validate legacy overlays and version 2 documents through one strict schema.
 */
export function parsePermissionFile(raw: string, path?: string): PermissionConfig {
  try {
    return PermissionConfigSchema.parse(JSON.parse(raw));
  } catch {
    throw new PermissionConfigurationError(
      'PERMISSION_CONFIG_INVALID',
      '权限配置格式无效，请检查字段、版本和权限取值',
      path
    );
  }
}
