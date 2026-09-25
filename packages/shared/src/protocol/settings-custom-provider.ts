/**
 * @author Codex
 * @description Defines creation, discovery and configuration contracts for user-added model services.
 */
import { z } from 'zod';

export const CustomProviderTypeSchema = z.enum([
  'ollama',
  'vllm',
  'lmstudio',
  'openai-compatible',
  'mr-token',
]);
export type CustomProviderType = z.infer<typeof CustomProviderTypeSchema>;
export const ModelServiceApiSchema = z.enum(['openai-completions', 'openai-responses']);
export type ModelServiceApi = z.infer<typeof ModelServiceApiSchema>;
export interface CustomProviderTypeDto {
  id: CustomProviderType;
  name: string;
  defaultBaseUrl: string;
}
export interface CustomProviderConfigurationDto {
  runtime: CustomProviderType;
  baseUrl: string;
  modelId?: string;
  api?: ModelServiceApi;
}
export interface CustomProviderModelDetectionDto {
  reachable: boolean;
  models: Array<{ id: string; name?: string }>;
}
export const CreateCustomProviderBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  runtime: CustomProviderTypeSchema,
});
export const DetectCustomProviderBodySchema = z.object({
  baseUrl: z.url().refine((value) => {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
    );
  }, '请输入不含凭据、查询参数或片段的 HTTP(S) 地址。'),
  apiKey: z
    .string()
    .trim()
    .max(8192)
    .refine((value) => !/[\r\n]/.test(value))
    .optional(),
});
export const ConfigureCustomProviderBodySchema = DetectCustomProviderBodySchema.extend({
  api: ModelServiceApiSchema.optional(),
});
export type CreateCustomProviderBody = z.infer<typeof CreateCustomProviderBodySchema>;
export type DetectCustomProviderBody = z.infer<typeof DetectCustomProviderBodySchema>;
export type ConfigureCustomProviderBody = z.infer<typeof ConfigureCustomProviderBodySchema>;
