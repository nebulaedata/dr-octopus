/**
 * @author Codex
 * @description 校验并原子持久化 Project Workspace Registry
 */
import { randomUUID } from 'node:crypto';
import { open, readFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { WorkspaceError } from '../definitions/error.js';
import type { WorkspaceDescriptor } from '../definitions/types.js';

interface WorkspaceRegistryDocument {
  schemaVersion: 1;
  workspaces: WorkspaceDescriptor[];
}

/**
 * @description 判断未知值是否满足 Project Workspace Descriptor 的持久化契约。
 */
function isProjectDescriptor(value: unknown): value is WorkspaceDescriptor {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    item.schemaVersion === 1 &&
    item.kind === 'project' &&
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    typeof item.name === 'string' &&
    item.name.length > 0 &&
    (item.slug === undefined || typeof item.slug === 'string') &&
    typeof item.cwd === 'string' &&
    typeof item.createdAt === 'string' &&
    typeof item.updatedAt === 'string'
  );
}

/**
 * @description 解析 Registry，并在结构损坏时拒绝提供可被覆盖的默认值。
 */
function parseRegistry(source: string): WorkspaceRegistryDocument {
  try {
    const value: unknown = JSON.parse(source);
    if (typeof value !== 'object' || value === null) {
      throw new TypeError('Registry root must be an object');
    }
    const document = value as Record<string, unknown>;
    if (
      document.schemaVersion !== 1 ||
      !Array.isArray(document.workspaces) ||
      !document.workspaces.every(isProjectDescriptor)
    ) {
      throw new TypeError('Registry does not match schema version 1');
    }
    return document as unknown as WorkspaceRegistryDocument;
  } catch (error) {
    throw new WorkspaceError(
      'WORKSPACE_REGISTRY_CORRUPT',
      'Workspace registry is corrupt and was left unchanged.',
      error
    );
  }
}

export class FileWorkspaceRegistry {
  readonly #path: string;

  /**
   * @description 创建只管理 Project Workspace 记录的文件 Registry。
   *
   * @param path Registry 文件绝对路径。
   */
  public constructor(path: string) {
    this.#path = path;
  }

  /**
   * @description 读取并严格校验 Registry；文件不存在等价于尚无 Project Workspace。
   */
  public async read(): Promise<WorkspaceDescriptor[]> {
    try {
      const source = await readFile(this.#path, 'utf8');
      return parseRegistry(source).workspaces;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return [];
      }
      if (error instanceof WorkspaceError) {
        throw error;
      }
      throw new WorkspaceError('WORKSPACE_REGISTRY_CORRUPT', 'Workspace registry cannot be read.', error);
    }
  }

  /**
   * @description 通过同目录临时文件、文件 fsync 与原子 rename 提交完整 Registry。
   *
   * @param workspaces 已经过业务层校验的 Project Workspace 快照。
   */
  public async write(workspaces: WorkspaceDescriptor[]): Promise<void> {
    const directory = dirname(this.#path);
    const temporary = join(directory, `.index.${process.pid}.${randomUUID()}.tmp`);
    const document: WorkspaceRegistryDocument = { schemaVersion: 1, workspaces };
    const handle = await open(temporary, 'wx');
    try {
      await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, this.#path);
    try {
      const directoryHandle = await open(directory, 'r');
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch (error) {
      if (process.platform !== 'win32') {
        throw error;
      }
    }
  }
}

/**
 * @description 收窄 Node.js 系统错误以读取稳定的 code 字段。
 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
