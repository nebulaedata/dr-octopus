/**
 * @author root
 * @description Freezes the V1 attachment format families and required semantic processors.
 */

import type { AttachmentProcessorCapability, SupportedAttachmentFormat } from '../definitions/types.js';

export const ATTACHMENT_RULE_VERSION = 'attachment-rules-v2';

export const IMAGE_FORMATS = new Set<SupportedAttachmentFormat>(['jpeg', 'png', 'webp']);
export const MEDIA_FORMATS = new Set<SupportedAttachmentFormat>([
  'mp3',
  'wav',
  'ogg',
  'm4a',
  'mp4',
  'webm',
  'mov',
]);
export const TEXT_FORMATS = new Set<SupportedAttachmentFormat>([
  'txt',
  'markdown',
  'json',
  'csv',
  'tsv',
  'source-code',
]);
export const DOCUMENT_FORMATS = new Set<SupportedAttachmentFormat>([
  ...TEXT_FORMATS,
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'zip',
]);
export const PRODUCT_FORMATS = new Set<SupportedAttachmentFormat>([
  ...IMAGE_FORMATS,
  ...DOCUMENT_FORMATS,
  ...MEDIA_FORMATS,
]);

/**
 * Returns the processors required before an admitted format can become ready.
 *
 * @param format Admitted V1 format.
 * @returns Ordered semantic processor capabilities.
 */
export function requiredProcessors(format: SupportedAttachmentFormat): AttachmentProcessorCapability[] {
  if (IMAGE_FORMATS.has(format)) {
    return ['image-optimize'];
  }
  if (format === 'pdf') {
    return ['pdf-text-extract'];
  }
  if (format === 'zip') {
    return ['archive-text-extract'];
  }
  if (format === 'xlsx') {
    return ['spreadsheet-structure-extract'];
  }
  if (format === 'docx' || format === 'pptx') {
    return ['office-text-extract'];
  }
  return [];
}
