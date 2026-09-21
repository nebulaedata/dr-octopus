/**
 * @author Codex
 * @description Executes private standalone inference using current daemon-owned model settings and credentials.
 */
import { KnowledgeError } from '../definitions/error.js';
import { KnowledgeEmbeddings } from './models/embedding.js';
import { recognizePage } from './models/ocr.js';
import { rerankCandidates } from './models/reranker.js';
import type { KnowledgeCommand } from '../daemon/protocol.js';
import type { KnowledgeModelSettings } from './model-settings.js';
import type { KnowledgeBlobStore } from './blob-store.js';

type ModelCommand = Extract<KnowledgeCommand, { operation: `models.${string}` }>;

/**
 * Require explicit local model invocation authority; never infer it from knowledge write access.
 */
export async function executeKnowledgeModel(
  command: ModelCommand,
  models: KnowledgeModelSettings,
  blobs: KnowledgeBlobStore,
  signal?: AbortSignal
): Promise<unknown> {
  signal?.throwIfAborted();
  if (command.context.modelAccess === 'none') {
    throw new KnowledgeError('MODEL_ACCESS_DENIED', '当前调用方未获得本地模型调用权限');
  }
  const settings = models.get();
  switch (command.operation) {
    case 'models.ocr': {
      if (!settings.ocr || settings.ocr.mode === 'off') {
        throw new KnowledgeError('OCR_NOT_CONFIGURED', '请先在知识库模型设置中配置并启用 OCR');
      }
      const source = await blobs.fingerprint(command.input.blobSha256);
      if (source.size > 20 * 1024 * 1024) {
        throw new KnowledgeError('INVALID_INPUT', 'OCR 图片不得超过 20 MiB');
      }
      const bytes = await blobs.read(command.input.blobSha256);
      return { text: await recognizePage(await models.resolve(settings.ocr), bytes, signal) };
    }
    case 'models.embed': {
      if (!settings.embedding) {
        throw new KnowledgeError('MODEL_NOT_CONFIGURED', '请先在知识库模型设置中配置 Embedding');
      }
      if (command.input.texts.reduce((sum, text) => sum + text.length, 0) > 48_000) {
        throw new KnowledgeError('INVALID_INPUT', 'Embedding 文本总长度不得超过 48000 字符');
      }
      const adapter = new KnowledgeEmbeddings(await models.resolve(settings.embedding), signal);
      return {
        vectors: await adapter.embedDocuments(command.input.texts),
        dimensions: settings.embedding.dimensions,
      };
    }
    case 'models.rerank': {
      if (!settings.reranker?.enabled) {
        throw new KnowledgeError('MODEL_NOT_CONFIGURED', '请先在知识库模型设置中配置并启用 Reranker');
      }
      return {
        results: await rerankCandidates(
          await models.resolve(settings.reranker),
          command.input.query,
          command.input.documents,
          signal
        ),
      };
    }
  }
}
