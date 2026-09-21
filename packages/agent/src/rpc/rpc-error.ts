/**
 * @author Codex
 * @description Agent RPC 稳定错误契约，供不同 Host 统一判断恢复策略
 */

export type AgentRpcErrorCode =
  | 'PROCESS_NOT_READY'
  | 'PROCESS_EXITED'
  | 'PROCESS_START_FAILED'
  | 'RPC_TIMEOUT'
  | 'RPC_WRITE_FAILED'
  | 'RPC_PROTOCOL_ERROR'
  | 'RPC_RESPONSE_ERROR'
  | 'RPC_CAPACITY_EXCEEDED'
  | 'RESTART_CIRCUIT_OPEN'
  | 'MANAGER_SHUTTING_DOWN';

export interface AgentRpcErrorOptions {
  cause?: unknown;
  command?: string;
  retryable?: boolean;
}

/**
 * 表示 Host 可稳定识别并映射到 Control RPC 的 Agent RPC 故障。
 */
export class AgentRpcError extends Error {
  public readonly code: AgentRpcErrorCode;
  public readonly command: string | undefined;
  public readonly retryable: boolean;

  /**
   * 创建携带错误码及重试语义的 RPC 错误。
   *
   * @param code 跨 Host 稳定的错误码
   * @param message 面向诊断的错误说明
   * @param options 原因、命令和重试语义
   */
  public constructor(code: AgentRpcErrorCode, message: string, options: AgentRpcErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'AgentRpcError';
    this.code = code;
    this.command = options.command;
    this.retryable = options.retryable ?? false;
  }
}
