/**
 * @author Codex
 * @description 注册 Onboarding Session 生命周期事件
 */
import { notifyStatus } from './utils.js';
import { runSetup } from './ui.js';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { OnboardingService } from '../services/onboarding-service.js';

/**
 * @description 注册 Session 启动时的 Onboarding 状态提示。
 * @param pi 当前 Pi Extension API。
 * @param service Onboarding 应用服务。
 */
export function registerOnboardingEvents(pi: ExtensionAPI, service: OnboardingService): void {
  pi.on('session_start', async (event, ctx) => {
    if (event.reason === 'startup') {
      try {
        const status = await service.getStatus();
        if (!status.ready && status.phase === 'setup_required' && ctx.mode === 'tui' && ctx.hasUI) {
          await runSetup(ctx, service, (model) => pi.setModel(model));
          return;
        }
        notifyStatus(ctx, status);
      } catch (error) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            `Unable to check model setup: ${error instanceof Error ? error.message : String(error)}`,
            'warning'
          );
        }
      }
    }
  });
}
