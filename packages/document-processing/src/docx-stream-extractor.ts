/**
 * @author Codex
 * @description Preserves the attachment DOCX API through the shared Office stream parser and bounded output adapter.
 */
import { parseDocumentFile } from './file-document.js';
import { zipDirectory } from './file-zip.js';
import { DocumentProcessingError } from './types.js';
import type { StructuredDocumentV1 } from '@octopus/shared/protocol/attachments';
export { DocxTextAccumulator } from './docx-text-accumulator.js';

/**
 * Extract paragraphs and table rows with an explicit attachment truncation contract.
 */
export async function extractDocxText(path: string, maxCharacters: number): Promise<StructuredDocumentV1> {
  const document: StructuredDocumentV1 = {
    schemaVersion: 1,
    kind: 'docx',
    units: [],
    truncated: false,
    diagnostics: [],
  };
  let characters = 0;
  try {
    for await (const section of parseDocumentFile(path, 'docx', { ocrMode: 'off' })) {
      const remaining = maxCharacters - characters;
      if (remaining <= 0 || document.units.length >= 100_000) {
        document.truncated = true;
        break;
      }
      const text = section.text.slice(0, remaining);
      const line = section.locator.paragraph!;
      document.units.push({
        type: section.type ?? 'paragraph',
        text,
        locator: { lineFrom: line, lineTo: line },
      });
      characters += text.length;
      if (text.length < section.text.length) {
        document.truncated = true;
        break;
      }
    }
    if (document.truncated) {
      document.diagnostics.push('DOCX_TEXT_TRUNCATED');
    }
    if ((await zipDirectory(path)).some((entry) => entry.name.startsWith('word/media/'))) {
      document.diagnostics.push('DOCX_IMAGES_OMITTED');
    }
    return document;
  } catch (error) {
    throw Object.assign(new Error(error instanceof Error ? error.message : 'Office parsing failed.'), {
      code:
        error instanceof DocumentProcessingError && error.code === 'DOCUMENT_LIMIT'
          ? 'PROCESSOR_RESOURCE_LIMIT_EXCEEDED'
          : 'PROCESSOR_CONTENT_REJECTED',
      retryable: false,
    });
  }
}
