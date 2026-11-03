# Proof of Concept（PoC）— 概念验证

本目录统一存放架构相关的可行性评估、方案审查、测试计划、验收矩阵、执行结果和证据索引。架构设计保留在 `docs/architecture`，决策保留在 `docs/adr`，测试代码留在所属应用或包的 `test/`。

## 维护规则

- 按功能维护文档，区分计划、受控测试、真实模型、浏览器/原生环境和人工验收。计划、设计审查与单测通过均不代表完整验收通过。
- 记录环境、版本、命令、范围、通过/失败/未执行项与限制；保留首次失败，不覆盖历史证据。
- 本次为 2026-11-03 文档归档迁移，原日期、结果与批准状态不变。迁入的旧方案仍可能已被替代，应以各文档状态和当前架构为准。
- 原始日志、截图和测试产物保留在原所属位置，本目录通过链接或路径引用。视觉稿及其审阅状态仍归 `docs/design` 和相应设计登记，不迁移。
- 新增架构验证内容写入本目录；架构正文只保留必要摘要与对应链接，避免维护两份详细记录。

## 归档迁移检查（2026-11-03）

- 迁入 7 份独立记录，归拢 51 份架构文档的验证章节；原设计保留入口，更新文档索引、ADR 和相关应用指引中的引用。
- 对 58 份来源文档逐项核对内容，除链接重定位和必要换行整理外，未丢失原有非空文本行；日期、失败与验收状态保持不变。
- 检查本次涉及的 1010 个本地链接及章节引用，没有新增断链；发现的 21 项既有问题保持单独区分，未将其宣称为全仓链接通过。
- 本次只整理 Markdown 文档，不修改产品行为、不执行新的付费模型请求，也不将文档迁移标记为架构验收通过。

## 独立评估与验证记录

- [Executor 验证状态与已知限制](executor-validation.md)
- [浏览器页面适配层限制审查](browser-page-adapter-review.md)
- [Scheduler 实施与验证记录](scheduler-verification.md)
- [定时任务通知闭环端到端验证](scheduler-e2e-2026-09-06.md)
- [浏览器整理 Agent 框架成本收益评估](browser-skill-agent-framework-evaluation.md)
- [录制 Skill Agent 闭环方案审查](browser-recording-skill-agent-review.md)
- [知识库实施与验收记录](knowledge-implementation.md)
- [Server 设置设计审查与范围收敛](settings-server-review.md)

## 专题测试计划与验收

- [自研录制器：单层同源 iframe 验收计划](browser-recorder-reliability-validation.md) · [架构](../architecture/browser-recorder-reliability.md)（Proposed，仅计划，未执行）

