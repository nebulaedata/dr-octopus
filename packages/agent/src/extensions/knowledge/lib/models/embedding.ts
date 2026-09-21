/**
 * @author Codex
 * @description LangChain embedding adapter validating ordering, finite vectors and pinned dimensions.
 */
import { Embeddings } from '@langchain/core/embeddings';
import { KnowledgeError } from '../../definitions/error.js';
import { knowledgeModelFetch, modelRequest, record } from './request.js';
import type { EmbeddingConfig } from '../../definitions/models.js';

export class KnowledgeEmbeddings extends Embeddings {
  /**
   * Snapshot one execution's configuration and cancellation scope.
   */
  constructor(
    private readonly config: EmbeddingConfig,
    private readonly signal?: AbortSignal,
    private readonly fetcher: typeof fetch = knowledgeModelFetch
  ) {
    super({ maxRetries: 0 });
    if (
      !Number.isInteger(config.dimensions) ||
      config.dimensions < 1 ||
      config.dimensions > 8192 ||
      !Number.isInteger(config.batchSize) ||
      config.batchSize < 1 ||
      config.batchSize > 64
    ) {
      throw new KnowledgeError('MODEL_CONFIG_INVALID', 'Embedding 维度或批大小无效');
    }
    this.config = { ...config };
  }

  /**
   * Embed bounded batches, restoring input order even if the provider reorders results.
   */
  async embedDocuments(texts: string[]): Promise<number[][]> {
    const output: number[][] = [];
    for (let start = 0; start < texts.length; start += this.config.batchSize) {
      this.signal?.throwIfAborted();
      const input = texts.slice(start, start + this.config.batchSize);
      if (input.some((text) => !text.trim() || text.length > 24_000)) {
        throw new KnowledgeError('INVALID_INPUT', 'Embedding 文本为空或超过单块长度限制');
      }
      const result = record(
        await modelRequest(
          this.config,
          'embeddings',
          {
            model: this.config.model,
            input,
            encoding_format: 'float',
          },
          this.signal,
          this.fetcher
        )
      );
      if (!Array.isArray(result.data) || result.data.length !== input.length) {
        throw new KnowledgeError('MODEL_RESPONSE_INVALID', 'Embedding 返回数量不匹配');
      }
      const batch = new Map<number, number[]>();
      for (const raw of result.data as unknown[]) {
        const item = record(raw);
        if (
          typeof item.index !== 'number' ||
          !Number.isInteger(item.index) ||
          item.index < 0 ||
          item.index >= input.length ||
          batch.has(item.index) ||
          !Array.isArray(item.embedding) ||
          item.embedding.length !== this.config.dimensions ||
          !item.embedding.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))
        ) {
          throw new KnowledgeError('EMBEDDING_DIMENSION_MISMATCH', 'Embedding 索引、维度或向量数值无效');
        }
        const vector = item.embedding as number[];
        if (!vector.some((value) => value !== 0)) {
          throw new KnowledgeError('MODEL_RESPONSE_INVALID', 'Embedding 返回零向量');
        }
        batch.set(item.index, vector);
      }
      for (let index = 0; index < input.length; index++) {
        output.push(batch.get(index)!);
      }
    }
    return output;
  }

  /**
   * Query embedding shares exactly the index generation's model settings.
   */
  async embedQuery(text: string): Promise<number[]> {
    return (await this.embedDocuments([text]))[0]!;
  }
}
