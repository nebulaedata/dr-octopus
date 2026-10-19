/**
 * @author Codex
 * @description Defines credential-free recovery status and finite maintenance actions across desktop IPC.
 */
import { z } from 'zod';

export const maintenanceActionSchema = z.strictObject({
  action: z.enum(['reset', 'retry', 'dismiss', 'open-backup', 'copy-details']),
  revision: z.number().int().nonnegative(),
});
export const maintenanceSnapshotSchema = z.strictObject({
  phase: z.enum(['idle', 'stopping', 'backing-up', 'resetting', 'starting', 'succeeded', 'failed']),
  message: z.string().max(300),
  backupPath: z.string().max(30000).nullable(),
  issue: z
    .strictObject({
      revision: z.number().int().nonnegative(),
      code: z.string().max(100),
      title: z.string().max(100),
      description: z.string().max(300),
      impact: z.string().max(300).nullable(),
      recoverable: z.boolean(),
    })
    .nullable(),
});
export const maintenanceResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), data: maintenanceSnapshotSchema }),
  z.strictObject({ ok: z.literal(false), message: z.string().max(300) }),
]);
export type MaintenanceSnapshot = z.infer<typeof maintenanceSnapshotSchema>;
export type MaintenanceResponse = z.infer<typeof maintenanceResponseSchema>;
export type MaintenanceAction = z.infer<typeof maintenanceActionSchema>;
