# ADR-0004: Workspace 作为 Pi Extension Package 与进程内 SDK

## Status

Proposed

> RPC Host 的进程基数和多 Session 后台并行由 [ADR-0005](./0005-host-owned-session-runtime-processes.md) 定义；本文不再把 Workspace 切换等同于销毁唯一 runtime。

## Context

Dr.Octopus 需要让 CLI、Server/Web、Electron Desktop 和 SDK 嵌入模式共享 Workspace 能力，包括查看列表、查看当前 Workspace、创建、热切换、归档、删除和 Trust 授权。

Workspace 与 `pi-coding-agent` 的 cwd、Project Local Scope、Extension、工具及 Session 生命周期紧密相关。如果由 Host 或 Server 路由拥有领域逻辑，各 Host 会形成不同语义，也可能在 Trust 决定前加载不可信的 Project Extension。

Pi 原生 RPC 用于 prompt、steer、abort、Agent event 和 extension UI。模型工具和 Slash Command 适合 Agent/用户交互，不适合作为 Host 的确定性 Workspace API。但为 Workspace 再定义一套 Control RPC 会重复 Server HTTP/WebSocket 和 Electron IPC 已经承担的边界职责。

另外，Workspace 切换会改变 cwd、ResourceLoader、SettingsManager、SessionManager、Extension 实例和工具路径，不能通过修改当前 Session 的单个字段完成。

## Decision

1. Workspace 作为独立 `@octopus/pi-workspace` Pi package，通过公开 `ExtensionAPI` 注册工具、Slash Command 和生命周期事件。
2. 同进程剖面中，Extension、Workspace SDK 和 Host Adapter 共享同一个 Workspace Application Service。Server 管理 Pi RPC 子进程时，父进程 Service/Coordinator 是 mutation 权威，子进程 Extension 仅提供基于 cwd 的只读投影；Host 不直接访问 Registry、Lease 或 Pi Session。
3. Workspace 不定义 Control RPC。Server REST/WebSocket、Electron Main IPC 和 CLI Interaction 是 Host 自有适配层，直接调用同进程 `WorkspaceService`。Pi RPC 仅承载 Agent 会话，不注入 Workspace 自定义消息。
4. 单 runtime 的 CLI/TUI 或嵌入模式需要改变 Workspace 时，必须完整替换 cwd-bound Runtime。多 Session RPC Host 中，Workspace/Session 页面切换由 Host 改变订阅和命令目标；原 Session runtime 不被隐式 abort 或销毁。
5. Host 的 Session Runtime Coordinator 是 Session/Workspace 绑定和 Runtime Lease 的唯一生命周期所有者；Extension Factory 不创建第二份 Runtime，也不负责持久化当前 Host 状态。进程基数遵循 ADR-0005。
6. 破坏性操作和 Trust 必须通过 definitions 中的 `WorkspaceInteraction` 端口由真实 Host 授权；授权编排直接位于 `workspace-service.ts`，不增加独立 authorization service。模型工具参数和 Slash Command 文本不能替代授权。
7. Workspace 模块按仓库约定使用 `definitions/services/validators/lib/extension/sdk` 分层；`create` 只创建空 Workspace，不接受来源参数。Git clone、归档解压和其他内容初始化由智能体进入 Workspace 后自主执行。

## Consequences

### Positive

- Workspace 与 Pi Extension、工具、命令、事件和资源发现使用同一生命周期。
- CLI、Server、Desktop 和 SDK 共享稳定领域语义，不需要解析模型输出。
- 不引入额外 Workspace wire protocol、IPC channel 和协议版本管理。
- 保持 Pi 原生 RPC 兼容，可继续使用官方事件、extension UI 和升级路径。
- 切换 Workspace 时完整重建 cwd-bound services，避免旧资源、工具路径或扩展泄漏。
- Host 与传输层不拥有权威 Agent 状态。
- 目录分层与其他内置 Extension 一致，无需维护额外 domain/application/infrastructure 语言。

### Negative

- Workspace Application Service 必须与 Runtime Coordinator 在同一 Host 进程组装，不能隔着 Pi 子进程边界直接调用。
- 单 runtime 模式的 Workspace 切换需要 Runtime replacement、回滚和 readiness；多 Session Host 还需要 Lease、进程配额和空闲回收。
- Extension、SDK 和 Host Adapter 需要共享 Contract Suite，仍有边界映射测试成本。
- Workspace 不负责获取或初始化项目内容；相关智能体操作沿用其自身的工具授权、安全边界与执行反馈。

### Neutral

- 工具和 Slash Command 仍然存在，但定位为模型/用户入口，不是 Host API。
- Server 可以同时持有多个 runtimeId；“当前 Workspace”始终相对于 runtimeId，而不是全局 Registry。

## Alternatives Considered

### A1: 给 Pi 原生 RPC 增加自定义 Workspace 命令

拒绝。上游 v0.84.1 的 wire contract 是封闭协议，混入自定义消息会破坏兼容性并增加升级成本。

### A2: 通过模型调用 Workspace Tool 完成 Host 操作

拒绝。模型调用具有非确定性，无法作为 list/current 的稳定查询协议，也不能承担 Trust 或 purge 授权。

### A3: Workspace 由 Server 管理

拒绝。CLI 会产生第二套实现，且 Server 可能在 Workspace 授权前创建 cwd-bound Pi Runtime，破坏 Host-neutral Core 和 Trust 边界。

### A4: 原地修改 Pi Session 的 cwd

拒绝。cwd 影响资源发现、Settings、Session、工具和 Extension 实例；Pi 的 Session switch 也不是 Workspace switch。

### A5: 为 Workspace 建立独立 Control RPC

拒绝。它会与 Server HTTP/WebSocket 和 Electron IPC 重复，并要求额外通道、超时、消息关联和协议版本治理。当 Workspace Service 与 Runtime Coordinator 在 Host 组合根内共存时，进程内端口已能满足确定性调用。

## Trade-offs

以 Host 组合根必须持有 Workspace Service 和 Runtime Coordinator 的约束，换取无额外控制协议的单一用例语义，同时保留 Pi 协议兼容、正确的 Trust 边界和可恢复的热切换。

## References

- [TUI Workspace MVP 架构设计 V4](../architecture/octopus-workspace.md)
- [ADR-0001: 采用 Pi RPC 模式作为 Agent 与宿主间的桥梁](./0001-pi-rpc-host-architecture.md)
- [当前 Workspace Extension 与 SDK](../../packages/agent/src/extensions/workspace/index.ts)
