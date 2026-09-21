/**
 * @author Codex
 * @description Defines the first Settings model-provider and default-model HTTP contracts.
 */

import { z } from 'zod';
import type { LocalProviderConfigurationDto } from './settings-local.js';

export const UpdateModelCapabilitiesBodySchema = z
  .object({
    reasoning: z.boolean(),
    input: z
      .array(z.enum(['text', 'image']))
      .min(1)
      .refine((input) => input.includes('text')),
  })
  .strict();
export type UpdateModelCapabilitiesBody = z.infer<typeof UpdateModelCapabilitiesBodySchema>;

export type ModelProviderProvenance = 'builtin' | 'models_json' | 'extension';
export type ModelProviderAuthMethod = 'api_key' | 'oauth';
export type ModelProviderAuthSource = 'stored' | 'runtime' | 'environment' | 'fallback' | 'models_json';
export type ProviderAuthSessionStatus =
  'running' | 'awaiting_input' | 'completed' | 'failed' | 'committed_but_unsynced' | 'cancelled' | 'expired';

export interface ModelProviderAuthDto {
  configured: boolean;
  methods: ModelProviderAuthMethod[];
  activeMethod?: ModelProviderAuthMethod;
  source?: ModelProviderAuthSource;
  sourceLabel?: string;
}

export interface ModelProviderCapabilitiesDto {
  refresh: boolean;
  endpoint: 'readonly' | 'owned';
}

export interface ModelProviderSummaryDto {
  local?: LocalProviderConfigurationDto;
  providerKey: string;
  providerId: string;
  name: string;
  provenance: ModelProviderProvenance;
  auth: ModelProviderAuthDto;
  capabilities: ModelProviderCapabilitiesDto;
  modelCount: number;
  availableModelCount: number;
  defaultModelKey?: string;
  defaultModelId?: string;
}

export interface ModelSettingsDto {
  modelKey: string;
  modelId: string;
  name: string;
  api: string;
  available: boolean;
  reasoning: boolean;
  input: Array<'text' | 'image'>;
  contextWindow: number;
  maxTokens: number;
  isDefault: boolean;
  configuration: 'inherited' | 'owned' | 'overridden';
}

export interface ModelProviderDetailDto extends ModelProviderSummaryDto {
  endpoint?: {
    effectiveBaseUrl: string;
  };
  models: ModelSettingsDto[];
}

export interface ModelProviderCatalogDto {
  providers: ModelProviderSummaryDto[];
}

export interface DefaultModelDto {
  providerKey?: string;
  providerId?: string;
  modelKey?: string;
  modelId?: string;
  configured: boolean;
  available: boolean;
  effect: 'new_sessions';
}

export interface DefaultModelCandidateDto {
  providerKey: string;
  providerId: string;
  providerName: string;
  modelKey: string;
  modelId: string;
  modelName: string;
  reasoning: boolean;
  input: Array<'text' | 'image'>;
}

export interface DefaultModelCandidatesDto {
  candidates: DefaultModelCandidateDto[];
}

export interface AuthSessionPromptOptionDto {
  id: string;
  label: string;
  description?: string;
}

export interface AuthSessionPromptDto {
  id: string;
  type: 'text' | 'secret' | 'select' | 'manual_code';
  message: string;
  placeholder?: string;
  options?: AuthSessionPromptOptionDto[];
}

export type AuthSessionEventDto =
  | { seq: number; type: 'info'; message: string; links?: Array<{ url: string; label?: string }> }
  | { seq: number; type: 'auth_url'; url: string; instructions?: string }
  | {
      seq: number;
      type: 'device_code';
      userCode: string;
      verificationUri: string;
      intervalSeconds?: number;
      expiresAt?: string;
    }
  | { seq: number; type: 'progress'; message: string };

export interface ProviderAuthSessionResultDto {
  credentialCommitted: boolean;
  providerSnapshotSynchronized: boolean;
  nextAction: 'none' | 'refresh_provider' | 'restart_service';
}

export interface ProviderAuthResetResultDto {
  credentialRemoved: true;
  providerSnapshotSynchronized: boolean;
  nextAction: 'none' | 'refresh_provider';
}

export interface ProviderAuthSessionErrorDto {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ProviderAuthSessionDto {
  id: string;
  providerKey: string;
  providerId: string;
  authType: ModelProviderAuthMethod;
  status: ProviderAuthSessionStatus;
  revision: number;
  createdAt: string;
  expiresAt: string;
  prompt?: AuthSessionPromptDto;
  events: AuthSessionEventDto[];
  result?: ProviderAuthSessionResultDto;
  error?: ProviderAuthSessionErrorDto;
}

export const SettingsOpaqueKeySchema = z.string().regex(/^p1_[A-Za-z0-9_-]{22}$/u);

export const UpdateDefaultModelBodySchema = z.object({
  providerKey: SettingsOpaqueKeySchema,
  modelKey: SettingsOpaqueKeySchema,
});

export const CreateProviderAuthSessionBodySchema = z.object({
  type: z.enum(['api_key', 'oauth']),
});

export const AnswerProviderAuthPromptBodySchema = z.object({
  promptId: z.uuid(),
  answer: z.string().max(65_536),
});

export type UpdateDefaultModelBody = z.infer<typeof UpdateDefaultModelBodySchema>;
export type CreateProviderAuthSessionBody = z.infer<typeof CreateProviderAuthSessionBodySchema>;
export type AnswerProviderAuthPromptBody = z.infer<typeof AnswerProviderAuthPromptBodySchema>;
