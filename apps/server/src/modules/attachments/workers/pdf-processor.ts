/**
 * @author Codex
 * @description Extracts existing PDF text and content coverage evidence without rendering page images.
 */
import { pdfResourceOptions } from './pdf-resources.js';
import { inspectPdfPageImages } from './pdf-page-images.js';
import { assessDocumentCoverage } from '@octopus/document-processing';
import type { PdfPageEvidence } from '@octopus/document-processing';
import type {
  ProcessorLimitsV1,
  StructuredDocumentV1,
  ArtifactManifestV1,
} from '@octopus/shared/protocol/attachments';

/**
 * Inspects raster resources without decoding them, then extracts text once per page.
 */
export async function processPdf(
  source: Buffer,
  limits: ProcessorLimitsV1
): Promise<{ document: StructuredDocumentV1; summary: ArtifactManifestV1['summary'] }> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: new Uint8Array(source),
    useSystemFonts: false,
    ...pdfResourceOptions(),
  });
  const pdf = await task.promise;
  try {
    if (pdf.numPages > limits.maxPages) {
      throw Object.assign(new Error('PDF page limit exceeded.'), {
        code: 'PROCESSOR_RESOURCE_LIMIT_EXCEEDED',
        retryable: false,
      });
    }
    const imageEvidence = await inspectPdfPageImages(source);
    const pageEvidence: PdfPageEvidence[] = [];
    const units: StructuredDocumentV1['units'] = [];
    let characters = 0;
    for (
      let pageNumber = 1;
      pageNumber <= pdf.numPages && characters < limits.maxExtractedCharacters;
      pageNumber += 1
    ) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .trim();
      pageEvidence.push({ page: pageNumber, text, hasLargeImage: imageEvidence[pageNumber - 1] ?? null });
      characters += text.length;
      if (text !== '') {
        units.push({ locator: { page: pageNumber }, type: 'paragraph', text });
      }
      page.cleanup();
    }
    const coverage = assessDocumentCoverage({
      format: 'pdf',
      pages: pageEvidence,
      pageCount: pdf.numPages,
      truncated: characters >= limits.maxExtractedCharacters,
    });
    const document: StructuredDocumentV1 = {
      coverage,
      schemaVersion: 1,
      kind: 'pdf',
      units,
      truncated: characters >= limits.maxExtractedCharacters,
      diagnostics: coverage.textCoverage === 'text-layer-only' ? [] : ['PDF_TEXT_COVERAGE_INCOMPLETE'],
    };

    return { document, summary: { pageCount: pdf.numPages, extractedCharacters: characters, coverage } };
  } finally {
    await task.destroy();
  }
}
