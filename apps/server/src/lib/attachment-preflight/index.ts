/**
 * @author root
 * @description Collects bounded extension, strict text, media type, and magic-byte evidence before pure capability resolution.
 */

import { fileTypeFromFile } from 'file-type';
import { inspectImageStructure } from './image.js';
import { inspectOfficeContainer } from './office.js';
import { inspectPdfStructure } from './pdf.js';
import { isStrictUtf8 } from './text.js';
import type { PreflightSource } from './types.js';
import type { AttachmentEvidence, SupportedAttachmentFormat } from '../attachment-capability/index.js';

const EXTENSIONS: Record<string, SupportedAttachmentFormat> = {
  jpg: 'jpeg',
  jpeg: 'jpeg',
  png: 'png',
  webp: 'webp',
  pdf: 'pdf',
  docx: 'docx',
  xlsx: 'xlsx',
  pptx: 'pptx',
  zip: 'zip',
  txt: 'txt',
  md: 'markdown',
  json: 'json',
  csv: 'csv',
  tsv: 'tsv',
  ts: 'source-code',
  tsx: 'source-code',
  js: 'source-code',
  jsx: 'source-code',
  py: 'source-code',
  java: 'source-code',
  go: 'source-code',
  rs: 'source-code',
  c: 'source-code',
  cpp: 'source-code',
  h: 'source-code',
  hpp: 'source-code',
  cs: 'source-code',
  sql: 'source-code',
  yaml: 'source-code',
  yml: 'source-code',
  mp3: 'mp3',
  wav: 'wav',
  ogg: 'ogg',
  m4a: 'm4a',
  mp4: 'mp4',
  webm: 'webm',
  mov: 'mov',
};

const EXPECTED_MIME: Record<SupportedAttachmentFormat, readonly string[]> = {
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  webp: ['image/webp'],
  pdf: ['application/pdf'],
  zip: ['application/zip', 'application/x-zip-compressed'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  txt: ['text/plain'],
  markdown: ['text/markdown', 'text/plain'],
  json: ['application/json', 'text/json'],
  csv: ['text/csv'],
  tsv: ['text/tab-separated-values', 'text/plain'],
  'source-code': [
    'text/x-source-code',
    'text/plain',
    'application/javascript',
    'text/javascript',
    'application/typescript',
    'text/x-python',
  ],
  mp3: ['audio/mpeg'],
  wav: ['audio/wav', 'audio/vnd.wave'],
  ogg: ['audio/ogg'],
  m4a: ['audio/mp4', 'audio/x-m4a'],
  mp4: ['video/mp4'],
  webm: ['video/webm'],
  mov: ['video/quicktime'],
};

/**
 * Collects conservative evidence; OOXML structure is confirmed by the isolated processor before ready.
 */
export async function inspectAttachment(
  input: { name: string; declaredMediaType?: string; byteSize: number; sha256: string },
  source: PreflightSource
): Promise<AttachmentEvidence> {
  const extension = input.name.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? '';
  const extensionFormat = EXTENSIONS[extension] ?? 'unknown';
  const detected = await fileTypeFromFile(source.path);
  const format = detected === undefined ? extensionFormat : formatFromDetected(detected.ext, detected.mime);
  const text = detected === undefined && isTextFormat(extensionFormat);
  const textValid = text ? await isStrictUtf8(source) : false;
  const officeStructure = ['docx', 'xlsx', 'pptx'].includes(format)
    ? await inspectOfficeContainer(format, input.byteSize, source)
    : undefined;
  const pdfStructure = format === 'pdf' ? await inspectPdfStructure(source) : undefined;
  const imageStructure = ['jpeg', 'png', 'webp'].includes(format)
    ? await inspectImageStructure(source)
    : undefined;
  const detectedMediaType = text
    ? (EXPECTED_MIME[extensionFormat as SupportedAttachmentFormat][0] ?? 'text/plain')
    : (detected?.mime ?? 'application/octet-stream');
  const declared = input.declaredMediaType?.toLowerCase();
  return {
    filename: input.name,
    byteSize: input.byteSize,
    ...(declared === undefined ? {} : { declaredMediaType: declared }),
    detectedMediaType,
    ...(extension === '' ? {} : { extension: `.${extension}` }),
    sha256: input.sha256,
    formatEvidence: {
      detectedFormat: format,
      extensionMatched: format !== 'unknown' && extensionFormat === format,
      mediaTypeMatched:
        format !== 'unknown' && (declared === undefined || EXPECTED_MIME[format].includes(declared)),
      magicMatched: format !== 'unknown' && (detected !== undefined || textValid),
      ...(officeStructure === undefined ? {} : { containerMatched: officeStructure.valid }),
      ...(pdfStructure === undefined ? {} : { containerMatched: pdfStructure.valid }),
    },
    ...(officeStructure === undefined && pdfStructure === undefined && imageStructure === undefined
      ? {}
      : {
          structure: {
            ...(officeStructure === undefined
              ? {}
              : {
                  entryCount: officeStructure.entryCount,
                  uncompressedBytes: officeStructure.uncompressedBytes,
                  hasMacros: officeStructure.hasMacros,
                  hasActiveContent: officeStructure.hasActiveContent,
                  hasEmbeddedObject: officeStructure.hasEmbeddedObject,
                  compressionRatio:
                    input.byteSize === 0 ? 0 : officeStructure.uncompressedBytes / input.byteSize,
                }),
            ...(pdfStructure === undefined
              ? {}
              : {
                  pageCount: pdfStructure.pageCount,
                  hasActiveContent: pdfStructure.hasActiveContent,
                  hasEmbeddedObject: pdfStructure.hasEmbeddedObject,
                }),
            ...(imageStructure === undefined ? {} : imageStructure),
          },
        }),
  };
}

/**
 * Maps file-type output to the fixed product vocabulary.
 */
function formatFromDetected(extension: string, mime: string): SupportedAttachmentFormat | 'unknown' {
  const candidate = EXTENSIONS[extension.toLowerCase()];
  return candidate !== undefined && EXPECTED_MIME[candidate].includes(mime.toLowerCase())
    ? candidate
    : 'unknown';
}
/**
 * Identifies formats whose strict UTF-8 validation is delegated to the child processor.
 */
function isTextFormat(format: SupportedAttachmentFormat | 'unknown'): boolean {
  return ['txt', 'markdown', 'json', 'csv', 'tsv', 'source-code'].includes(format);
}
