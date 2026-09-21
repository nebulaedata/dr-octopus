/**
 * @author Codex
 * @description Defines user-reviewed task grants and bounded unattended execution diagnostics.
 */
import { z } from 'zod';

export const taskToolCapabilitySchema = z.strictObject({
  name: z.string().min(1).max(200),
  identity: z.string().regex(/^[a-f0-9]{64}$/),
  description: z.string().max(4000),
});
export const taskToolCatalogEntrySchema = taskToolCapabilitySchema.extend({
  source: z.string().max(500).optional(),
  unavailableReason: z.string().max(1000).nullable().optional(),
});
export type TaskToolCatalogEntry = z.infer<typeof taskToolCatalogEntrySchema>;
export const taskAuthorizationRefSchema = z.strictObject({
  grantId: z.uuid(),
  grantRevision: z.number().int().positive(),
  executionDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export const taskAuthorizationApprovalSchema = z.strictObject({
  confirmed: z.literal(true),
  executionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  tools: z.array(taskToolCapabilitySchema),
});
export const taskAuthorizationPreviewSchema = z.strictObject({
  taskRevision: z.number().int().positive(),
  executionDigest: z.string(),
  cwd: z.string(),
  tools: z.array(taskToolCatalogEntrySchema),
  authorizedToolIdentities: z.array(taskToolCapabilitySchema.shape.identity),
  warnings: z.array(z.string()),
});
export const taskExecutionEvidenceSchema = z.object({
  sessionId: z.string(),
  attemptId: z.string(),
  ready: z.boolean(),
  tools: z.array(taskToolCatalogEntrySchema),
  code: z.string().max(200).optional(),
  reason: z.string().max(4000).optional(),
  requestId: z.string().optional(),
  toolName: z.string().optional(),
});
export type TaskToolCapability = z.infer<typeof taskToolCapabilitySchema>;
export type TaskAuthorizationRef = z.infer<typeof taskAuthorizationRefSchema>;
export type TaskAuthorizationApproval = z.infer<typeof taskAuthorizationApprovalSchema>;
export type TaskAuthorizationPreview = z.infer<typeof taskAuthorizationPreviewSchema>;
