/**
 * @author Codex
 * @description Defines local model provider creation, discovery and configuration contracts.
 */
import { z } from 'zod';

export const LocalRuntimeSchema = z.enum(['ollama', 'vllm', 'lmstudio']);
export type LocalRuntime = z.infer<typeof LocalRuntimeSchema>;
export interface LocalRuntimeDto {
  id: LocalRuntime;
  name: string;
  defaultBaseUrl: string;
}
export interface LocalProviderConfigurationDto {
  runtime: LocalRuntime;
  baseUrl: string;
  modelId?: string;
}
export interface LocalModelDetectionDto {
  reachable: boolean;
  models: Array<{ id: string; name?: string }>;
}
export const CreateLocalProviderBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  runtime: LocalRuntimeSchema,
});
export const DetectLocalProviderBodySchema = z.object({
  baseUrl: z.url().refine((value) => {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
    );
  }, '请输入不含凭据、查询参数或片段的 HTTP(S) 地址。'),
});
export const ConfigureLocalProviderBodySchema = DetectLocalProviderBodySchema.extend({
  modelId: z.string().trim().min(1).max(512),
});
export type CreateLocalProviderBody = z.infer<typeof CreateLocalProviderBodySchema>;
export type DetectLocalProviderBody = z.infer<typeof DetectLocalProviderBodySchema>;
export type ConfigureLocalProviderBody = z.infer<typeof ConfigureLocalProviderBodySchema>;
