/**
 * @author Codex
 * @description Bilingual public message catalog for attachment-domain error codes.
 * Most sites already throw English; site variants pin the two Chinese sites while every other
 * site falls back to the bilingual generic.
 */

import { registerErrorMessages } from '../../lib/i18n/error-catalog.js';
import type { ErrorMessageCatalog } from '../../lib/i18n/error-catalog.js';

/**
 * Attachment-domain message variants keyed by stable error code.
 */
export const attachmentErrorMessages: ErrorMessageCatalog = {
  ATTACHMENT_NOT_FOUND: [
    { en: 'The attachment was not found.', 'zh-CN': '附件不存在或已被删除。' },
    {
      match: '附件原文不可用',
      en: 'The attachment content is unavailable.',
      'zh-CN': '附件原文不可用',
    },
  ],
  ATTACHMENT_NOT_READY: [
    { en: 'The attachment is not ready yet.', 'zh-CN': '附件尚未准备好。' },
    {
      match: '附件原文尚未准备好',
      en: 'The attachment content is not ready yet.',
      'zh-CN': '附件原文尚未准备好',
    },
  ],
};

/**
 * Merges the attachment-domain catalog into the shared error-message registry at Server boot.
 */
export function registerAttachmentErrorMessages(): void {
  registerErrorMessages('attachments', attachmentErrorMessages);
}
