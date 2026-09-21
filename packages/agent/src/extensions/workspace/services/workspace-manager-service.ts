/**
 * @author Codex
 * @description 实现 Workspace 的 list、resolve 与可恢复 create 用例
 */
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, realpath, rename, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { WorkspaceError } from '../definitions/error.js';
import { FileWorkspaceRegistry } from '../lib/file-workspace-registry.js';
import { MutationMutex } from '../lib/mutation-mutex.js';
import { createWorkspacePaths } from '../lib/workspace-paths.js';
import {
  isWithinManagedRoot,
  validateCreateWorkspaceCommand,
  validateWorkspaceSelector,
} from '../validators/workspace-validator.js';
import type {
  CreateWorkspaceCommand,
  WorkspaceDescriptor,
  WorkspacePaths,
  WorkspaceSelector,
} from '../definitions/types.js';
import type { WorkspaceService } from '../definitions/port.js';

const GENERAL_TIMESTAMP = '1970-01-01T00:00:00.000Z';
const MARKER_FILE = '.octopus-workspace.json';

export class WorkspaceManagerService implements WorkspaceService {
  readonly #paths: WorkspacePaths;
  readonly #registry: FileWorkspaceRegistry;
  readonly #mutex = new MutationMutex();

  /**
   * @description 创建绑定到单一 Octopus Root 的 Workspace Service。
   *
   * @param paths 可注入的受管路径，便于 Host 与测试隔离数据根目录。
   */
  public constructor(paths: WorkspacePaths = createWorkspacePaths()) {
    this.#paths = paths;
    this.#registry = new FileWorkspaceRegistry(paths.registry);
  }

