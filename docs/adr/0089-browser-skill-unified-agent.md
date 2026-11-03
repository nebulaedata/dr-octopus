# ADR-0089：整理与重放统一采用 ToolLoopAgent

## Status

Accepted · 2026-10-31。用户确认两阶段 ToolLoopAgent + 通用 PageController tools，并指定 Questionnaire + MessageScroller 受限会话。当前先验证方案并更新开发文档，视觉稿按用户最新选择延后；不表示生产功能已完成。

Supersedes [ADR-0088](0088-browser-recording-skill-agent.md) 中双引擎、重放无提问和单次 Core execute 的决定。保留本地 Skill、有限工具、扩展模型配置与文件服务边界。

2026-11-02：第 4 条的单步外部调度实现已由 [ADR-0091](0091-browser-builtin-agent-native-loop.md) 替代；SDK 原生多步执行，Worker 保留准入与持久状态。

## Context

整理需要澄清业务意图，运行也可能缺少本次编号、邮箱等输入。两种引擎分别处理会话与问答增加适配成本，且运行前一次性补齐输入不能覆盖执行中才发现的问题。扩展已经使用 AI SDK 和 PageController，未安装 Page Agent Core。

## Decision

1. 扩展 src/lib 共用 ToolLoopAgent 配置、会话和工具调度；整理/重放分别配置工具并建立任务会话。整理不获得页面操作权限。
2. 重放复用 BrowserRouter、Content 和 PageController；Worker 检查本地 run 与 Native 连接的真实所有权，不新增 DOM 引擎。
3. ask_user_question 是外部结果工具。Questionnaire 呈现当前工具问题，MessageScroller 呈现时间线；没有自由聊天，表单归 TanStack Form。
4. 页面副作用和文件提交采用外部工具。整轮准入后才派发，ask 存在时不执行同轮动作；排除累计调用中已有结果的项。
5. 会话基于完整 SDK 消息和匹配 tool result 继续，不依赖长期未决 Promise。回答后重观测，未知在途动作不自动重放。
6. 产物为 SKILL.md + 轻量 workflow.json；用户维护本地文件，不维护 DAG。文件服务和跨应用契约仍待实施。

## Consequences

- 统一模型适配、工具协议、问答和会话机制，复用已有页面执行能力。
- 应用承担浏览器观察策略、工具描述、页面变化和结果核对，PageController 不是完整浏览器 Agent。
- 不声称包体、性能或调用费用已经降低；重放质量必须实测。
- 公共层只提取真实共用职责，不修改 packages/agent，不新增 LangChain。

## Validation

真实 SDK 配合确定性假模型已复现“串行工具仍会在待答问题旁执行动作”；外部工具返回和序列化继续契约可用。生产调度、MV3 所有权、真实页面重放和用户体验未因此完成。见[设计开发方案](../architecture/browser-skill-unified-agent.md)与[验证矩阵](../poc/executor-validation.md#统一-skill-agent-可行性验证)。
