# ADR-0001: 采用 Pi RPC 模式作为 Agent 与宿主间的桥梁

## Status

Accepted

> 进程基数部分已由 [ADR-0005](./0005-host-owned-session-runtime-processes.md) 替代；Pi RPC 机器边界的决策继续有效。

## Context

Dr.Octopus 需要同时支持三种宿主形态：

1. **CLI / TUI**：直接调用 Pi 的交互式终端界面。
2. **Web Host**：浏览器通过 Server 访问 Agent。
3. **Desktop Host**：Electron 等桌面应用访问 Agent。

Pi Coding Agent 本身提供三种运行模式：

- `InteractiveMode`：占用当前 TTY，适合 CLI。
- `PrintMode`：单次输出，适合脚本。
- `RpcMode`：通过 stdio JSON-RPC 与外部进程通信。

我们需要选择一种方式，让非 CLI 宿主也能驱动 Pi Agent，同时保持与 CLI 的行为一致。

## Decision

采用 **Pi RPC 模式** 作为 Agent 与 Server/宿主之间的唯一机器契约。每个 Host-owned runtime 对应一个独立的 Pi Agent 子进程，Server 通过 stdio JSON-RPC 与之通信，并将事件桥接到 HTTP/WebSocket。runtime 与 Workspace/Session 的映射由 Host 编排，详见 ADR-0005。

具体实现：

- `@octopus/agent` 提供 CLI 二进制（`dist/bin/octopus.js`），通过 `--mode rpc` 进入 RPC 模式；需要临时会话时可加 `--no-session`。CLI 与交互式 TUI 共用同一入口，保证行为一致。
- `@octopus/agent/rpc` 提供 `AgentRpcProcess` 与 `AgentProcessManager`，封装 spawn、协议握手、请求/响应关联、事件转发。
- `@octopus/server` 使用 RPC 进程监督能力维护 `runtimeId → RPC 子进程`，并由 Host Coordinator 维护 Workspace/Session/runtime 映射。
- Web/Desktop Host 通过 Server 的 WebSocket 接收 Agent 事件，通过 HTTP API 发送命令。

## Consequences

### Positive

- **行为一致性**：CLI、Web、Desktop 最终使用同一 Pi Runtime，避免三套 Agent 逻辑。
- **进程隔离**：单个 Session runtime 崩溃不会影响 Server 与其他 Session runtime。
- **官方协议兼容**：直接使用 Pi 提供的 JSON-RPC，升级 Pi 时协议层改动最小。
- **可测试性**：RPC 子进程可被 mock 替换，便于 Server 层单元测试。

### Negative

- **IPC 开销**：每次 prompt 与子进程通信存在序列化/反序列化开销，但在本地场景可忽略。
- **生命周期复杂度**：Server 需要管理子进程启动、健康检查、优雅停止、崩溃重启。
- **调试难度增加**：跨进程日志分散，需要统一收集 stderr 与请求 ID 追踪。

### Neutral

- 需要封装一层 `AgentRpcProcess` 来处理 Pi RPC 的细节（UUID、超时、事件路由）。
- RPC 子进程直接由 `@octopus/agent` CLI 启动，不再维护独立的 `rpc-entry.ts` 与 `createDrOctopusRuntime`。

## Alternatives Considered

### A1: 在 Server 进程内直接创建 Pi Session

- **做法**：Server 直接 `import { createAgentSession }` 并创建 session。
- **拒绝原因**：
  - Pi Agent 可能执行不受信代码或大量文件 IO，与 Server 同进程会降低稳定性。
  - 难以支持多 Workspace 并发与资源隔离。
  - 阻塞 Server 事件循环，影响 WebSocket 响应。

### A2: 为 Web/Desktop 重写一套 Agent 逻辑

- **做法**：不依赖 Pi，自行实现 LLM 调用、工具执行、状态机。
- **拒绝原因**：
  - 重复造轮子，无法利用 Pi 的扩展生态、compaction、模型回退等能力。
  - 与 CLI 行为分叉，长期维护成本极高。

### A3: 使用 Pi PrintMode 做一次性请求

- **做法**：每次请求 spawn 一个 Pi print 进程，获取结果后销毁。
- **拒绝原因**：
  - 不支持会话上下文、流式输出、steer/follow-up。
  - 每次冷启动成本高，体验差。

## Trade-offs

以**进程管理复杂度**换取**行为一致性、稳定性与可扩展性**。在本地优先、Session 需要后台并行且 Workspace 作为 cwd 边界的场景下，子进程隔离的收益大于 IPC 开销。

## References

- [Pi Agent SDK Skill](../../.agents/skills/pi-agent-sdk/SKILL.md)
- [packages/agent/src/rpc/rpc-process.ts](../../packages/agent/src/rpc/rpc-process.ts)
- [packages/agent/src/cli/path.ts](../../packages/agent/src/cli/path.ts)
- [ADR-0005: 由 Host 按驻留 Session 编排 RPC 子进程](./0005-host-owned-session-runtime-processes.md)
- [Pi Coding Agent Repository](https://github.com/earendil-works/pi)
