/**
 * @author Codex
 * @description Persists optional document processing diagnostics alongside admission evidence without changing its ownership.
 */

import { DocumentCoverageV1Schema } from '@octopus/shared/protocol/attachments';
import { inspectAttachment } from '../../infrastructure/attachment-preflight/index.js';
import type { DocumentCoverageV1 } from '@octopus/shared/protocol/attachments';
import type { AttachmentEvidence } from '../../infrastructure/attachment-capability/index.js';
import type { LocalFileBlobStore } from '../../infrastructure/attachment-storage/local-file-blob-store.js';

/**
 * Adds validated processing evidence while retaining the original preflight snapshot.
 */
export function mergeDocumentCoverage(
  evidenceJson: string | null,
  coverage?: DocumentCoverageV1
): string | null {
  if (coverage === undefined) {
    return evidenceJson;
  }
  const existing: unknown = evidenceJson === null ? {} : JSON.parse(evidenceJson);
  return JSON.stringify({
    ...(typeof existing === 'object' && existing !== null ? existing : {}),
    coverage: DocumentCoverageV1Schema.parse(coverage),
  });
}

/**
 * Reads validated coverage; absent or invalid diagnostics do not establish content completeness.
 */
export function readDocumentCoverage(evidenceJson: string | null): DocumentCoverageV1 | undefined {
  if (evidenceJson === null) {
    return undefined;
  }
  try {
    const evidence = JSON.parse(evidenceJson) as { coverage?: unknown };
    const result = DocumentCoverageV1Schema.safeParse(evidence.coverage);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Collects admission evidence without exposing attachment persistence to format inspectors.
 */
export async function collectAttachmentEvidence(
  input: { name: string; declaredMediaType?: string; byteSize: number; sha256: string; storageKey: string },
  blobs: LocalFileBlobStore
): Promise<AttachmentEvidence> {
  return inspectAttachment(input, {
    path: blobs.resolveForProcessor(input.storageKey),
    /**
     * Opens a bounded view of the admitted source through the Blob store.
     */
    openRead: (range) => blobs.openRead(input.storageKey, range),
  });
}

export const ATTACHMENT_PROCESSOR = { id: 'attachment-processor', version: '1.4.0' } as const;
