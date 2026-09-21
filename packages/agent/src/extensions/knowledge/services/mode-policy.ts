/**
 * @author Codex
 * @description Enforces knowledge collection boundaries independently of model instructions and Pi UI.
 */
import type { KnowledgeClient, KnowledgeOperations } from '../definitions/client.js';

/**
 * Limit tool requests to user-selected collections; an empty selection permits automatic discovery in Host scope.
 */
export function scopeKnowledgeClient(
  client: KnowledgeClient,
  selection: () => readonly string[]
): KnowledgeClient {
  return {
    upload: (bytes, signal) => client.upload(bytes, signal),
    /**
     * Enforce selected collection boundaries before returning any document content to the model.
     */
    async call<K extends keyof KnowledgeOperations>(
      operation: K,
      input: KnowledgeOperations[K]['input'],
      signal?: AbortSignal
    ) {
      const allowed = selection();
      const params = input as Record<string, unknown>;
      if (allowed.length) {
        const requested = Array.isArray(params.collectionIds)
          ? params.collectionIds
          : typeof params.collectionId === 'string'
            ? [params.collectionId]
            : [];
        if (requested.some((id) => !allowed.includes(String(id))) || operation === 'collections.create') {
          throw new Error('当前问答限定了集合范围，请用户先调整来源选择');
        }
        if (operation === 'collections.list') {
          const page = Number(params.page ?? 1);
          const pageSize = Number(params.pageSize ?? 20);
          const ids = allowed.slice((page - 1) * pageSize, page * pageSize);
          const items = await Promise.all(ids.map((id) => client.call('collections.get', { id }, signal)));
          return { items, page, pageSize, total: allowed.length } as KnowledgeOperations[K]['output'];
        }
      }
      const result = await client.call(operation, input, signal);
      if (
        allowed.length &&
        operation === 'read' &&
        !allowed.includes((result as KnowledgeOperations['read']['output']).collectionId)
      ) {
        throw new Error('引用不属于当前选定集合，请重新检索');
      }
      if (
        allowed.length &&
        operation === 'jobs.get' &&
        !allowed.includes((result as KnowledgeOperations['jobs.get']['output']).job.collectionId)
      ) {
        throw new Error('任务不属于当前选定集合');
      }
      return result;
    },
  };
}
