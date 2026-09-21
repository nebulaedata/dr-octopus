/**
 * @author Codex
 * @description 注册 Onboarding 配置与状态查询命令
 */
import { runSetup } from './ui.js';
import { notifyStatus } from './utils.js';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { OnboardingService } from '../services/onboarding-service.js';

/**
 * @description 注册模型配置与状态查询命令。
 * @param pi 当前 Pi Extension API。
 * @param service Onboarding 应用服务。
 */
export function registerOnboardingCommands(pi: ExtensionAPI, service: OnboardingService): void {
  pi.registerCommand('setup', {
    description: 'Configure or repair the Octopus default model',
    handler: async (_args, ctx) => {
      try {
        await runSetup(ctx, service, (model) => pi.setModel(model));
      } catch (error) {
        if (ctx.hasUI) {
          ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error');
          return;
        }
        throw error;
      }
    },
  });
  pi.registerCommand('octopus-model', {
    description: 'Show the current Octopus model status',
    handler: async (_args, ctx) => notifyStatus(ctx, await service.getStatus()),
  });
}
