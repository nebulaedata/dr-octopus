/**
 * @author Codex
 * @description Shared serializable knowledge contracts without infrastructure dependencies.
 */
export type * from '@octopus/shared/protocol/knowledge';
import type {
  KnowledgeClient as SharedKnowledgeClient,
  KnowledgeOperations as SharedKnowledgeOperations,
} from '@octopus/shared/protocol/knowledge';

/**
 * Private daemon operations for Agent model tools; deliberately absent from public MCP contracts.
 */
export interface KnowledgeOperations extends SharedKnowledgeOperations {
  'models.ocr': { input: { blobSha256: string }; output: { text: string } };
  'models.embed': {
    input: { texts: string[] };
    output: { vectors: number[][]; dimensions: number };
  };
  'models.rerank': {
    input: { query: string; documents: string[] };
    output: { results: { index: number; score: number }[] };
  };
}

export interface KnowledgeClient extends Omit<SharedKnowledgeClient, 'call'> {
  /**
   * Execute a public knowledge operation or a private Agent model operation with fixed caller context.
   */
  call<K extends keyof KnowledgeOperations>(
    operation: K,
    input: KnowledgeOperations[K]['input'],
    signal?: AbortSignal
  ): Promise<KnowledgeOperations[K]['output']>;
}
