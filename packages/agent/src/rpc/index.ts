/**
 * @author Claude Code
 * @description Dr.Octopus Agent RPC SDK 入口
 * - 导出 AgentRpcProcess / AgentRpcProcessOptions
 * - 导出 AgentProcessManager
 */

export { AgentProcessManager } from './rpc-manager.js';
export type {
  AgentProcessManagerOptions,
  AgentProcessRestartPolicy,
  ManagedAgentHealth,
  ManagedAgentSnapshot,
} from './rpc-manager.js';
export { AgentRpcError } from './rpc-error.js';
export type { AgentRpcErrorCode, AgentRpcErrorOptions } from './rpc-error.js';
export { AgentRpcProcess } from './rpc-process.js';
export type {
  AgentRpcProcessLifecycleEvent,
  AgentRpcProcessOptions,
  AgentRpcProcessState,
  RpcSuccessResponse,
} from './rpc-process.js';
