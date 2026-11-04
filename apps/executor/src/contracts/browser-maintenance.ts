/**
 * @author Codex
 * @description Defines credential-free evidence and revision-bound Browser Host maintenance results.
 */
import { z } from 'zod';

export const browserCheckSchema = z.strictObject({
  id: z.string().max(100),
  status: z.enum(['pass', 'fail', 'unknown', 'notApplicable']),
  code: z.string().max(100),
  expected: z.string().max(30000),
  actual: z.string().max(30000),
});
export const browserMaintenanceSchema = z.strictObject({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  at: z.iso.datetime(),
  phase: z.enum(['ready', 'repairable', 'confirmationRequired', 'blocked']),
  hostName: z.string().max(128),
  bundleId: z.string().max(64),
  checks: z.array(browserCheckSchema).max(40),
});
export const browserRepairSchema = z.strictObject({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  confirmReplacement: z.boolean().default(false),
});
export type BrowserMaintenance = z.infer<typeof browserMaintenanceSchema>;
export type BrowserCheck = z.infer<typeof browserCheckSchema>;
