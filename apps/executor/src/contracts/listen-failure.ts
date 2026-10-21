/**
 * @author Codex
 * @description Defines bounded listener failure diagnostics without raw exception text or credentials.
 */
import { z } from 'zod';

export const listenFailureSchema = z.strictObject({
  stage: z.literal('mcp-listen'),
  address: z.ipv4(),
  port: z.number().int().min(0).max(65535),
  systemCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
});
export type ListenFailure = z.infer<typeof listenFailureSchema>;
