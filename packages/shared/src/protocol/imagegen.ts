/**
 * @author Codex
 * @description Defines independent OpenAI/Qwen image services, redacted settings and durable tool receipts.
 */
import { z } from 'zod';

export const imagegenProviderIdSchema = z.enum(['openai', 'qwen']);
export type ImagegenProviderId = z.infer<typeof imagegenProviderIdSchema>;
export const imagegenProviderConfigSchema = z
  .object({
    baseUrl: z
      .string()
      .trim()
      .url()
      .max(2048)
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            ['http:', 'https:'].includes(url.protocol) &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash
          );
        } catch {
          return false;
        }
      }),
    model: z.string().trim().min(1).max(200),
  })
  .strict();
const apiKeySchema = z
  .string()
  .trim()
  .max(4096)
  .refine((value) => !/[\r\n]/.test(value));
const storedProviderSchema = imagegenProviderConfigSchema.extend({ apiKey: apiKeySchema }).strict();
export const ImagegenConfigSchema = z
  .object({
    version: z.literal(1),
    enabled: z.boolean(),
    activeProvider: imagegenProviderIdSchema,
    providers: z.object({ openai: storedProviderSchema, qwen: storedProviderSchema }).strict(),
  })
  .strict();
export type ImagegenConfig = z.infer<typeof ImagegenConfigSchema>;
export const imagegenSettingsUpdateSchema = z
  .object({
    revision: z.string().min(1),
    enabled: z.boolean().optional(),
    activeProvider: imagegenProviderIdSchema.optional(),
    provider: imagegenProviderConfigSchema
      .extend({
        id: imagegenProviderIdSchema,
        apiKey: apiKeySchema.nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.enabled !== undefined || value.activeProvider !== undefined || value.provider !== undefined
  );
export type ImagegenSettingsUpdate = z.infer<typeof imagegenSettingsUpdateSchema>;
export interface ImagegenSettingsDto {
  enabled: boolean;
  activeProvider: ImagegenProviderId;
  providers: Record<
    ImagegenProviderId,
    z.infer<typeof imagegenProviderConfigSchema> & { hasApiKey: boolean }
  >;
  revision: string;
}
export interface ImagegenResult {
  version: 1;
  providerId: string;
  modelId: string;
  images: Array<{ path: string; relativePath: string; mimeType: string; width: number; height: number }>;
}
