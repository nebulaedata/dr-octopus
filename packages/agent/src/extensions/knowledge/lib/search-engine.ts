/**
 * @author Codex
 * @description Hybrid retrieval over generation-pinned models with explicit degraded coverage.
 */
import { randomUUID } from 'node:crypto';
import { KnowledgeError } from '../definitions/error.js';
import { fuseRanks } from '../services/ranking.js';
import { KnowledgeEmbeddings } from './models/embedding.js';
import { rerankCandidates } from './models/reranker.js';
import type { KnowledgeIndex } from '../definitions/port.js';
import type { IndexedChunk, KnowledgeContext, KnowledgeSearchResult } from '../definitions/types.js';
import type { KnowledgeSearchRepository } from './search-repository.js';
import type { KnowledgeModelSettings } from './model-settings.js';

export class KnowledgeSearchEngine {
  /**
   * Compose index, metadata and provider adapters behind one bounded retrieval operation.
   */
  constructor(
    private readonly repository: KnowledgeSearchRepository,
    private readonly index: KnowledgeIndex,
    private readonly models: KnowledgeModelSettings
  ) {}

  /**
   * Retrieve up to twenty explicit collections; failed dependencies cannot be reported as an empty successful search.
   */
  async search(
    context: KnowledgeContext,
    collectionIds: string[],
    query: string,
    limit = 8,
    signal?: AbortSignal
  ): Promise<KnowledgeSearchResult> {
    if (
      !query.trim() ||
      query.length > 2000 ||
      !collectionIds.length ||
      collectionIds.length > 20 ||
      new Set(collectionIds).size !== collectionIds.length ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 20
    ) {
      throw new KnowledgeError('INVALID_INPUT', '检索范围、问题或数量无效');
    }
    const snapshots = collectionIds.map((id) => this.repository.snapshot(context, id));
    const models = this.models.get();
    const result: KnowledgeSearchResult = {
      hits: [],
      coverage: 'complete',
      sources: [],
      warnings: [],
      queryId: randomUUID(),
      ranking: { strategy: 'rrf', configRevision: models.revision, degraded: false },
    };
    const lists: IndexedChunk[][] = [];
    const owners = new Map<string, string>();
    for (let position = 0; position < collectionIds.length; position++) {
      signal?.throwIfAborted();
      const snapshot = snapshots[position];
      const collectionRef = collectionIds[position]!;
      if (!snapshot || !snapshot.revisions.length) {
        result.sources.push({ collectionRef, state: 'ready' });
        continue;
      }
      try {
        let vector: number[] | undefined;
        try {
          vector = await new KnowledgeEmbeddings(
            await this.models.resolve(snapshot.config),
            signal
          ).embedQuery(query);
        } catch (error) {
          signal?.throwIfAborted();
          result.warnings.push(error instanceof KnowledgeError ? error.code : 'EMBEDDING_UNAVAILABLE');
          result.ranking.degraded = true;
        }
        const ranks = await this.index.search(snapshot.id, snapshot.revisions, query, vector);
        for (const rank of ranks) {
          for (const chunk of rank) {
            owners.set(chunk.chunkId, snapshot.id);
          }
          lists.push(rank);
        }
        result.sources.push({ collectionRef, state: 'ready' });
      } catch (error) {
        signal?.throwIfAborted();
        result.sources.push({
          collectionRef,
          state: 'unavailable',
          reason: error instanceof KnowledgeError ? error.code : 'INDEX_UNAVAILABLE',
        });
      }
    }
    let candidates = fuseRanks(lists);
    if (models.reranker?.enabled && candidates.length) {
      try {
        candidates = candidates.slice(0, models.reranker.maxCandidates);
        const ordered = await rerankCandidates(
          await this.models.resolve(models.reranker),
          query,
          candidates.map((hit) => hit.text),
          signal
        );
        candidates = ordered.map((item) => candidates[item.index]!);
        result.ranking.strategy = 'reranker';
      } catch (error) {
        signal?.throwIfAborted();
        result.warnings.push(error instanceof KnowledgeError ? error.code : 'RERANKER_UNAVAILABLE');
        result.ranking.degraded = true;
      }
    }
    for (const chunk of candidates.slice(0, limit)) {
      const hit = this.repository.cite(context, owners.get(chunk.chunkId)!, chunk);
      if (hit) {
        result.hits.push(hit);
      }
    }
    const unavailable = result.sources.filter((source) => source.state === 'unavailable').length;
    result.coverage =
      unavailable === collectionIds.length
        ? 'unavailable'
        : unavailable || result.ranking.degraded
          ? 'partial'
          : 'complete';
    return result;
  }

  /**
   * Read the retained immutable chunk, with a second revocation check after the asynchronous native read.
   */
  async read(context: KnowledgeContext, citationId: string): Promise<IndexedChunk> {
    const evidence = this.repository.evidence(context, citationId);
    const chunk = await this.index.read(evidence.generationId, evidence.chunkId);
    this.repository.evidence(context, citationId);
    if (!chunk) {
      throw new KnowledgeError('EVIDENCE_GONE', '引用正文不可用');
    }
    return chunk;
  }
}
