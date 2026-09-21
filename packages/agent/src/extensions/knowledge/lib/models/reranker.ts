/**
 * @author Codex
 * @description vLLM-compatible reranking with strict candidate identity and score validation.
 */
import { KnowledgeError } from '../../definitions/error.js';
import { knowledgeModelFetch, modelRequest, record } from './request.js';
import type { RankedCandidate, RerankerConfig } from '../../definitions/models.js';

/**
 * Rank the supplied candidate set without allowing the provider to introduce new documents.
 */
export async function rerankCandidates(
  config: RerankerConfig,
  query: string,
  documents: string[],
  signal?: AbortSignal,
  fetcher: typeof fetch = knowledgeModelFetch
): Promise<RankedCandidate[]> {
  if (
    !query.trim() ||
    query.length > 2000 ||
    documents.length === 0 ||
    documents.length > Math.min(config.maxCandidates, 40) ||
    documents.reduce((sum, value) => sum + value.length, 0) > 48_000
  ) {
    throw new KnowledgeError('INVALID_INPUT', '重排输入超过限制或为空');
  }
  const result = record(
    await modelRequest(
      config,
      'rerank',
      {
        model: config.model,
        query,
        documents,
        top_n: documents.length,
      },
      signal,
      fetcher
    )
  );
  if (!Array.isArray(result.results) || result.results.length !== documents.length) {
    throw new KnowledgeError('MODEL_RESPONSE_INVALID', '重排结果不完整');
  }
  const seen = new Set<number>();
  return (result.results as unknown[])
    .map((raw) => {
      const item = record(raw);
      if (
        typeof item.index !== 'number' ||
        !Number.isInteger(item.index) ||
        item.index < 0 ||
        item.index >= documents.length ||
        seen.has(item.index) ||
        typeof item.relevance_score !== 'number' ||
        !Number.isFinite(item.relevance_score)
      ) {
        throw new KnowledgeError('MODEL_RESPONSE_INVALID', '重排返回无效的候选索引或分数');
      }
      seen.add(item.index);
      return { index: item.index, score: item.relevance_score };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index);
}
