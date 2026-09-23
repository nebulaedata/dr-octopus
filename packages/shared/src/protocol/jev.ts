/**
 * @author Codex
 * @description Public Jev policy contracts; API credentials are supplied by the Agent environment.
 */
import { z } from 'zod';

export const jevSettingsSchema = z
  .object({
    model: z
      .string()
      .trim()
      .regex(/^jev-[a-zA-Z0-9.-]+$/u)
      .max(100)
      .default('jev-1.13.0'),
  })
  .strict();

export const jevSettingsUpdateSchema = jevSettingsSchema
  .extend({
    revision: z.string().min(1).max(100),
  })
  .strict();

export type JevSettings = z.infer<typeof jevSettingsSchema>;
export type JevSettingsUpdate = z.infer<typeof jevSettingsUpdateSchema>;
export const jevCredentialUpdateSchema = z
  .object({
    revision: z.string().min(1).max(100),
    apiKey: z
      .string()
      .trim()
      .min(1)
      .max(4096)
      .regex(/^[\x21-\x7e]+$/u)
      .nullable(),
  })
  .strict();
export type JevCredentialUpdate = z.infer<typeof jevCredentialUpdateSchema>;
export type JevSettingsSnapshot = JevSettings & {
  revision: string;
  hasApiKey: boolean;
  environmentRevision: string;
  hasStoredApiKey: boolean;
  apiKeyOverridden: boolean;
};
export interface JevProbeResult {
  model: string;
  latencyMs: number;
}
