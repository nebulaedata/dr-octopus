/**
 * @author Codex
 * @description 定义 Onboarding 的稳定数据、操作与基础设施契约
 */
export type LocalRuntimeType = 'ollama' | 'vllm' | 'lmstudio';
export type OnboardingReason = 'FIRST_RUN' | 'NO_MODEL' | 'AUTH_MISSING' | 'MODEL_REMOVED';
export type OnboardingPhase =
  | 'unknown'
  | 'checking'
  | 'setup_required'
  | 'configuring_local'
  | 'authenticating_native'
  | 'selecting_model'
  | 'verifying'
  | 'ready'
  | 'error';
export type ModelAuthStatus = 'authenticated' | 'unauthenticated' | 'expired' | 'unknown';

export interface OnboardingStatus {
  ready: boolean;
  phase: OnboardingPhase;
  providerId?: string;
  modelId?: string;
  reason?: OnboardingReason;
}
export interface ModelInfo {
  providerId: string;
  modelId: string;
  name?: string;
  reasoning?: boolean;
  vision?: boolean;
}
export interface ModelProviderInfo {
  id: string;
  name: string;
  authenticated?: boolean;
  authTypes?: ('api_key' | 'oauth')[];
}
export interface LocalRuntimeInfo {
  id: LocalRuntimeType;
  name: string;
  defaultBaseUrl: string;
}
export interface LocalModelInfo {
  id: string;
  name?: string;
}
export interface LocalRuntimeDetectionResult {
  reachable: boolean;
  models: LocalModelInfo[];
}
export interface DetectLocalRuntimeInput {
  runtime: LocalRuntimeType;
  baseUrl: string;
  signal?: AbortSignal;
}
export interface CompleteLocalSetupInput extends DetectLocalRuntimeInput {
  modelId: string;
}
export interface StartNativeAuthInput {
  providerId: string;
  authType?: 'api_key' | 'oauth';
  signal?: AbortSignal;
}
export interface CompleteNativeSetupInput {
  providerId: string;
  modelId: string;
}
export interface NativeAuthResult {
  providerId: string;
  authenticated: boolean;
}
export interface AuthPrompt {
  type: 'text' | 'secret' | 'select' | 'manual_code';
  message: string;
  placeholder?: string;
  options?: readonly { id: string; label: string; description?: string }[];
  signal?: AbortSignal;
}
export interface AuthEvent {
  type: string;
  message?: string;
  url?: string;
  instructions?: string;
  userCode?: string;
  verificationUri?: string;
}
