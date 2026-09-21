/**
 * @author Codex
 * @description Defines runtime-validated attachment resource, lifecycle, failure, and REST contracts.
 */

import { z } from 'zod';
import { DocumentCoverageV1Schema } from './coverage.js';

export const AttachmentStatusSchema = z.enum([
  'initiated',
  'uploading',
  'verifying',
  'processing',
  'ready',
  'failed',
  'rejected',
  'deleted',
]);

export const AttachmentCapabilityCategorySchema = z.enum([
  'direct-image',
  'extractable-document',
  'manifest-only-binary',
  'rejected',
]);

export const AttachmentPresentationKindSchema = z.enum(['image', 'audio', 'video', 'file']);
export const AttachmentAvailabilitySchema = z.enum(['available', 'unavailable', 'deleted']);

export const AttachmentErrorCodeSchema = z.enum([
  'ATTACHMENT_REQUEST_INVALID',
  'AUTHENTICATION_REQUIRED',
  'ATTACHMENT_NOT_FOUND',
  'UPLOAD_EXPIRED',
  'UPLOAD_OFFSET_CONFLICT',
  'UPLOAD_ALREADY_FINALIZED',
  'ATTACHMENT_STATE_CONFLICT',
  'IDEMPOTENCY_KEY_REUSED',
  'ATTACHMENT_SIZE_LIMIT_EXCEEDED',
  'ATTACHMENT_TYPE_UNSUPPORTED',
  'ATTACHMENT_FORMAT_EVIDENCE_MISMATCH',
  'ATTACHMENT_STRUCTURE_LIMIT_EXCEEDED',
  'ATTACHMENT_PROCESSING_FAILED',
  'ATTACHMENT_NOT_READY',
  'ATTACHMENT_QUOTA_EXCEEDED',
  'ATTACHMENT_STORAGE_PRESSURE',
]);

export const AttachmentFailureSchema = z.object({
  code: AttachmentErrorCodeSchema,
  message: z.string().min(1).max(512),
  retryable: z.boolean(),
});

export const AttachmentCapabilitiesSchema = z.object({
  canPreview: z.boolean(),
  canPlay: z.boolean(),
  canDownload: z.boolean(),
});

export const AttachmentResourceSchema = z.object({
  id: z.uuid(),
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(255),
  declaredMediaType: z.string().max(127).optional(),
  detectedMediaType: z.string().max(127).optional(),
  byteSize: z.number().int().nonnegative(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  status: AttachmentStatusSchema,
  revision: z.number().int().positive(),
  classification: AttachmentCapabilityCategorySchema.optional(),
  presentationKind: AttachmentPresentationKindSchema.optional(),
  error: AttachmentFailureSchema.optional(),
  capabilities: AttachmentCapabilitiesSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  readyAt: z.iso.datetime().optional(),
  coverage: DocumentCoverageV1Schema.optional(),
});

export const AttachmentErrorResponseSchema = z.object({
  error: z.object({
    code: AttachmentErrorCodeSchema,
    message: z.string().min(1).max(512),
    retryable: z.boolean(),
    requestId: z.string().min(1),
    details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  }),
});

export const AttachmentMutationRequestSchema = z.object({
  expectedRevision: z.number().int().positive(),
});

export const AttachmentListResponseSchema = z.object({
  items: z.array(AttachmentResourceSchema).max(10),
});

export const AttachmentResourceJsonSchema = z.toJSONSchema(AttachmentResourceSchema, {
  target: 'draft-7',
});
export const AttachmentErrorResponseJsonSchema = z.toJSONSchema(AttachmentErrorResponseSchema, {
  target: 'draft-7',
});
export const AttachmentMutationRequestJsonSchema = z.toJSONSchema(AttachmentMutationRequestSchema, {
  target: 'draft-7',
});
export const AttachmentListResponseJsonSchema = z.toJSONSchema(AttachmentListResponseSchema, {
  target: 'draft-7',
});

export type AttachmentStatus = z.infer<typeof AttachmentStatusSchema>;
export type AttachmentCapabilityCategory = z.infer<typeof AttachmentCapabilityCategorySchema>;
export type AttachmentPresentationKind = z.infer<typeof AttachmentPresentationKindSchema>;
export type AttachmentErrorCode = z.infer<typeof AttachmentErrorCodeSchema>;
export type AttachmentResourceDto = z.infer<typeof AttachmentResourceSchema>;
export type AttachmentErrorResponse = z.infer<typeof AttachmentErrorResponseSchema>;
export type AttachmentMutationRequest = z.infer<typeof AttachmentMutationRequestSchema>;
