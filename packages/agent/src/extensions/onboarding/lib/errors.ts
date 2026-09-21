/**
 * @author Codex
 * @description 提供带稳定错误码的 Onboarding 领域错误
 */
export class OnboardingError extends Error {
  /**
   * @description 创建可由 SDK 和扩展适配器识别的错误。
   * @param code 稳定错误码。
   * @param message 可执行的错误说明。
   * @param options 原始错误信息。
   */
  public constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'OnboardingError';
  }
}
