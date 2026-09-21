/**
 * @author Codex
 * @description 校验 Onboarding 输入、URL 与模型选择
 */
import { OnboardingError } from '../lib/errors.js';
import type {
  CompleteLocalSetupInput,
  CompleteNativeSetupInput,
  LocalRuntimeType,
} from '../definitions/types.js';

const RUNTIMES = new Set<LocalRuntimeType>(['ollama', 'vllm', 'lmstudio']);

/**
 * @description 校验并规范化只允许 HTTP(S) 的本地 Runtime URL。
 * @param value 用户输入的 URL。
 * @returns 去除末尾斜杠的 URL。
 */
export function validateBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('protocol');
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new OnboardingError('INVALID_BASE_URL', 'Base URL must be a valid http:// or https:// URL.');
  }
}

/**
 * @description 校验本地模型配置。
 * @param input 本地配置输入。
 */
export function validateLocalSetup(input: CompleteLocalSetupInput): void {
  if (!RUNTIMES.has(input.runtime)) {
    throw new OnboardingError('INVALID_RUNTIME', 'Unsupported local runtime.');
  }
  validateBaseUrl(input.baseUrl);
  if (!input.modelId.trim()) {
    throw new OnboardingError('MODEL_REQUIRED', 'Select a local model.');
  }
}

/**
 * @description 校验 Pi Native 模型配置。
 * @param input Native 配置输入。
 */
export function validateNativeSetup(input: CompleteNativeSetupInput): void {
  if (!input.providerId.trim() || !input.modelId.trim()) {
    throw new OnboardingError('MODEL_REQUIRED', 'Provider and model are required.');
  }
}
