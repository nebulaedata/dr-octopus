/**
 * @author Codex
 * @description Defines Executor-owned file transfer tools and bounded public metadata without file content.
 */
import { z } from 'zod';

export const TRANSFER_FILE_LIMIT = 2 * 1024 ** 3;
export const transferDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const path = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes('\0'));
const prepare = z.strictObject({
  taskId: z.uuid(),
  path,
  idempotencyKey: z.string().min(1).max(128),
});
export const transferUploadSchema = prepare.extend({
  totalBytes: z.number().int().min(0).max(TRANSFER_FILE_LIMIT),
  sha256: transferDigestSchema.optional(),
});
export const transferDownloadSchema = prepare;
export const transferIdSchema = z.strictObject({ transferId: z.uuid() });
export const transferControlSchemas = {
  file_upload_prepare: transferUploadSchema,
  file_download_prepare: transferDownloadSchema,
  file_transfer_status: transferIdSchema,
  file_transfer_cancel: transferIdSchema,
};
export type TransferControlName = keyof typeof transferControlSchemas;
export const transferResultSchema = z.strictObject({
  transferId: z.uuid(),
  taskId: z.uuid(),
  direction: z.enum(['upload', 'download']),
  status: z.enum([
    'preparing',
    'ready',
    'transferring',
    'verifying',
    'committing',
    'completed',
    'cancelled',
    'failed',
    'expired',
    'unknown',
  ]),
  path,
  totalBytes: z.number().int().min(0).max(TRANSFER_FILE_LIMIT),
  transferredBytes: z.number().int().min(0).max(TRANSFER_FILE_LIMIT),
  sha256: transferDigestSchema.optional(),
  destinationEffect: z.enum(['applied', 'not_applied', 'unknown']),
  errorCode: z.string().max(128).optional(),
  cleanupPending: z.boolean(),
  expiresAt: z.number().int(),
  pollAfterMs: z.number().int(),
});
export type TransferResult = z.infer<typeof transferResultSchema>;

/**
 * Terminal results never accept another body or restart publication.
 */
export function isTransferTerminal(status: TransferResult['status']): boolean {
  return ['completed', 'cancelled', 'failed', 'expired', 'unknown'].includes(status);
}
