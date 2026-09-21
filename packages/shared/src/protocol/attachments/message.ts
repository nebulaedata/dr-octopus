/**
 * @author Codex
 * @description Defines the runtime-validated attachment projection embedded in conversation messages.
 */

import { z } from 'zod';
import { DocumentCoverageV1Schema } from './coverage.js';
import {
  AttachmentAvailabilitySchema,
  AttachmentCapabilitiesSchema,
  AttachmentPresentationKindSchema,
} from './resource.js';

export const AttachmentPreviewKindSchema = z.enum(['image', 'markdown', 'code']);
export const AttachmentCodeLanguageSchema = z.enum([
  'c',
  'cpp',
  'csharp',
  'go',
  'java',
  'javascript',
  'json',
  'plaintext',
  'python',
  'rust',
  'sql',
  'typescript',
  'yaml',
]);

export const MessageAttachmentSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(255),
    detectedMediaType: z.string().min(1).max(127),
    byteSize: z.number().int().nonnegative(),
    presentationKind: AttachmentPresentationKindSchema,
    availability: AttachmentAvailabilitySchema,
    previewKind: AttachmentPreviewKindSchema.optional(),
    previewLanguage: AttachmentCodeLanguageSchema.optional(),
    previewUrl: z.string().optional(),
    contentUrl: z.string().optional(),
    capabilities: AttachmentCapabilitiesSchema,
    coverage: DocumentCoverageV1Schema.optional(),
  })
  .superRefine((value, context) => {
    if (value.previewKind === 'code' && value.previewLanguage === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Code previews require a Host-selected language.',
        path: ['previewLanguage'],
      });
    }
    if (value.previewKind !== 'code' && value.previewLanguage !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Preview language is valid only for code previews.',
        path: ['previewLanguage'],
      });
    }
  });

export type AttachmentPreviewKind = z.infer<typeof AttachmentPreviewKindSchema>;
export type AttachmentCodeLanguage = z.infer<typeof AttachmentCodeLanguageSchema>;
export type MessageAttachmentDto = z.infer<typeof MessageAttachmentSchema>;
