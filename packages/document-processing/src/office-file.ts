/**
 * @author Codex
 * @description Provides the common file-input, incremental-section API with complete-output resource limits.
 */
import { OfficeCoverageCollector } from './coverage/office.js';
import { stat } from 'node:fs/promises';
import { openOffice } from './office-container.js';
import { wordSections, slideSections } from './office-word-slides.js';
import { spreadsheetSections } from './office-spreadsheet.js';
import { DocumentProcessingError } from './types.js';
import type { ParsedSection, ParseOptions } from './types.js';

/**
 * Yield ordered sections with backpressure. Consumers may stop early; complete consumers fail on any limit.
 */
export async function* parseOfficeFile(
  path: string,
  format: string,
  options: ParseOptions
): AsyncGenerator<ParsedSection> {
  options.signal?.throwIfAborted();
  if ((await stat(path)).size > 100 * 1024 * 1024) {
    throw new DocumentProcessingError('DOCUMENT_LIMIT', '文档超过 100 MiB');
  }
  let coverage: OfficeCoverageCollector | undefined;
  let outcome: 'completed' | 'truncated' | 'failed' = 'truncated';
  let sections: AsyncIterable<ParsedSection> | Iterable<ParsedSection>;
  if (['docx', 'pptx', 'xlsx'].includes(format)) {
    const required =
      format === 'docx'
        ? 'word/document.xml'
        : format === 'pptx'
          ? 'ppt/presentation.xml'
          : 'xl/workbook.xml';
    const container = await openOffice(path, required, options.signal);
    if (options.onCoverage) {
      coverage = new OfficeCoverageCollector(format as 'docx' | 'pptx' | 'xlsx', [
        ...container.entries.keys(),
      ]);
      container.coverage = coverage;
    }
    sections =
      format === 'docx'
        ? wordSections(container)
        : format === 'pptx'
          ? slideSections(container)
          : spreadsheetSections(container, options.temporaryDirectory);
  } else {
    throw new DocumentProcessingError('DOCUMENT_UNSUPPORTED', '不支持的 Office 格式');
  }
  let characters = 0;
  let count = 0;
  try {
    for await (const section of sections) {
      options.signal?.throwIfAborted();
      characters += section.text.length;
      if (characters > 10_000_000 || ++count > 100_000) {
        throw new DocumentProcessingError('DOCUMENT_LIMIT', '正文字符或段落数量超过限制');
      }
      if (section.text.trim()) {
        yield section;
      }
    }
    outcome = 'completed';
  } catch (error) {
    outcome = 'failed';
    throw error;
  } finally {
    if (coverage) {
      options.onCoverage?.(coverage.report(outcome));
    }
  }
}
