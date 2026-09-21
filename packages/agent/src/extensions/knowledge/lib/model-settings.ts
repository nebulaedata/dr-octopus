/**
 * @author Codex
 * @description Current model persistence and private credential references for generation snapshots.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { settings } from '../db/schema.js';
import { KnowledgeError } from '../definitions/error.js';
import { modelEndpoint } from './models/request.js';
import { KnowledgeEmbeddings } from './models/embedding.js';
import { recognizePage } from './models/ocr.js';
import { rerankCandidates } from './models/reranker.js';
import type { KnowledgeDatabase } from '../db/database.js';
import type {
  EmbeddingConfig,
  KnowledgeModels,
  ModelConnection,
  OcrConfig,
  RerankerConfig,
} from '../definitions/models.js';

/**
 * Reject unknown provider configuration shapes before they enter durable jobs or model calls.
 */
function validateConfig(config: EmbeddingConfig | OcrConfig | RerankerConfig): void {
  modelEndpoint(config.endpoint, 'models');
  if (
    !config.model.trim() ||
    config.model.length > 200 ||
    !Number.isInteger(config.timeoutMs) ||
    config.timeoutMs < 100 ||
    config.timeoutMs > 120_000
  ) {
    throw new KnowledgeError('MODEL_CONFIG_INVALID', '模型名称或超时无效');
  }
  if (
    config.kind === 'embedding' &&
    (!Number.isInteger(config.dimensions) ||
      config.dimensions < 1 ||
      config.dimensions > 8192 ||
      !Number.isInteger(config.batchSize) ||
      config.batchSize < 1 ||
      config.batchSize > 64)
  ) {
    throw new KnowledgeError('MODEL_CONFIG_INVALID', 'Embedding 维度或批大小无效');
  }
  if (
    config.kind === 'ocr' &&
    (!['auto', 'force', 'off'].includes(config.mode) ||
      !Number.isInteger(config.maxOutputTokens) ||
      config.maxOutputTokens < 64 ||
      config.maxOutputTokens > 8192)
  ) {
    throw new KnowledgeError('MODEL_CONFIG_INVALID', 'OCR 模式或输出预算无效');
  }
  if (
    config.kind === 'reranker' &&
    (!Number.isInteger(config.maxCandidates) ||
      config.maxCandidates < 1 ||
      config.maxCandidates > 40 ||
      typeof config.enabled !== 'boolean' ||
      typeof config.allowRemoteEvidence !== 'boolean')
  ) {
    throw new KnowledgeError('MODEL_CONFIG_INVALID', 'Reranker 开关或候选数量无效');
  }
}

export class KnowledgeModelSettings {
  /**
   * Borrow metadata storage and keep credential files outside serialized configuration snapshots.
   */
  constructor(
    private readonly database: KnowledgeDatabase,
    private readonly directory: string
  ) {}

  /**
   * Return current snapshots containing references but no API key plaintext.
   */
  get(): KnowledgeModels {
    return (
      this.database.db.select().from(settings).where(eq(settings.id, 1)).get()?.models ?? {
        revision: 0,
        embedding: null,
        reranker: null,
        ocr: null,
      }
    );
  }

  /**
   * Explicitly probe the edited configuration with synthetic content; no collection data or stored settings are changed.
   */
  async probe(value: EmbeddingConfig | OcrConfig | RerankerConfig, signal?: AbortSignal) {
    validateConfig(value);
    const previous = this.get()[value.kind];
    const config = value.apiKey?.trim()
      ? value
      : previous?.endpoint === value.endpoint && previous.model === value.model
        ? await this.resolve({ ...value, secretRef: previous.secretRef })
        : value;
    const start = Date.now();
    let summary: string;
    if (config.kind === 'embedding') {
      const vector = await new KnowledgeEmbeddings(config, signal).embedQuery('知识库模型连接测试');
      summary = `连接正常，实测向量维度 ${vector.length}`;
    } else if (config.kind === 'reranker') {
      const result = await rerankCandidates(
        { ...config, maxCandidates: Math.max(2, config.maxCandidates) },
        '知识库',
        ['知识库保存检索资料', '今天是晴天'],
        signal
      );
      summary = `连接正常，已验证 ${result.length} 个候选的重排结果`;
    } else {
      const { createOcrProbeImage } = await import('@octopus/document-processing');
      const text = await recognizePage({ ...config, mode: 'auto' }, await createOcrProbeImage(), signal);
      if (!text.includes('OCTOPUS') || !text.includes('2026')) {
        throw new KnowledgeError('MODEL_RESPONSE_INVALID', 'OCR 未能识别标准测试图片');
      }
      summary = '连接正常，标准测试图片识别通过';
    }
    return { kind: config.kind, elapsedMs: Date.now() - start, summary };
  }

  /**
   * Store one current config per model kind, preserving old index credential references.
   */
  async save(
    revision: number,
    value: EmbeddingConfig | OcrConfig | RerankerConfig
  ): Promise<KnowledgeModels> {
    validateConfig(value);
    const config = { ...value };
    const previous = this.get();
    if (previous.revision !== revision) {
      throw new KnowledgeError('REVISION_CONFLICT', '模型配置已修改，请刷新');
    }
    const old = previous[value.kind];
    delete config.secretRef;
    if (config.apiKey?.trim()) {
      await mkdir(join(this.directory, 'credentials'), { recursive: true, mode: 0o700 });
      config.secretRef = randomUUID();
      await writeFile(join(this.directory, 'credentials', config.secretRef), config.apiKey, {
        flag: 'wx',
        mode: 0o600,
      });
    } else if (old?.endpoint === config.endpoint && old.model === config.model && old.secretRef) {
      config.secretRef = old.secretRef;
    }
    delete config.apiKey;
    return this.database.sqlite.transaction(() => {
      const current = this.get();
      if (current.revision !== revision) {
        throw new KnowledgeError('REVISION_CONFLICT', '模型配置已修改，请刷新');
      }
      const next: KnowledgeModels = { ...current, [config.kind]: config, revision: revision + 1 };
      this.database.db
        .insert(settings)
        .values({ id: 1, models: next })
        .onConflictDoUpdate({ target: settings.id, set: { models: next } })
        .run();
      return next;
    })();
  }

  /**
   * Resolve each call's credential reference; missing/revoked credentials cannot bypass failure using old snapshots.
   */
  async resolve<T extends ModelConnection>(config: T): Promise<T> {
    if (!config.secretRef) {
      return { ...config };
    }
    if (!/^[a-f0-9-]{36}$/u.test(config.secretRef)) {
      throw new KnowledgeError('MODEL_CONFIG_INVALID', '凭据引用无效');
    }
    try {
      return {
        ...config,
        apiKey: await readFile(join(this.directory, 'credentials', config.secretRef), 'utf8'),
      };
    } catch {
      throw new KnowledgeError('MODEL_CREDENTIAL_UNAVAILABLE', '模型凭据已撤销或不可读');
    }
  }
}
