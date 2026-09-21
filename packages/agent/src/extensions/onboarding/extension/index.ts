/**
 * @author Codex
 * @description 组合并默认导出 Onboarding Pi InlineExtension
 */
import { registerOnboardingCommands } from './commands.js';
import { registerOnboardingEvents } from './events.js';
import { registerOnboardingTools } from './tools.js';
import { createOnboardingService } from '../sdk/index.js';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { OnboardingService } from '../services/onboarding-service.js';

const onboardingService = createOnboardingService();

/**
 * @description 创建 Onboarding InlineExtension。
 * @param onboardingService Onboarding Service 实例，默认创建一个。
 * @returns Pi Extension 工厂。
 */
export function createOnboardingExtension(service: OnboardingService = onboardingService) {
  return function onboardingExtension(pi: ExtensionAPI): void {
    registerOnboardingEvents(pi, service);
    registerOnboardingCommands(pi, service);
    registerOnboardingTools(pi, service);
  };
}

export default createOnboardingExtension();
