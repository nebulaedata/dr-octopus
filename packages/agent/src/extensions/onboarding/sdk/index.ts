/**
 * @author Codex
 * @description 组装并暴露 Onboarding 稳定 SDK
 */
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { join } from 'node:path';
import { createLocalProviders } from '../lib/providers/local.js';
import { PiModelConfigRepository, PiSettingsRepository } from '../lib/persistence/repositories.js';
import { PiModelRuntime } from '../lib/runtime/pi-model-runtime.js';
import { OnboardingService } from '../services/onboarding-service.js';
import type {
  AgentModelRuntime,
  LocalRuntimeProvider,
  ModelConfigRepository,
  SettingsRepository,
} from '../definitions/port.js';

export interface OnboardingOptions {
  agentDir?: string;
  modelConfig?: ModelConfigRepository;
  settings?: SettingsRepository;
  runtime?: AgentModelRuntime;
  localProviders?: LocalRuntimeProvider[];
}

/**
 * @description 创建默认或注入式 Onboarding Service。
 * @param options 路径与测试依赖覆盖。
 * @returns 稳定 Onboarding Service 实例。
 */
export function createOnboardingService(options: OnboardingOptions = {}): OnboardingService {
  const agentDir = options.agentDir ?? getAgentDir();
  const modelsPath = join(agentDir, 'models.json');
  return new OnboardingService(
    options.modelConfig ?? new PiModelConfigRepository(modelsPath),
    options.settings ?? new PiSettingsRepository(agentDir),
    options.runtime ?? new PiModelRuntime(join(agentDir, 'auth.json'), modelsPath),
    options.localProviders ?? createLocalProviders()
  );
}