- [Session 首页预热：验证与实验记录](session-home-prewarming-validation.md) · [架构](../architecture/session-home-prewarming.md)
- [Dr.Octopus 企业级附件—智能体架构](attachment-agent-system-validation.md) · [架构](../architecture/attachment-agent-system.md)
- [Attachment Capability Lib 设计](attachment-capability-lib-validation.md) · [架构](../architecture/attachment-capability-lib.md)
- [受管后台任务实施契约（阶段 B）](background-tasks-implementation-validation.md) · [架构](../architecture/background-tasks-implementation.md)
- [受管后台进程设计](background-tasks-validation.md) · [架构](../architecture/background-tasks.md)
- [历史：Browser Extension Tab 录制与智能重放 — 项目融合设计](browser-extension-recorder-validation.md) · [架构](../architecture/browser-extension-recorder.md)
- [历史：录制 → 有限整理智能体 → 本地 Skill → 智能重放：闭环方案](browser-recording-skill-agent-validation.md) · [架构](../architecture/browser-recording-skill-agent.md)
- [浏览器优先的 Skill 离线闭环](browser-skill-offline-validation.md) · [架构](../architecture/browser-skill-offline.md)
- [浏览器 Skill：统一 ToolLoopAgent 设计开发方案](browser-skill-unified-agent-validation.md) · [架构](../architecture/browser-skill-unified-agent.md)
- [历史：浏览器工作流：引导式整理开发设计](browser-workflow-guided-organization-validation.md) · [架构](../architecture/browser-workflow-guided-organization.md)
- [CLI 跨平台环境检测设计](cli-environment-check-validation.md) · [架构](../architecture/cli-environment-check.md)
- [Docker 成品镜像发布与安装](docker-distribution-validation.md) · [架构](../architecture/docker-distribution.md)
- [统一文档解析与 ZIP 附件](document-processing-validation.md) · [架构](../architecture/document-processing.md)
- [通用精确计时组件设计与开发指南](dr-octopus-elapsed-time-component-design-validation.md) · [架构](../architecture/dr-octopus-elapsed-time-component-design.md)
- [Dr.Octopus Windows Computer Use MCP 架构与实施规范](dr-octopus-windows-computer-use-mcp-architecture-validation.md) · [架构](../architecture/dr-octopus-windows-computer-use-mcp-architecture.md)
- [Executor Browser 与扩展](executor-browser-validation.md) · [架构](../architecture/executor-browser.md)
- [Executor 构建、交付与离线验收](executor-delivery-validation.md) · [架构](../architecture/executor-delivery.md)
- [Web Host 到 Pi RPC Process 架构设计](host2rpc-validation.md) · [架构](../architecture/host2rpc.md)
- [Image generation](imagegen-validation.md) · [架构](../architecture/imagegen.md)
- [智能体知识库：开发框架与领域设计](knowledge-base-validation.md) · [架构](../architecture/knowledge-base.md)
- [知识库 MCP、HTTP 与管理页面契约](knowledge-mcp-and-web-validation.md) · [架构](../architecture/knowledge-mcp-and-web.md)
- [普通 Session 中的知识问答模式](knowledge-session-mode-validation.md) · [架构](../architecture/knowledge-session-mode.md)
- [智能体长期记忆模块设计](octopus-memory-validation.md) · [架构](../architecture/octopus-memory.md)
- [Dr.Octopus Onboarding 模块详细架构设计](octopus-onboarding-validation.md) · [架构](../architecture/octopus-onboarding.md)
- [Dr.Octopus Permission System 模块设计文档](octopus-permission-system-validation.md) · [架构](../architecture/octopus-permission-system.md)
- [Dr.Octopus Server 架构设计文档](octopus-server-validation.md) · [架构](../architecture/octopus-server.md)
- [Octopus 子代理工具继承设计](octopus-subagent-child-tools-validation.md) · [架构](../architecture/octopus-subagent-child-tools.md)
- [Dr.Octopus Apps/Web 架构设计文档](octopus-web-validation.md) · [架构](../architecture/octopus-web.md)
- [Octopus TUI Workspace MVP 架构设计](octopus-workspace-validation.md) · [架构](../architecture/octopus-workspace.md)
- [外部 Pi Package 安装与配置生命周期](pi-package-lifecycle-validation.md) · [架构](../architecture/pi-package-lifecycle.md)
- [定时任务持久授权与无人值守执行闭环](scheduled-task-authorization-validation.md) · [架构](../architecture/scheduled-task-authorization.md)
- [定时任务目录与执行历史](scheduled-task-history-validation.md) · [架构](../architecture/scheduled-task-history.md)
- [通用定时任务结果与通知闭环](scheduled-task-notifications-validation.md) · [架构](../architecture/scheduled-task-notifications.md)
- [Scheduler：Agent 侧独立单例服务](scheduled-tasks-validation.md) · [架构](../architecture/scheduled-tasks.md)
- [Server 本地文件日志设计](server-file-logging-validation.md) · [架构](../architecture/server-file-logging.md)
- [配置变更提醒与手动重启会话](session-config-restart-validation.md) · [架构](../architecture/session-config-restart.md)
- [Settings 添加本地提供商交互详细设计](settings-add-local-provider-flow-validation.md) · [架构](../architecture/settings-add-local-provider-flow.md)
- [Settings 默认模型详细设计](settings-default-model-validation.md) · [架构](../architecture/settings-default-model.md)
- [Settings Pi Extension 资源管理详细设计](settings-extensions-validation.md) · [架构](../architecture/settings-extensions.md)
- [Settings HTTP API 统一契约](settings-http-api-contract-validation.md) · [架构](../architecture/settings-http-api-contract.md)
- [Settings 本地模型服务 Preset 与探测详细设计](settings-local-model-providers-validation.md) · [架构](../architecture/settings-local-model-providers.md)
- [Settings MCP 服务器配置设计](settings-mcp-servers-validation.md) · [架构](../architecture/settings-mcp-servers.md)
- [Settings models.json Mutation 详细设计](settings-model-config-mutations-validation.md) · [架构](../architecture/settings-model-config-mutations.md)
- [Settings 模型服务详细设计](settings-model-providers-validation.md) · [架构](../architecture/settings-model-providers.md)
- [Dr.Octopus Settings 模块架构设计](settings-module-validation.md) · [架构](../architecture/settings-module.md)
- [Settings 模型服务认证会话详细设计](settings-provider-auth-sessions-validation.md) · [架构](../architecture/settings-provider-auth-sessions.md)
- [Server 设置模块设计](settings-server-validation.md) · [架构](../architecture/settings-server.md)
- [Settings Web 框架布局与交互设计](settings-web-layout-validation.md) · [架构](../architecture/settings-web-layout.md)
- [Dr.Octopus 技术选型、风险与路线图](technology-risks-roadmap-validation.md) · [架构](../architecture/technology-risks-roadmap.md)
- [Web 全局快捷键体系与设置页设计](web-keyboard-shortcuts-validation.md) · [架构](../architecture/web-keyboard-shortcuts.md)
- [Tool Renderer Development](web-tool-renderers-validation.md) · [架构](../architecture/web-tool-renderers.md)
- [Workspace 附件永久物化缓存设计](workspace-attachment-temp-cache-validation.md) · [架构](../architecture/workspace-attachment-temp-cache.md)
- [Browser Host 生命周期验证计划](browser-host-lifecycle-validation.md) · [决策](../adr/0090-browser-host-lifecycle.md)
