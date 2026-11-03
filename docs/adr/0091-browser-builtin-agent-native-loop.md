# ADR-0091：内置智能体使用 ToolLoopAgent 原生执行循环

## Status

Accepted · 2026-11-02。用户要求通用模块命名为 `builtin-agent`，由 ToolLoopAgent 承担工具选择、执行循环、结束控制与技能执行。替代 [ADR-0089](0089-browser-skill-unified-agent.md) 第 4 条中所有操作均作为外部结果、每个工具后重建 Host 的实现选择，保留其会话、权限和文件边界。

## Context

此前只有工具 schema，没有 execute；`isStepCount(1)` 配合 Worker 的 processTurn/launch 形成了应用自己维护的循环。此前 finish_run 循环还暴露了模型混淆 snapshotId 和工具调用 ID、失败后没有有限退出的问题。这些并不证明 SDK 无法承担 Agent。

## Decision

1. 通用模块为 `apps/browser-extension/src/lib/builtin-agent`；组织和重放仍是两个工具配置，共用原生 SDK 和持久会话。不存在旧路径转导出。
2. `ToolLoopAgent.generate` 直接运行多步。自定义 `tool.execute` 经认证 RPC 调用 Worker 的有限领域操作；Worker 不选择下一工具，不在工具完成后调用 launch。
3. `prepareStep` 在每个模型请求前预留持久预算，仅在本次 generate 的首步注入已保存会话；连续步骤的消息交还 SDK 管理。网络自动重试为 0，单步超时 60 秒。
4. `onLanguageModelCallEnd` 在 SDK execute 前保存完整工具批次并做准入；同轮提问优先且只接纳一个操作。它是权限边界，不是业务规划器。`onStepEnd` 落盘 SDK 的规范 response messages，保留供应商消息元数据与匹配结果。中途失败仍保留此前已提交的消息与工具账本。
5. `ask_user_question` 无 execute，使用 SDK 的外部工具停止能力；问题和答案持久化，用户提交后从完整历史创建新的 SDK 调用，不维持跨文档 Promise。
6. 停止条件检查已提交的完成、待答、失败或未知状态，并配置 SDK 技术上限 500 步。用户实际轮次上限仍在设置中，每次请求检查累计预算，不因新 generate 或重启重置。不能仅用 hasToolCall 判断完成。
7. finish_run 不要求模型填写内部证据 ID；运行时绑定最新有效观察或明确关闭回执，结果保留 unverified。同一工具相同错误连续三次停止为 SKILL_NO_PROGRESS，观察不会清除此工具的失败计数；该工具成功后清除。
8. Skill 使用官方指南的工具加载模式：`read_skill.execute` 返回用户选定的固定 SKILL.md / workflow.json 快照，模型根据内容规划 PageController 工具调用。无需把所有技能全文塞进系统提示词，也不增加提供商专属上传、Shell 或脚本执行。

## Alternatives and consequences

- 继续单步外部调度：便于所有状态留在 Worker，但重复框架循环且增加重建与结束处理，不采纳。
- 原生 SDK 循环：框架负责推理与执行迭代，应用仍必须实现工具能力、会话存储、MV3 身份、权限与未知副作用保护；它不是持久执行数据库。
- Skill 上传到提供商：适用于提供商支持的容器环境，不能假设 OpenAI 兼容接口具备该能力；也不能代替本机浏览器执行。不采用。
- 单纯移除所有门禁：会导致同轮待答与动作并行、重复提交和伪造完成。不采用。

## Verification

固定 ai@7.0.155 源码与确定性模型验证见 [SDK 能力测试](../../apps/browser-extension/test/tool-loop-agent-capabilities.test.mjs)、[生产服务集成](../../apps/browser-extension/test/integration/skill-service.test.mjs)、[原生侧边栏集成](../../apps/browser-extension/test/integration/window-panel.test.mjs)。当前范围与实际结果由[验证矩阵](../poc/executor-validation.md)维护。

官方依据：[ToolLoopAgent](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent)、[循环控制](https://ai-sdk.dev/docs/agents/loop-control)、[工具与 execute](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)、[Skill 工具加载](https://ai-sdk.dev/cookbook/guides/agent-skills)、[提供商 Skill 上传](https://ai-sdk.dev/docs/ai-sdk-core/skill-uploads)。
