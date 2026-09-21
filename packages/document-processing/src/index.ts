/**
 * @author Codex
 * @description Exposes shared document parsing and archive traversal without Host dependencies.
 */
export { parseDocument, createOcrProbeImage } from './byte-document.js';
export { expandArchive, documentFormat } from './archive.js';
export { DocumentProcessingError } from './types.js';
export { parseDocumentFile } from './file-document.js';
export { expandArchiveFile } from './file-archive.js';
export type { FileArchiveLeaf, ArchiveFileOptions } from './file-archive.js';
export type { ParsedSection, ParseOptions, ArchiveLeaf, SourceLocator } from './types.js';

export { assessDocumentCoverage } from './coverage/index.js';
export type { CoverageInput, PdfPageEvidence } from './coverage/index.js';
