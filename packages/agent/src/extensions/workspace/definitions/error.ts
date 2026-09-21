import type { WorkspaceErrorCode } from './types.js';

export class WorkspaceError extends Error {
  public readonly code: WorkspaceErrorCode;

  /**
   * @description 创建包含稳定错误码并保留底层原因的 Workspace 错误。
   *
   * @param code 调用方用于分支处理的稳定错误码。
   * @param message 面向诊断的错误说明。
   * @param cause 可选的底层异常。
   */
  public constructor(code: WorkspaceErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'WorkspaceError';
    this.code = code;
  }
}
