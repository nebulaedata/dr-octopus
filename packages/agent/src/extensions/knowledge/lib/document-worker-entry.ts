/**
 * @author Codex
 * @description Disposable document processing entry using immutable blobs and model snapshots only.
 */
import { basename } from 'node:path';
import { expandArchiveFile, parseDocumentFile } from '@octopus/document-processing';
import { KnowledgeBlobStore } from './blob-store.js';
import { recognizePage } from './models/ocr.js';
import type { DocumentWork, DocumentWorkResult } from './document-worker.js';
import type { ImportSource } from '../definitions/types.js';

/**
 * Expand safely into content-addressed blobs, then let the parent persist individual leaf outcomes.
 */
async function perform(work: DocumentWork): Promise<DocumentWorkResult> {
  const store = new KnowledgeBlobStore(work.directory);
  const path = await store.verifiedPath(work.source.blobSha256);
  if (work.kind === 'expand') {
    const leaves = expandArchiveFile(work.source.title, path, {
      temporaryDirectory: work.temporaryDirectory,
      budget: {
        entries: 0,
        expandedBytes: 0,
        maxEntries: 2000,
        maxExpandedBytes: 256 * 1024 * 1024,
        maxEntryBytes: 100 * 1024 * 1024,
        maxDepth: 4,
      },
    });
    const sources: ImportSource[] = [];
    for await (const leaf of leaves) {
      const blob = await store.putFile(leaf.localPath, work.temporaryDirectory);
      sources.push({
        title: basename(leaf.path),
        archivePath: leaf.path,
        format: leaf.format,
        blobSha256: blob.sha256,
      });
    }
    return { sources };
  }
  const ocr = work.ocr;
  const sections = parseDocumentFile(path, work.source.format, {
    temporaryDirectory: work.temporaryDirectory,
    ocrMode: ocr?.mode ?? 'auto',
    recognizePage: ocr ? (png, signal) => recognizePage(ocr, png, signal) : undefined,
  });
  let sectionCount = 0;
  for await (const section of sections) {
    await new Promise<void>((resolve, reject) => {
      process.once('message', resolve);
      process.send?.({ section }, (error) => {
        if (error) {
          reject(error);
        }
      });
    });
    sectionCount++;
  }
  return { sectionCount };
}

process.once('message', (work: DocumentWork) => {
  const memory = setInterval(() => {
    if (process.memoryUsage().rss > 1024 * 1024 * 1024) {
      process.exit(72);
    }
  }, 250);
  memory.unref();
  void perform(work)
    .then(
      (result) => process.send?.({ result }),
      (error: unknown) => {
        const failure = error as { code?: string; message?: string; retryable?: boolean };
        process.send?.({
          error: {
            code: failure.code ?? 'PARSER_FAILED',
            message: failure.code ? failure.message : '文档格式损坏或无法解析',
            retryable: failure.retryable ?? false,
          },
        });
      }
    )
    .finally(() => clearInterval(memory));
});
