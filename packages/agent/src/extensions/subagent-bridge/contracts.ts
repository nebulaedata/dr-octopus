/**
 * @author Codex
 * @description Defines the minimal public registration contract and immutable child retrieval scope.
 */
import type { DelegatedPermissionSnapshot } from '../permission-system/sdk/index.js';

export interface ChildScope {
  permissions: DelegatedPermissionSnapshot;
  agentDir: string;
  workspaceId: string;
  collectionIds: readonly string[];
  tools: readonly string[];
}

export interface RequiredChildApi {
  /**
   * Register one snapshot until explicitly disposed; paths must already exist.
   */
  registerRequiredChildExtensions(input: { sessionId: string; extensions: { id: string; path: string }[] }): {
    /**
     * Idempotently release this registration without affecting a later replacement.
     */
    dispose(): void;
  };
}

/**
 * Single delegation allowlist for shared built-in tools, parent snapshots and the managed explorer.
 */
export const CHILD_TOOLS = [
  'knowledge_list_collections',
  'knowledge_search',
  'knowledge_read',
  'ocr_image',
  'embed_text',
  'rerank_documents',
  'memory_recall',
  'memory_read',
] as const;
