/**
 * @author Codex
 * @description Verifies PDF coverage classification and optional private-file processing through Workspace delivery.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import test from 'node:test';
import { assessDocumentCoverage } from '@octopus/document-processing';
/**
 * Applies the common coverage entry to PDF evidence.
 */
const assessPdfPages = (pages, pageCount) =>
  assessDocumentCoverage({ format: 'pdf', pages, pageCount, truncated: false });
import { ProcessorSupervisor } from '../dist/modules/attachments/workers/processor-supervisor.js';
import { LocalFileBlobStore } from '../dist/lib/attachment-storage/local-file-blob-store.js';
import { createDatabase } from '../dist/db/client.js';
import { AttachmentsRepository } from '../dist/modules/attachments/attachments.repository.js';
import { AgentAttachmentAdapter } from '../dist/modules/attachments/agent-attachment-adapter.js';

test('Sparse and repeated watermark text does not hide image-based PDF pages', () => {
  const pages = Array.from({ length: 4 }, (_, index) => ({
    page: index + 1,
    text: 'watermark '.repeat(10),
    hasLargeImage: true,
  }));
  const assessment = assessPdfPages(pages, 4);
  assert.equal(assessment.findings[0].code, 'SCAN_LIKELY');
  assert.equal('ocr' in assessment.processing, false);
  assert.equal(assessment.textCoverage, 'partial');
  assert.equal(assessment.findings[0].count, 4);
});

test('Mixed, unassessed, and text-layer pages remain distinguishable', () => {
  const text = { page: 1, text: 'paragraph '.repeat(100), hasLargeImage: false };
  const scan = { page: 2, text: '', hasLargeImage: true };
  assert.equal(assessPdfPages([text, scan], 2).textCoverage, 'partial');
  assert.equal(assessPdfPages([text], 2).textCoverage, 'unknown');
  assert.equal(assessPdfPages([{ ...text, hasLargeImage: null }], 1).textCoverage, 'unknown');
  assert.equal(assessPdfPages([text], 1).textCoverage, 'text-layer-only');
  assert.equal(assessPdfPages([{ ...text, hasLargeImage: true }], 1).textCoverage, 'partial');
});

test(
  'Private scanned PDF completes processing, persists assessment, and delivers only Workspace paths',
  {
    skip: !process.env.OCTOPUS_PDF_ACCEPTANCE_PATH,
  },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'octopus-pdf-delivery-'));
    const database = createDatabase(':memory:');
    t.after(async () => {
      database.sqlite.close();
      await rm(root, { recursive: true, force: true });
    });
    const blobs = new LocalFileBlobStore(join(root, 'blobstore'));
    await blobs.initialize();
    const staging = await blobs.createStaging();
    await copyFile(process.env.OCTOPUS_PDF_ACCEPTANCE_PATH, blobs.resolveForProcessor(staging));
    const original = await blobs.publish(staging, await blobs.inspect(staging));
    const id = randomUUID();
    const repository = new AttachmentsRepository(database);
    repository.createUpload({
      id,
      workspaceId: 'workspace-a',
      ownerId: 'user-a',
      name: 'scan.pdf',
      declaredMediaType: 'application/pdf',
      uploadLength: original.byteSize,
      stagingKey: staging,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      idempotencyKey: randomUUID(),
    });
    database.sqlite
      .prepare(`INSERT INTO blobs(sha256,storage_key,byte_size,state,created_at) VALUES(?,?,?,'published',?)`)
      .run(original.sha256, original.storageKey, original.byteSize, new Date().toISOString());
    database.sqlite
      .prepare(
        `UPDATE attachments SET status='processing',sha256=?,blob_sha256=?,detected_mime='application/pdf',classification='extractable-document' WHERE id=?`
      )
      .run(original.sha256, original.sha256, id);
    const result = await new ProcessorSupervisor(join(root, 'blobstore')).run({
      jobId: randomUUID(),
      attachmentId: id,
      sourceKey: original.storageKey,
      sha256: original.sha256,
      detectedMediaType: 'application/pdf',
      limits: {
        wallTimeMs: 120_000,
        maxRssBytes: 1024 ** 3,
        maxOutputBytes: 256 * 1024 ** 2,
        maxOutputFiles: 1000,
        maxImagePixels: 40_000_000,
        maxPages: 500,
        maxExtractedCharacters: 2_000_000,
      },
    });
    const published = new Map();
    for (const output of result.manifest.outputs) {
      published.set(output.localId, await blobs.publish(result.outputKeys.get(output.localId), output));
    }
    const dto = repository.completeProcessing({
      attachmentId: id,
      manifest: result.manifest,
      published,
      chunks: [],
      presentationKind: 'file',
    });
    assert.equal('ocr' in dto.coverage.processing, false);
    assert.equal(dto.coverage.textCoverage, 'partial');
    assert.ok(dto.coverage.findings.some((finding) => finding.code === 'SCAN_LIKELY'));
    const delivered = await new AgentAttachmentAdapter(repository, blobs).resolve([dto], {
      sessionId: 'sample-session',
      workspaceCwd: root,
      modelInputs: new Set(['text']),
      maxInlineCharacters: 100_000,
    });
    const manifest = delivered.manifests[0];
    for (const path of [
      manifest.originalPath,
      manifest.extractedPath,
      manifest.outputDirectory,
      manifest.temporaryDirectory,
    ]) {
      const local = relative(root, path);
      assert.ok(!isAbsolute(local) && !local.startsWith('..'));
    }
    const document = JSON.parse(await readFile(manifest.extractedPath, 'utf8'));
    assert.deepEqual(document.coverage, dto.coverage);
    assert.equal(manifest.outputDirectory, join(root, 'output'));
    assert.ok(!delivered.promptSuffix.includes(process.env.OCTOPUS_PDF_ACCEPTANCE_PATH));
    assert.match(delivered.promptSuffix, /text_coverage="partial"/u);
    assert.doesNotMatch(delivered.promptSuffix, /OCR|ocr_status/u);
    t.diagnostic(
      JSON.stringify({
        format: dto.coverage.format,
        scanPages: dto.coverage.findings.find((finding) => finding.code === 'SCAN_LIKELY')?.count,
        extractedCharacters: result.manifest.summary.extractedCharacters,
      })
    );
  }
);
