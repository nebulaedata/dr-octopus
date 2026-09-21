# Dr.Octopus 文档

本目录存放 Dr.Octopus 的架构设计、决策记录与开发指南。

## 架构文档

- [系统架构概览](./architecture/overview.md) — 高层架构、设计原则与包关系
- [组件模型](./architecture/component-model.md) — 各包/应用职责、边界与交互接口
- [数据流](./architecture/data-flow.md) — Prompt、事件、扩展 UI 请求在各层间的流动
- [技术选型、风险与路线图](./architecture/technology-risks-roadmap.md) — 技术栈、风险缓解与开发阶段
- [Server 架构设计](./architecture/octopus-server.md) — Fastify、持久化、Session Runtime 编排、Lease、事件身份与后台并行
- [Web 架构设计](./architecture/octopus-web.md) — Session 投影、订阅、恢复与多 Session 后台交互

## 专项设计

- [受管后台任务实施契约](./architecture/background-tasks-implementation.md) — 阶段 B 的具体模块、控制协议、平台实现、权限与验收记录

- [受管后台进程设计](./architecture/background-tasks.md) — 阶段 B 已实施；background_task 工具、进程所有权、停止屏障、防脱管边界与分阶段验收

- [配置变更提醒与手动重启会话](./architecture/session-config-restart.md) — 已实现；模型服务显式上报、内存版本与双入口手动重启，含验证记录
- [会话配置提醒与重启实施契约](./architecture/session-config-restart-contracts.md) — 提交事实、HTTP/DTO、停止预算、订阅恢复及代码审查缺口
- [CLI 跨平台环境检测设计](./architecture/cli-environment-check.md) — Proposed；安装前基础环境与建议工具检测，首期 Windows 本机真实验证
- [TUI Workspace MVP 架构设计 V4](./architecture/octopus-workspace.md) — 启动前 Workspace bootstrap、受管 Registry 与只读 Extension surface
- [Web Host 到 Pi RPC Process 架构设计](./architecture/host2rpc.md) — 从浏览器 HTTP/单 WebSocket、多 Session 编排到 Pi RPC 子进程的完整双向链路
- [企业级附件—智能体架构](./architecture/attachment-agent-system.md) — SQLite + 本地 Blob 独立部署、固定格式准入、流式上传、shadcn 附件卡片与 Pi 能力适配
- [Attachment Capability Lib 设计](./architecture/attachment-capability-lib.md) — 可复用格式分类器、安全策略矩阵、处理计划与 manifest/image/text 交付契约
- [附件系统实施契约 V1](./architecture/attachment-implementation-contracts.md) — 状态同步、REST/tus、SQLite、Worker、媒体 DTO、配额与恢复的可编码规范
- [Server 本地文件日志设计](./architecture/server-file-logging.md) — stdout 主输出、可选 JSONL 文件、滚动保留、脱敏与故障降级契约
- [Settings 模块架构设计](./architecture/settings-module.md) — 独立于 Workspace 的全局设置边界、阶段和模块导航
- [Settings Web 框架布局与交互设计](./architecture/settings-web-layout.md) — 三栏/两栏框架、响应式行为、Provider 详情状态与 shadcn/ui 组件映射
- [Settings HTTP API 统一契约](./architecture/settings-http-api-contract.md) — 首期 Settings API 的 DTO、幂等、并发、错误和部分成功约束
- [Settings MCP 服务器配置设计](./architecture/settings-mcp-servers.md) — 基于 `pi-mcp-adapter@2.31.0` 的 user-scope 投影、配置写入与 Settings 页面契约
- [定时任务架构设计](./architecture/scheduled-tasks.md) — Agent-owned 单例 daemon、内置 Extension、独立执行与来源会话回显
- [定时任务持久授权设计与实施](./architecture/scheduled-task-authorization.md) — 用户批准、任务范围、撤销、执行门禁、故障恢复与验收闭环
- [定时任务通知闭环](./architecture/scheduled-task-notifications.md) — 执行会话、来源链接、持久化通知与版本已读回执
- [子代理工具继承设计](./architecture/octopus-subagent-child-tools.md) — pi-subagents 0.65+ 原生会话架构下经 requiredExtensions 宿主通道向子代理注入 Octopus 内置扩展只读工具

## 架构决策记录

- [ADR 索引](./adr/README.md)
- [ADR-0044: CLI 持有 Gateway，Server 暴露通用生命周期](./adr/0044-cli-owned-gateway-server-lifecycle.md) — Accepted；管理协议与业务服务解耦，独立 Server 不参与 Gateway 单实例管理
- [ADR-0043: pnpm workspace 发布目录](./adr/0043-pnpm-workspace-release.md) — Accepted；原始元数据与完整 dist 复制，目标机器过滤安装生产依赖
- [ADR-0042: CLI 管理 Gateway 与统一发布产物](./adr/0042-cli-managed-gateway-distribution.md) — Accepted；CLI/Server/Web 管理、目标机器 npm 依赖安装（发布方式见 ADR-0043）、启动安装 Pi 扩展、单实例服务管理与文件日志开关
- [ADR-0001: 采用 Pi RPC 模式作为 Agent 与宿主间的桥梁](./adr/0001-pi-rpc-host-architecture.md)
- [ADR-0002: 采用 pnpm Monorepo 组织 Agent SDK 与多宿主](./adr/0002-modular-monorepo-packages.md)
- [ADR-0003: 通过 packages/ui 提供跨宿主共享 UI 组件](./adr/0003-shared-ui-component-layer.md)
- [ADR-0004: Workspace 作为 Pi Extension Package 与进程内 SDK](./adr/0004-workspace-pi-extension-control-plane.md)
- [ADR-0005: 由 Host 按驻留 Session 编排 RPC 子进程](./adr/0005-host-owned-session-runtime-processes.md)
- [ADR-0011: Session Runtime 操作租约与有序退役协议](./adr/0011-session-runtime-operation-leases.md)
- [ADR-0024: 采用可选的 Server 本地滚动文件日志](./adr/0024-optional-server-file-logging.md)
- [ADR-0038: Agent 持有独立单例 Scheduler 服务](./adr/0038-agent-owned-singleton-scheduler-daemon.md)
