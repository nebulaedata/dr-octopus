/**
 * @author Codex
 * @description Adapts attachment Blob storage to the independent format preflight boundary.
 */

import { inspectAttachment } from '../../lib/attachment-preflight/index.js';
import type { LocalFileBlobStore } from '../../lib/attachment-storage/local-file-blob-store.js';
import type { AttachmentEvidence } from '../../lib/attachment-capability/index.js';

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
