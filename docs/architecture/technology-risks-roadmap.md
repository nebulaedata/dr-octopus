# Dr.Octopus 技术选型、风险与路线图

## 1. 技术栈总览

| 层级         | 技术                | 版本/说明 | 用途                         |
| ------------ | ------------------- | --------- | ---------------------------- |
| 包管理       | pnpm                | 11.x      | Monorepo workspace、依赖去重 |
| 任务编排     | Turborepo           | 2.x       | 构建缓存、任务依赖、CI 加速  |
| 语言         | TypeScript          | 6.x       | 全栈类型安全                 |
| Agent 运行时 | Pi Coding Agent     | 0.84.x    | 智能体核心                   |
| Agent TUI    | Pi TUI              | 0.84.x    | CLI 终端界面                 |
| 后端框架     | Fastify             | 5.x       | HTTP API、WebSocket          |
| 前端框架     | React               | 19.x      | Web / Desktop UI             |
| 构建工具     | Vite                | 6.x       | Web Host 构建                |
| 桌面壳       | Electron            | 未来      | Desktop Host                 |
| UI 组件      | shadcn/ui + Radix   | latest    | 共享组件库                   |
| 样式         | Tailwind CSS        | 4.x       | 原子化样式                   |
| 测试         | Node.js Test Runner | 内置      | 单元与集成测试               |

## 2. 技术选型说明

### 2.1 Pi Coding Agent 作为核心

- **选型理由**：Pi 提供成熟的会话管理、工具调用、模型回退、compaction 与扩展机制，避免重复实现 Agent 引擎。
- **集成方式**：
  - CLI：直接调用 Pi `InteractiveMode` 与 `PrintMode`。
  - Server：通过 Pi `RpcMode` / `RpcClient` 驱动子进程。
- **风险**：Pi 升级可能引入 API 或协议变更；当前已通过 patch 文件（`patches/@earendil-works__pi-coding-agent@0.84.3.patch`）管理差异。

### 2.2 Fastify + WebSocket

- **选型理由**：轻量、高性能、TypeScript 友好，`@fastify/websocket` 提供统一插件化的 WS 支持。
- **适用场景**：本地 Server 与 Web/Desktop Host 通信。
- **替代方案**：Express + `ws` 库。拒绝原因：Express 中间件模型较重，Fastify 的声明式 schema 更适合 RPC 风格 API。

### 2.3 React 19 + React Compiler

- **选型理由**：React Compiler 自动处理记忆化，符合项目规范（禁止手动 `useMemo` / `useCallback`）。
- **约束**：需要确保构建配置启用 React Compiler，且团队遵循函数式组件写法。

### 2.4 shadcn/ui + Tailwind CSS

- **选型理由**：
  - 组件代码完全拥有，可随项目需求定制。
  - 无运行时 CSS-in-JS，打包体积小。
  - 与 Tailwind 4 配合，主题变量易于管理。
- **管理规范**：所有组件统一安装到 `packages/ui`，见 [ADR-0003](../adr/0003-shared-ui-component-layer.md)。

## 3. 风险与缓解策略

| 风险                                | 可能性 | 影响 | 缓解策略                                                                                                                                                 |
| ----------------------------------- | ------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pi SDK 升级导致 API 不兼容          | 中     | 高   | 1. 将 Pi 调用收敛到 `@octopus/agent` 的 Runtime 层；2. 升级前阅读 release note 并跑通 CLI + Server 测试；3. 使用 patch-package/pnpm patch 管理临时差异。 |
| Agent 子进程崩溃或 OOM              | 中     | 中   | 1. RPC Process Supervisor 按 runtimeId 监控退出；2. 设置单进程内存上限；3. 只恢复受影响 Session；4. 收集 stderr 用于诊断。                               |
| 多 Session 进程导致资源耗尽         | 中     | 高   | 1. Host 设置全局和每 Workspace 的活动 runtime 上限；2. 仅回收合格的 idle runtime；3. 达到上限时返回 capacity error，不终止 running Session。             |
| 同一 Session 被多个进程打开         | 低     | 高   | 1. 以 canonical sessionPath 建立独占 Lease；2. 并发 open 使用 single-flight；3. 进程确认退出后才释放 Lease。                                             |
| 同 Workspace 多 Agent 并发修改文件  | 中     | 高   | 1. UI 显示同 Workspace 的 running Session；2. mutation 能力采用 Host 单写或跨进程锁；3. 后续评估 Workspace 写协调策略。                                  |
| WebSocket 连接中断导致状态丢失      | 中     | 中   | 1. Host 断线重连后调用 `get_state` 拉取权威状态；2. 关键操作（如 prompt）使用 HTTP 请求 + 响应，不依赖 WS；3. 后续可评估事件持久化回放。                 |
| Monorepo 依赖边界混乱               | 中     | 中   | 1. 明确包依赖规则（见 [ADR-0002](../adr/0002-modular-monorepo-packages.md)）；2. 使用 ESLint 限制跨包非法引用；3. 定期审查 `package.json` 依赖。         |
| Desktop Host 内嵌 Server 增加复杂度 | 未来   | 中   | 1. 先验证独立 Server 模式；2. 内嵌模式作为优化项，通过 ADR 决策；3. 主进程设置看门狗隔离 Agent。                                                         |
| 共享 UI 组件导致多个 Host 同时回归  | 中     | 低   | 1. UI 组件补充视觉回归测试或快照；2. 变更时同步在 web 与 desktop 跑通；3. 业务组件保留在 `apps/*`，减少 ui 包变更频率。                                  |
| 本地模型密钥管理不善                | 低     | 高   | 1. 复用 Pi 的 `auth.json` / 环境变量机制；2. Server 不存储也不转发 API 密钥；3. 文档中明确本地安全责任。                                                 |

