/**
 * @author Codex
 * @description Scope-aware collection and document use cases independent of transport and storage.
 */
import { randomUUID } from 'node:crypto';
import { KnowledgeError } from '../definitions/error.js';
import type { CatalogRepository } from '../definitions/port.js';
import type { KnowledgeCollection, KnowledgeContext, KnowledgeScope } from '../definitions/types.js';

/**
 * Require bounded ordinary pagination before a repository computes offsets.
 */
export function validatePage(page = 1, pageSize = 20): void {
  if (!Number.isSafeInteger(page) || page < 1 || page > 100_000 || ![20, 50, 100].includes(pageSize)) {
    throw new KnowledgeError('INVALID_INPUT', '分页参数无效');
  }
}

export class KnowledgeCatalogService {
  /**
   * Inject persistence without importing Drizzle or LanceDB into domain use cases.
   */
  constructor(private readonly repository: CatalogRepository) {}

  /**
   * Resolve visibility exclusively from the trusted Host context.
   */
  requireCollection(context: KnowledgeContext, id: string, write = false): KnowledgeCollection {
    const item = this.repository.getCollection(id);
    if (
      !item ||
      item.deletedAt ||
      (item.scope.kind === 'workspace' && item.scope.workspaceId !== context.workspaceId)
    ) {
      throw new KnowledgeError('NOT_FOUND', '知识集合不存在或无权访问');
    }
    if (write && (item.source === 'remote' || (item.scope.kind === 'global' && !context.globalWrite))) {
      throw new KnowledgeError('FORBIDDEN', '此调用未授权修改全局知识库');
    }
    return item;
  }

  /**
   * List global and the caller's workspace, or an explicitly authorized management scope.
   */
  list(context: KnowledgeContext, page = 1, pageSize = 20, scope?: KnowledgeScope) {
    validatePage(page, pageSize);
    if (scope?.kind === 'workspace' && scope.workspaceId !== context.workspaceId) {
      throw new KnowledgeError('FORBIDDEN', '不能列举其他工作区');
    }
    const scopes: KnowledgeScope[] = scope
      ? [scope]
      : [
          { kind: 'global' },
          ...(context.workspaceId ? [{ kind: 'workspace' as const, workspaceId: context.workspaceId }] : []),
        ];
    return this.repository.listCollections(scopes, page, pageSize);
  }

  /**
   * Create within the trusted workspace; only an explicitly authorized caller may write global scope.
   */
  create(
    context: KnowledgeContext,
    scope: KnowledgeScope,
    name: string,
    description = ''
  ): KnowledgeCollection {
    if (!name.trim() || name.length > 120 || description.length > 2000) {
      throw new KnowledgeError('INVALID_INPUT', '集合名称或说明长度无效');
    }
    if (
      (scope.kind === 'global' && !context.globalWrite) ||
      (scope.kind === 'workspace' && scope.workspaceId !== context.workspaceId)
    ) {
      throw new KnowledgeError('FORBIDDEN', '未授权在此范围创建集合');
    }
    const item: KnowledgeCollection = {
      id: randomUUID(),
      scope,
      name: name.trim(),
      description,
      revision: 1,
      published: false,
      activeGenerationId: null,
      rebuildJobId: null,
      createdAt: new Date().toISOString(),
      deletedAt: null,
    };
    this.repository.createCollection(item);
    return item;
  }

  /**
   * Validate metadata and publication boundaries before a compare-and-swap update.
   */
  update(
    context: KnowledgeContext,
    id: string,
    revision: number,
    patch: Partial<Pick<KnowledgeCollection, 'name' | 'description' | 'published'>>
  ) {
    const item = this.requireCollection(context, id, true);
    if (
      (patch.name !== undefined && (!patch.name.trim() || patch.name.length > 120)) ||
      (patch.description?.length ?? 0) > 2000 ||
      (patch.published && item.scope.kind !== 'global')
    ) {
      throw new KnowledgeError('INVALID_INPUT', '集合更新或发布范围无效');
    }
    return this.repository.updateCollection(id, revision, patch);
  }

  /**
   * Repeated authorized deletion does not schedule duplicate cleanup work.
   */
  remove(context: KnowledgeContext, id: string, revision: number): void {
    const existing = this.repository.getCollection(id);
    if (
      existing?.deletedAt &&
      (existing.scope.kind === 'global'
        ? context.globalWrite
        : existing.scope.workspaceId === context.workspaceId)
    ) {
      return;
    }
    this.requireCollection(context, id, true);
    this.repository.deleteCollection(id, revision);
  }
}
