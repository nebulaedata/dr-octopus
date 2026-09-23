/**
 * @author root
 * @description Defines the immutable V1 product attachment security ceiling and defaults.
 */

import { PRODUCT_FORMATS } from '../classifier/media-type-rules.js';
import type { AttachmentSecurityPolicy, SupportedAttachmentFormat } from '../definitions/types.js';

export const DEFAULT_ATTACHMENT_POLICY: AttachmentSecurityPolicy = Object.freeze({
  version: 'attachment-policy-v1',
  allowedFormats: PRODUCT_FORMATS,
  deniedFormats: new Set<SupportedAttachmentFormat>(),
  maxAttachmentBytes: 100 * 1024 * 1024,
  maxImagePixels: 40_000_000,
  maxDocumentPages: 500,
  maxInlineCharacters: 100_000,
  allowMaterialization: true,
});
