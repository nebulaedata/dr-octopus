/**
 * @author Codex
 * @description Per-page PDF extraction and bounded OCR fallback for scanned or mixed documents.
 */
import { assessDocumentCoverage } from './coverage/index.js';
import { DocumentProcessingError } from './types.js';
import { recognizePdfPage } from './pdf-ocr.js';
import type { PdfPageEvidence } from './coverage/index.js';
import type { ParsedSection, ParseOptions } from './types.js';

/**
 * Process every PDF page independently and release page/image resources before advancing.
 */
export async function parsePdf(bytes: Uint8Array, options: ParseOptions): Promise<ParsedSection[]> {
  const [{ getDocument, OPS }, { createCanvas }] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('@napi-rs/canvas'),
  ]);
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const pdf = await task.promise;
  try {
    if (pdf.numPages > 500) {
      throw new DocumentProcessingError('DOCUMENT_LIMIT', 'PDF 页数超过 500 页');
    }
    const result: ParsedSection[] = [];
    const evidence: PdfPageEvidence[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      options.signal?.throwIfAborted();
      const page = await pdf.getPage(number);
      try {
        const content = await page.getTextContent();
        let text = content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ')
          .trim();
        let extractionMethod: 'text' | 'ocr' = 'text';
        const lowText = text.replace(/\s/gu, '').length < 24;
        const hasImage =
          lowText &&
          (await page.getOperatorList()).fnArray.some((operation) =>
            [
              OPS.paintImageXObject,
              OPS.paintInlineImageXObject,
              OPS.paintImageMaskXObject,
              OPS.paintImageXObjectRepeat,
            ].includes(operation)
          );
        evidence.push({ page: number, text, hasLargeImage: lowText ? hasImage : null });
        const needsOcr =
          options.ocrMode === 'force' || hasImage || (text.match(/\uFFFD/gu)?.length ?? 0) > text.length / 10;
        if (needsOcr) {
          if (options.ocrMode === 'off' || !options.recognizePage) {
            throw new DocumentProcessingError(
              'OCR_NOT_CONFIGURED',
              `第 ${number} 页需要 OCR，请配置识别模型`
            );
          }
          const initial = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({
            scale: Math.min(2, 2400 / Math.max(initial.width, initial.height)),
          });
          if (viewport.width * viewport.height > 20_000_000) {
            throw new DocumentProcessingError('DOCUMENT_LIMIT', 'PDF 页面像素超过限制');
          }
          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          try {
            await page.render({
              canvas: canvas as never,
              canvasContext: canvas.getContext('2d') as never,
              viewport,
            }).promise;
            text = await recognizePdfPage(canvas, options.recognizePage, options.signal);
          } finally {
            canvas.width = 1;
            canvas.height = 1;
          }
          extractionMethod = 'ocr';
        }
        result.push({ text, locator: { page: number }, extractionMethod });
      } finally {
        page.cleanup();
      }
    }
    if (options.onCoverage) {
      const coverage = assessDocumentCoverage({
        format: 'pdf',
        pages: evidence,
        pageCount: pdf.numPages,
        truncated: false,
      });
      options.onCoverage(coverage);
    }
    return result;
  } finally {
    await task.destroy();
  }
}
