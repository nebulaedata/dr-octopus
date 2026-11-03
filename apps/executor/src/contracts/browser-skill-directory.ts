/**
 * @author Codex
 * @description Restricts Runtime-to-Main folder opening to fixed browser skill identities and a matching request receipt.
 */
import { z } from 'zod';

export const skillDirectoryRequestSchema = z.strictObject({
  type: z.literal('skill-directory.open'),
  requestId: z.uuid(),
  installationId: z.uuid(),
  skillId: z.uuid(),
});
export const skillDirectoryResultSchema = z.strictObject({
  type: z.literal('skill-directory.result'),
  requestId: z.uuid(),
  opened: z.boolean(),
});
