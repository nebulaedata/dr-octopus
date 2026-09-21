/**
 * @author Codex
 * @description Routes file sources to streamed Office parsers or the existing bounded non-Office parser.
 */
import { readFile, stat } from 'node:fs/promises';
import { parseOfficeFile } from './office-file.js';
import { parseDocument } from './byte-document.js';
import { DocumentProcessingError } from './types.js';
import type { ParsedSection, ParseOptions } from './types.js';

/**
 * Yield ordered document sections; early return closes every parser-owned stream and scratch file.
 */
export async function* parseDocumentFile(
  path: string,
  format: string,
  options: ParseOptions
): AsyncGenerator<ParsedSection> {
  options.signal?.throwIfAborted();
  if (['docx', 'pptx', 'xlsx'].includes(format)) {
    yield* parseOfficeFile(path, format, options);
    return;
  }
  if ((await stat(path)).size > 100 * 1024 * 1024) {
    throw new DocumentProcessingError('DOCUMENT_LIMIT', '文档超过 100 MiB');
  }
  for (const section of await parseDocument(await readFile(path), format, options)) {
    options.signal?.throwIfAborted();
    yield section;
  }
}
