/**
 * @author Codex
 * @description Defines model settings commands and endpoint validation shared by extension pages and Worker.
 */
import { z } from 'zod';
import { skillBudgetSchema, type SkillBudget } from '../builtin-agent/skill-budget';

export const modelSettingsSchema = z.strictObject({
  provider: z.literal('openai-compatible'),
  baseUrl: z
    .url()
    .max(1024)
    .refine((value) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return false;
      }
      return (
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        ['http:', 'https:'].includes(url.protocol)
      );
    }),
  model: z.string().trim().min(1).max(160),
});
export type ModelSettingsSnapshot = {
  settings: ModelSettings | null;
  limits: SkillBudget;
  revision: string;
  canSend: boolean;
  hasKey: boolean;
};
export type ModelSettings = z.infer<typeof modelSettingsSchema>;
/**
 * Binds a credential to an exact normalized endpoint, including its protocol and base path.
 */
export function modelEndpointKey(baseUrl: string): string {
  const url = new URL(modelSettingsSchema.shape.baseUrl.parse(baseUrl));
  return 'openai-compatible:' + url.href.replace(/\/+$/, '');
}

export const modelSettingsRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('settings-snapshot') }),
  z.strictObject({ type: z.literal('settings-read') }),
  z.strictObject({
    type: z.literal('settings-save'),
    settings: modelSettingsSchema,
    apiKey: z.string().max(4096).optional(),
    consent: z.boolean(),
    limits: skillBudgetSchema,
    expectedRevision: z.string().max(64).optional(),
  }),
  z.strictObject({ type: z.literal('credential-status'), baseUrl: modelSettingsSchema.shape.baseUrl }),
  z.strictObject({
    type: z.literal('credential-clear'),
    baseUrl: modelSettingsSchema.shape.baseUrl,
    expectedRevision: z.string().max(64).optional(),
  }),
  z.strictObject({
    type: z.literal('models'),
    baseUrl: modelSettingsSchema.shape.baseUrl,
    apiKey: z.string().max(4096).optional(),
  }),
  z.strictObject({
    type: z.literal('test'),
    settings: modelSettingsSchema,
    apiKey: z.string().max(4096).optional(),
  }),
]);
export type ModelSettingsRequest = z.infer<typeof modelSettingsRequestSchema>;

/**
 * Maps settings errors to safe actionable copy without exposing provider response bodies.
 */
export function modelSettingsError(code: string): string {
  const messages: Record<string, string> = {
    SETTINGS_CONFLICT: '配置已在其他窗口更新，请先加载最新配置或明确保留当前编辑。',
    MODEL_AUTH: '鉴权失败，请检查 API Key。',
    MODEL_NOT_FOUND: '接口或模型不存在，请检查地址和模型名称。',
    MODEL_RATE_LIMIT: '服务请求受限，请稍后重试。',
    MODEL_CONFIGURATION: '接口拒绝当前模型请求，请检查模型配置。',
    MODEL_TIMEOUT: '连接测试超时，请稍后重试。',
    MODEL_EMPTY: '模型未返回有效内容，请检查模型配置。',
    MODEL_UNAVAILABLE: '模型服务不可用，请检查地址或稍后重试。',
    MODEL_INTERRUPTED: '连接测试已中断，请重试。',
    WORKFLOW_STORAGE: '配置未能保存或读取，请重试。',
    WORKFLOW_CONFIGURATION_CHANGED: '模型配置已改变，请重新整理。',
  };
  return messages[code] ?? '请求未完成，请检查配置或稍后重试。';
}
