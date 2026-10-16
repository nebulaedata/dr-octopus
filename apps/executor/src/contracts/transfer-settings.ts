/**
 * @author Codex
 * @description Defines executor-owned transfer admission limits for full-file HTTP streams without changing Agent-local storage authority.
 */
import { z } from 'zod';

export const defaultTransferSettings = Object.freeze({
  uploadLimitMiB: 2048,
  downloadLimitMiB: 2048,
  temporaryQuotaMiB: 8192,
  minimumFreeSpaceMiB: 512,
});
export const transferSettingsSchema = z
  .strictObject({
    uploadLimitMiB: z.number().int().min(1).max(2048),
    downloadLimitMiB: z.number().int().min(1).max(2048),
    temporaryQuotaMiB: z.number().int().min(1).max(1048576),
    minimumFreeSpaceMiB: z.number().int().min(0).max(1048576),
  })
  .superRefine((value, context) => {
    if (value.temporaryQuotaMiB < Math.max(value.uploadLimitMiB, value.downloadLimitMiB)) {
      context.addIssue({
        code: 'custom',
        path: ['temporaryQuotaMiB'],
        message: '临时存储额度不能小于上传或下载单文件上限。',
      });
    }
  });
export type TransferSettings = z.infer<typeof transferSettingsSchema>;
