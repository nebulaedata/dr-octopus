/**
 * @author Codex
 * @description Adapts common streamed document sections and archive outcomes to bounded attachment artifacts.
 */
import { DocumentProcessingError, expandArchiveFile, parseDocumentFile } from '@octopus/document-processing';
import type { ParsedSection } from '@octopus/document-processing';
import type { StructuredDocumentV1 } from '@octopus/shared/protocol/attachments';

const FORMATS = new Set(['docx', 'pptx', 'xlsx', 'pdf', 'txt', 'md', 'csv']);

/**
 * Consume a shared parser with one total character/unit budget, retaining the original member path in locators.
 */
export async function extractDocument(
  path: string,
  format: string,
  maxCharacters: number,
  temporaryDirectory: string
): Promise<StructuredDocumentV1> {
  const document: StructuredDocumentV1 = {
    schemaVersion: 1,
    kind: format as StructuredDocumentV1['kind'],
    units: [],
    diagnostics: [],
    truncated: false,
  };
  let characters = 0;
  let files = 0;
  /**
   * Bound all outputs together, including locators and diagnostics, without truncating source identity silently.
   */
  function accept(section: ParsedSection, archivePath?: string): boolean {
    const remaining = maxCharacters - characters;
    if (remaining <= 0 || document.units.length >= 100_000) {
      document.truncated = true;
      return false;
    }
    const text = section.text.slice(0, remaining);
    const { paragraph, row, ...locator } = section.locator;
    const line = row ?? paragraph;
    document.units.push({
      text,
      type: section.type ?? (row ? 'table' : 'paragraph'),
      locator: {
        ...locator,
        ...(line ? { lineFrom: line, lineTo: line } : {}),
        ...(archivePath ? { archivePath } : {}),
      },
    });
    characters += text.length;
    if (text.length < section.text.length) {
      document.truncated = true;
      return false;
    }
    return true;
  }
  if (format !== 'zip') {
    for await (const section of parseDocumentFile(path, format, {
      ocrMode: 'off',
      temporaryDirectory,
      onCoverage: (coverage) => {
        document.coverage = coverage;
      },
    })) {
      if (!accept(section)) {
        break;
      }
    }
  } else {
    for await (const leaf of expandArchiveFile('archive.zip', path, { temporaryDirectory })) {
      files++;
      if (!FORMATS.has(leaf.format)) {
        document.diagnostics.push(`ARCHIVE_SKIPPED:${leaf.path}`.slice(0, 256));
        continue;
      }
      if (document.truncated || characters >= maxCharacters) {
        document.truncated = true;
        document.diagnostics.push(`ARCHIVE_TRUNCATED:${leaf.path}`.slice(0, 256));
        continue;
      }
      const firstUnit = document.units.length;
      const previousCharacters = characters;
      try {
        for await (const section of parseDocumentFile(leaf.localPath, leaf.format, {
          ocrMode: 'off',
          temporaryDirectory,
        })) {
          if (!accept(section, leaf.path)) {
            break;
          }
        }
        if (firstUnit === document.units.length) {
          document.diagnostics.push(`ARCHIVE_EMPTY:${leaf.path}`.slice(0, 256));
        }
      } catch (error) {
        // Partial text from a failed member must never be exposed as successfully parsed content.
        document.units.splice(firstUnit);
        characters = previousCharacters;
        const code = error instanceof DocumentProcessingError ? error.code : 'DOCUMENT_INVALID';
        document.diagnostics.push(`ARCHIVE_FAILED:${code}:${leaf.path}`.slice(0, 256));
      }
    }
    if (!files) {
      document.diagnostics.push('ARCHIVE_EMPTY');
    }
  }
  if (document.truncated) {
    document.diagnostics.push('DOCUMENT_TEXT_TRUNCATED');
    if (document.coverage) {
      document.coverage.processing.text = 'truncated';
      document.coverage.assessmentStatus = 'partial';
      document.coverage.textCoverage = 'partial';
      if (!document.coverage.limits.includes('text')) {
        document.coverage.limits.push('text');
      }
    }
  }
  return document;
}
