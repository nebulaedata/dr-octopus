/**
 * @author Codex
 * @description Describes only the owned upstream stdio connection and distinguishes package and protocol-reported versions.
 */
import { z } from 'zod';

export const windowsMcpStatusSchema = z.strictObject({
  state: z.enum(['connected', 'failed', 'closed']),
  backendEpoch: z.uuid(),
  upstreamVersion: z.string().min(1).max(32),
  serverVersion: z.string().max(128),
  toolNames: z.array(z.string().min(1).max(128)).max(64),
});
export type WindowsMcpStatus = z.infer<typeof windowsMcpStatusSchema>;
