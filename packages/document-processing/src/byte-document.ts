/**
 * @author Codex
 * @description Complete bounded document parsing shared by knowledge and attachment consumers.
 */
import { parse as parseCsv } from 'csv-parse/sync';
import { parseOffice } from './office.js';
import { parsePdf } from './pdf.js';
import { DocumentProcessingError } from './types.js';
import type { ParsedSection, ParseOptions } from './types.js';

/**
 * Render a small deterministic OCR probe without downloading assets or launching a document worker.
 */
export async function createOcrProbeImage(): Promise<Uint8Array> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(720, 180);
  const context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, 720, 180);
  context.fillStyle = 'black';
  context.font = '36px sans-serif';
  context.fillText('OCTOPUS KNOWLEDGE 2026', 32, 92);
  return canvas.toBuffer('image/png');
}

/**
 * Parse supported documents fully or report a resource/dependency failure; never silently truncate.
 */
export async function parseDocument(
  bytes: Uint8Array,
  format: string,
  options: ParseOptions
): Promise<ParsedSection[]> {
  options.signal?.throwIfAborted();
  if (bytes.length > 100 * 1024 * 1024) {
    throw new DocumentProcessingError('DOCUMENT_LIMIT', '文档超过 100 MiB');
  }
  let sections: ParsedSection[];
  if (format === 'pdf') {
    sections = await parsePdf(bytes, options);
  } else if (['docx', 'xlsx', 'pptx'].includes(format)) {
    sections = await parseOffice(bytes, format, options);
  } else if (['md', 'txt', 'csv'].includes(format)) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0')) {
      throw new DocumentProcessingError('DOCUMENT_INVALID', '文本包含非法 NUL 字符');
    }
    if (format === 'csv') {
      const rows = parseCsv(text, {
        bom: true,
        relaxColumnCount: false,
        maxRecordSize: 1024 * 1024,
      }) as string[][];
      if (rows.length > 200_000) {
        throw new DocumentProcessingError('DOCUMENT_LIMIT', 'CSV 行数超过限制');
      }
      const headings = rows[0] ?? [];
      sections = rows.map((row, index) => ({
        text: row.map((value, col) => `${headings[col] || col + 1}: ${value}`).join('\t'),
        locator: { row: index + 1 },
        extractionMethod: 'text',
      }));
    } else {
      sections = text
        .split(/\n\s*\n/u)
        .map((part, index) => ({ text: part, locator: { paragraph: index + 1 }, extractionMethod: 'text' }));
    }
  } else {
    throw new DocumentProcessingError('DOCUMENT_UNSUPPORTED', '不支持的文档格式');
  }
  if (sections.reduce((size, part) => size + part.text.length, 0) > 10_000_000) {
    throw new DocumentProcessingError('DOCUMENT_LIMIT', '抽取正文超过一千万字符');
  }
  options.signal?.throwIfAborted();
  return sections.filter((part) => part.text.trim());
}
