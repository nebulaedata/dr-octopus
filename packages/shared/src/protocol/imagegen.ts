/**
 * @author Codex
 * @description Defines image generation configuration and durable tool receipts.
 */
import { z } from 'zod';

export const ImagegenConfigSchema = z
  .object({
    providerId: z.string().trim().min(1),
    modelId: z.string().trim().min(1),
    adapter: z.enum(['openrouter', 'openai-images', 'google-gemini']),
  })
  .strict();
export type ImagegenConfig = z.infer<typeof ImagegenConfigSchema>;
export interface ImagegenCandidate extends ImagegenConfig {
  name: string;
  providerName: string;
  available: boolean;
  supportsReferenceImages: boolean;
  requiresProtocolConfirmation: boolean;
}
export interface ImagegenSettingsDto {
  config: ImagegenConfig | null;
  available: boolean;
  effect: 'next_call';
}
export interface ImagegenResult {
  version: 1;
  providerId: string;
  modelId: string;
  images: Array<{ path: string; relativePath: string; mimeType: string; width: number; height: number }>;
}