## 4. 失败模式与恢复

| 失败场景               | 现象                | 恢复策略                                                                                                                     |
| ---------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Agent RPC 子进程无响应 | `request` 超时      | 1. 标记对应 Session runtime 为 `failed/recovering`；2. 尝试优雅 kill 并按原 launch identity 重启；3. 其他 Session 不受影响。 |
| Agent 子进程崩溃       | `exit` 事件非零退出 | 1. 收集 stderr；2. 保持 Session Lease；3. 自动重启并验证 Workspace/Session/cwd；4. 通知该 Session 的订阅者。                 |
| Server 崩溃            | 所有 Host 断开      | 1. 运行中子进程可能成为孤儿；2. 重启后通过 PID/启动令牌恢复或清理 Lease；3. 未确认旧进程前不得重复打开同一 Session。         |
| Host 断线              | WebSocket 关闭      | 1. Session runtime 继续执行；2. Host 指数退避重连；3. 重连后按 Session 拉取状态并恢复订阅。                                  |
| 扩展 UI 请求无人响应   | 扩展阻塞等待用户    | 1. 设置 UI 请求超时；2. 超时后向 Agent 返回取消响应；3. Host 关闭时清理未完成的 UI 请求。                                    |

## 5. 开发路线图

### Phase 1：Agent SDK 与 Server 骨架（当前）

- [x] 初始化 Monorepo 与包结构
- [x] `@octopus/agent`：Runtime、扩展注册表、离线 infra 安装、CLI/TUI 启动
- [x] `@octopus/server`：`AgentProcessManager`、`AgentRpcProcess`、RPC Entry
- [ ] `@octopus/shared`：定义 workspace、API、WebSocket 类型契约
- [ ] `@octopus/server`：实现 workspace CRUD HTTP API
- [ ] `@octopus/server`：实现 SessionRuntimeCoordinator、Session Lease 与 runtimeId 级进程监督
- [ ] `@octopus/server`：实现 WebSocket 事件网关

### Phase 2：Web Host MVP

- [ ] `apps/web`：workspace 列表与创建界面
- [ ] `apps/web`：会话聊天界面（消息列表、prompt 输入）
- [ ] `apps/web`：流式事件渲染（text_delta、tool_call）
- [ ] `apps/web`：扩展 UI 请求渲染（确认框、表单）
- [ ] `apps/web`：Session 页面切换与后台运行状态展示，不以导航触发 Pi `switch_session`
- [ ] `@octopus/server`：实现 Session-scoped prompt/state/abort/UI response API
- [ ] `@octopus/ui`：补充所需 shadcn/ui 组件
- [ ] 端到端集成测试（Web → Server → Agent）

### Phase 3：稳定化与 Desktop Host 准备

- [ ] Web runtime 生命周期固定绑定、replacement 命令拒绝与 Session Lease 恢复
- [ ] 全局/每 Workspace 进程配额与 idle LRU
- [ ] Agent 崩溃自动恢复与诊断
- [ ] 事件持久化/回放（可选）
- [ ] 性能基准与优化
- [ ] Desktop Host ADR：内嵌 Server vs 独立 Server

### Phase 4：Desktop Host

- [ ] 创建 `apps/desktop`
- [ ] 复用 `apps/web` 代码与 `@octopus/ui`
- [ ] 实现 Desktop 专属适配（文件拖拽、系统托盘、本地路径）
- [ ] 打包与发布流程

## 6. 验收标准

| 阶段    | 关键验收标准                                                                                                            |
| ------- | ----------------------------------------------------------------------------------------------------------------------- |
| Phase 1 | `pnpm dev:agent` 可启动 TUI；`pnpm --filter @octopus/server dev` 可创建 workspace 并通过 RPC 与 Agent 通信。            |
| Phase 2 | Web Host 可在同一 Workspace 打开两个 Session runtime；切换页面不终止后台任务，并完成 prompt → 流式输出 → 工具调用闭环。 |
| Phase 3 | Server 可恢复单个崩溃 Session；Session Lease、容量限制和 idle 回收测试覆盖核心生命周期。                                |
| Phase 4 | Desktop Host 与 Web Host 在 UI 与行为上保持一致，可离线运行。                                                           |

## 7. 需要后续决策的问题

以下问题当前未决，待后续通过 ADR 或 RFC 明确：

1. **Desktop Host 运行模式**：内嵌 Server（Main 进程 import）还是独立 Server 进程？
2. **事件持久化**：是否需要持久化 Agent 事件以支持断线重连后的历史回放？
3. **多 Session 资源默认值**：全局与每 Workspace 允许多少个驻留 Session runtime？idle TTL 和内存预算如何配置？
4. **第三方扩展机制**：当前采用编译期封闭注册表，未来是否开放运行时扩展？如何保障安全？
5. **鉴权与多用户**：当前本地单机无需鉴权，未来若支持远程或团队协作，需单独设计。

## 8. 参考文档

- [Architecture Overview](./overview.md)
- [Component Model](./component-model.md)
- [Data Flow](./data-flow.md)
- [Dr.Octopus Server 架构设计](./octopus-server.md)
- [Dr.Octopus Apps/Web 架构设计](./octopus-web.md)
- [TUI Workspace MVP 架构设计 V4](./octopus-workspace.md)
- [ADR-0001: Pi RPC 模式](../adr/0001-pi-rpc-host-architecture.md)
- [ADR-0002: Monorepo 结构](../adr/0002-modular-monorepo-packages.md)
- [ADR-0003: 共享 UI 组件层](../adr/0003-shared-ui-component-layer.md)
- [ADR-0005: Host 按驻留 Session 编排 RPC 子进程](../adr/0005-host-owned-session-runtime-processes.md)