  /**
   * @description 列出代码生成的 General 与 Registry 中的 Project Workspace。
   */
  public async list(): Promise<WorkspaceDescriptor[]> {
    await this.#ensureLayout();
    const projects = await this.#registry.read();
    await Promise.all(projects.map((workspace) => this.#assertProjectPath(workspace)));
    return [this.#general(), ...projects];
  }

  /**
   * @description 通过唯一 id 或 slug 解析并验证受管 cwd。
   */
  public async resolve(selector: WorkspaceSelector): Promise<WorkspaceDescriptor> {
    const selectorKind = validateWorkspaceSelector(selector);
    if (selector.id === 'general' || selector.slug === 'general') {
      await this.#ensureLayout();
      return this.#general();
    }
    const projects = await this.list();
    const matches = projects.filter((workspace) =>
      selectorKind === 'id' ? workspace.id === selector.id : workspace.slug === selector.slug
    );
    if (matches.length > 1) {
      throw new WorkspaceError(
        'WORKSPACE_SELECTOR_AMBIGUOUS',
        'Workspace selector matches multiple records.'
      );
    }
    const workspace = matches[0];
    if (workspace === undefined) {
      throw new WorkspaceError('WORKSPACE_NOT_FOUND', 'Workspace was not found.');
    }
    return workspace;
  }

  /**
   * @description 创建并登记 Project Workspace，或提交上次 Registry 写入失败遗留的匹配目录。
   */
  public async create(command: CreateWorkspaceCommand): Promise<WorkspaceDescriptor> {
    return this.#mutex.run(async () => {
      await this.#ensureLayout();
      const { name, slug } = validateCreateWorkspaceCommand(command);
      const workspaces = await this.#registry.read();
      if (workspaces.some((workspace) => workspace.slug === slug)) {
        throw new WorkspaceError('WORKSPACE_ALREADY_EXISTS', `Workspace slug already exists: ${slug}`);
      }
      const recovered = await this.#findRecoverableWorkspace(name, slug);
      if (recovered !== undefined) {
        await this.#registry.write([...workspaces, recovered]);
        return recovered;
      }

      const timestamp = new Date().toISOString();
      const id = randomUUID();
      const descriptor: WorkspaceDescriptor = {
        schemaVersion: 1,
        id,
        kind: 'project',
        name,
        slug,
        cwd: join(this.#paths.workspaces, id),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const temporary = join(this.#paths.workspaces, `.creating-${id}`);
      try {
        await mkdir(temporary);
        await this.#writeMarker(join(temporary, MARKER_FILE), descriptor);
        await rename(temporary, descriptor.cwd);
        await this.#registry.write([...workspaces, descriptor]);
        return descriptor;
      } catch (error) {
        if (error instanceof WorkspaceError) {
          throw error;
        }
        throw new WorkspaceError('WORKSPACE_CREATE_FAILED', 'Workspace could not be created safely.', error);
      }
    });
  }

  /**
   * @description 确保 General、Agent 与 Project Registry 父目录在首次使用前存在。
   */
  async #ensureLayout(): Promise<void> {
    await Promise.all([
      mkdir(this.#paths.agent, { recursive: true }),
      mkdir(this.#paths.general, { recursive: true }),
      mkdir(this.#paths.workspaces, { recursive: true }),
    ]);
  }

  /**
   * @description 生成不依赖 Registry 的固定 General Descriptor。
   */
  #general(): WorkspaceDescriptor {
    return {
      schemaVersion: 1,
      id: 'general',
      kind: 'general',
      name: 'General',
      slug: 'general',
      cwd: this.#paths.general,
      createdAt: GENERAL_TIMESTAMP,
      updatedAt: GENERAL_TIMESTAMP,
    };
  }

  /**
   * @description 验证 Registry cwd 与 id 派生路径一致，且规范路径位于受管根目录内。
   */
  async #assertProjectPath(workspace: WorkspaceDescriptor): Promise<void> {
    const expected = resolve(this.#paths.workspaces, workspace.id);
    if (resolve(workspace.cwd) !== expected) {
      throw new WorkspaceError(
        'WORKSPACE_PATH_VIOLATION',
        `Workspace cwd is not derived from its id: ${workspace.id}`
      );
    }
    try {
      const [rootPath, cwdPath] = await Promise.all([
        realpath(this.#paths.workspaces),
        realpath(workspace.cwd),
      ]);
      if (!isWithinManagedRoot(rootPath, cwdPath) || !(await stat(cwdPath)).isDirectory()) {
        throw new WorkspaceError(
          'WORKSPACE_PATH_VIOLATION',
          `Workspace cwd escapes the managed root: ${workspace.id}`
        );
      }
    } catch (error) {
      if (error instanceof WorkspaceError) {
        throw error;
      }
      throw new WorkspaceError(
        'WORKSPACE_PATH_VIOLATION',
        `Workspace cwd cannot be verified: ${workspace.id}`,
        error
      );
    }
  }

  /**
   * @description 查找目录已发布但 Registry 尚未提交的同名同 slug 标记。
   */
  async #findRecoverableWorkspace(name: string, slug: string): Promise<WorkspaceDescriptor | undefined> {
    const entries = await readdir(this.#paths.workspaces, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue;
      }
      try {
        const source = await readFile(join(this.#paths.workspaces, entry.name, MARKER_FILE), 'utf8');
        const marker = JSON.parse(source) as WorkspaceDescriptor;
        if (
          marker.schemaVersion === 1 &&
          marker.kind === 'project' &&
          marker.id === entry.name &&
          marker.name === name &&
          marker.slug === slug &&
          marker.cwd === join(this.#paths.workspaces, marker.id)
        ) {
          await this.#assertProjectPath(marker);
          return marker;
        }
      } catch {
        // 无法确认归属的目录必须保留，且不能参与自动恢复。
      }
    }
    return undefined;
  }

  /**
   * @description 写入并 fsync Workspace 归属标记，保证目录发布后可恢复提交。
   */
  async #writeMarker(path: string, descriptor: WorkspaceDescriptor): Promise<void> {
    const handle = await open(path, 'wx');
    try {
      await handle.writeFile(`${JSON.stringify(descriptor, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}
