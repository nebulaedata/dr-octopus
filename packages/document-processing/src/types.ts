/**
 * @author Codex
 * @description Host-free structured parsing inputs, locations and resource budgets.
 */
import type { DocumentCoverageV1 } from '@octopus/shared/protocol/attachments';

export interface SourceLocator {
  page?: number;
  slide?: number;
  sheet?: string;
  row?: number;
  paragraph?: number;
  archivePath?: string;
}
export interface ParsedSection {
  text: string;
  type?: 'paragraph' | 'table';
  locator: SourceLocator;
  extractionMethod: 'text' | 'ocr';
}
export interface ParseOptions {
  signal?: AbortSignal;
  temporaryDirectory?: string;
  ocrMode: 'auto' | 'force' | 'off';
  /**
   * Receives available coverage; Office also reports early return or extraction failure.
   * An absent callback result means coverage is unknown, never complete.
   */
  onCoverage?: (coverage: DocumentCoverageV1) => void;
  /**
   * Recognize a bounded rasterized page in the caller's model scope.
   */
  recognizePage?: (png: Uint8Array, signal?: AbortSignal) => Promise<string>;
}
export interface ArchiveBudget {
  entries: number;
  expandedBytes: number;
  maxEntries: number;
  maxExpandedBytes: number;
  maxEntryBytes: number;
  maxDepth: number;
}
export interface ArchiveLeaf {
  path: string;
  bytes: Uint8Array;
  format: string;
}

export class DocumentProcessingError extends Error {
  /**
   * Carry a deterministic non-retryable resource or document error across worker IPC.
   */
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'DocumentProcessingError';
  }
}
