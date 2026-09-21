/**
 * @author Codex
 * @description 提供 Onboarding Extension 的共享状态展示函数
 */
import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import type { OnboardingStatus } from '../definitions/types.js';

/**
 * @description 在交互模式中展示当前 Onboarding 状态。
 * @param ctx 支持 UI 能力检测的 Extension 上下文。
 * @param status 当前 Onboarding 状态。
 */
export function notifyStatus(
  ctx: Pick<ExtensionCommandContext, 'hasUI' | 'ui'>,
  status: OnboardingStatus
): void {
  if (ctx.hasUI) {
    ctx.ui.notify(
      status.ready
        ? `Model ready: ${status.providerId}/${status.modelId}`
        : `Model setup required (${status.reason ?? status.phase}). Run /setup.`,
      status.ready ? 'info' : 'warning'
    );
  }
}
