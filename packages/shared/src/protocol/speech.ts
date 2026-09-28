/**
 * @author Codex
 * @description Defines speech service settings and bounded browser audio transcription contracts.
 */
import { z } from 'zod';

export const speechMaxAudioBytes = 10 * 1024 * 1024;
export const speechMaxRecordingMs = 120_000;
export const speechProviderIdSchema = z.enum(['openai', 'qwen']);
export type SpeechProviderId = z.infer<typeof speechProviderIdSchema>;
export const speechProviderConfigSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .url()
    .max(2048)
    .refine((value) => {
      if (!URL.canParse(value)) {
        return false;
      }
      const url = new URL(value);
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    }),
  model: z.string().trim().min(1).max(200),
});
export const speechSettingsSchema = z.object({
  enabled: z.boolean(),
  activeProvider: speechProviderIdSchema,
  providers: z.object({ openai: speechProviderConfigSchema, qwen: speechProviderConfigSchema }),
});
export const speechSettingsUpdateSchema = z
  .object({
    revision: z.string(),
    enabled: z.boolean().optional(),
    activeProvider: speechProviderIdSchema.optional(),
    provider: speechProviderConfigSchema
      .extend({
        id: speechProviderIdSchema,
        apiKey: z
          .string()
          .trim()
          .max(4096)
          .refine((value) => !/[\r\n]/.test(value))
          .nullable()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.enabled !== undefined || value.activeProvider !== undefined || value.provider !== undefined
  );
export type SpeechSettingsUpdate = z.infer<typeof speechSettingsUpdateSchema>;
export type SpeechProviderConfigDto = z.infer<typeof speechProviderConfigSchema> & { hasApiKey: boolean };
export type SpeechSettingsDto = Omit<z.infer<typeof speechSettingsSchema>, 'providers'> & {
  revision: string;
  providers: Record<SpeechProviderId, SpeechProviderConfigDto>;
};
export interface SpeechTranscriptionDto {
  text: string;
}
