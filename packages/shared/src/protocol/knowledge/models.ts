/**
 * @author Codex
 * @description Immutable model execution settings independent of Pi chat model configuration.
 */
export interface ModelConnection {
  endpoint: string;
  model: string;
  apiKey?: string;
  secretRef?: string;
  timeoutMs: number;
}

export interface EmbeddingConfig extends ModelConnection {
  kind: 'embedding';
  dimensions: number;
  batchSize: number;
}

export interface RerankerConfig extends ModelConnection {
  kind: 'reranker';
  enabled: boolean;
  maxCandidates: number;
  allowRemoteEvidence: boolean;
}

export interface OcrConfig extends ModelConnection {
  kind: 'ocr';
  mode: 'auto' | 'force' | 'off';
  maxOutputTokens: number;
}

export interface KnowledgeModels {
  revision: number;
  embedding: EmbeddingConfig | null;
  reranker: RerankerConfig | null;
  ocr: OcrConfig | null;
}

export interface RankedCandidate {
  index: number;
  score: number;
}
