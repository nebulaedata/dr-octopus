/**
 * @author Codex
 * @description 定义 Onboarding 的交互、持久化与模型运行时端口
 */
import type {
  AuthEvent,
  AuthPrompt,
  LocalRuntimeDetectionResult,
  LocalRuntimeInfo,
  ModelAuthStatus,
  ModelInfo,
  ModelProviderInfo,
} from './types.js';

export interface AuthInteraction {
  prompt(request: AuthPrompt): Promise<string>;
  notify(event: AuthEvent): void;
}

export interface ModelConfigRepository {
  upsertLocalProvider(providerId: string, baseUrl: string, modelId: string): Promise<void>;
}

export interface SettingsRepository {
  exists(): Promise<boolean>;
  getDefaultModel(): Promise<{ providerId?: string; modelId?: string }>;
  setDefaultModel(providerId: string, modelId: string): Promise<void>;
}

export interface AgentModelRuntime {
  getProviders(): Promise<ModelProviderInfo[]>;
  getAvailableModels(): Promise<ModelInfo[]>;
  getAuthStatus(providerId: string): Promise<ModelAuthStatus>;
  login(
    providerId: string,
    authType: 'api_key' | 'oauth',
    interaction: AuthInteraction,
    signal?: AbortSignal
  ): Promise<void>;
  refresh(signal?: AbortSignal): Promise<void>;
  findModel(providerId: string, modelId: string): Promise<ModelInfo | undefined>;
}

export interface LocalRuntimeProvider {
  readonly info: LocalRuntimeInfo;
  detect(baseUrl: string, signal?: AbortSignal): Promise<LocalRuntimeDetectionResult>;
}
