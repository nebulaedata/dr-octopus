# browser-skill-unified-agent：概念验证与验收

架构设计：[原设计](../architecture/browser-skill-unified-agent.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

## 10. 开发顺序与验收

1. SDK 可行性、已装组件/公开 API 核对、文档；本轮无真实提供商请求。
2. Worker 会话/账本/CAS/预算：同轮 ask/动作拦截、多 Popup、旧世代、Host 丢失、答案 ACK。
3. 整理与 fields 契约：四工具、完整 Skill 校验，替换旧固定问卷主路径。
4. Native 文件服务：保存回执、目录打开、手改重读和运行快照。
5. 重放：真实 local-run 所有者、现有路由、observe→act→observe、跨 Tab、等待后重观测、未知结果门禁。
6. 新视觉审阅后接 UI；验证 Questionnaire/TanStack Form、MessageScroller 锚定、短窗和可访问性。
7. 隔离 Chrome/Edge 完整扩展端到端；申请明确真实模型额度，验证合成技能与业务重放；最后人工验收。

真实 SDK + 假模型只证明框架契约，不证明真实模型决策；普通浏览器测试页不等于 MV3 Host/Worker 生命周期；静态组件核对不等于键盘/滚动体验验证。完整可用性不得提前宣称。

### SDK 能力核验与技能执行

核验固定安装版本 ai@7.0.155，而非只依据网页示例。ToolLoopAgent 原生支持 tool.execute、多步工具结果回传、generate/stream、prepareStep、生命周期回调、AbortSignal、工具审批和外部工具续接。默认 isStepCount(20) 只是框架默认值，本项目显式使用 Worker 状态作为 stopWhen 条件：onStepEnd 提交完整消息与工具结果后，Worker 返回任务状态与累计预算是否要求停止，Host 更新停止标记，不再设置独立的 SDK 轮数上限。最后一轮允许的工具仍完整执行并落盘；请求前的持久预算检查继续阻止超额调用，跨 Host 不重置。

| 能力 | 框架承担的部分 | 本项目必须实现的部分 | 本次证据 |
| --- | --- | --- | --- |
| 自主规划与工具调用 | 模型选择工具及参数，SDK 校验并执行 execute，把结果交回模型 | 提供工具描述、schema 和有限领域操作 | 确定性多步 + 生产服务集成 |
| 工具加载 Skill | 读取工具的输出进入上下文，模型按内容规划 | 本次 Skill 来源、固定快照与站点范围 | read_skill 后下一模型轮收到 skillMarkdown |
| 正常结束 | 无工具的自然结束；stopWhen 与 isStepCount | 保存/完成回执的业务语义 | 自然结束、成功回执停止、失败回执可修正 |
| 用户提问 | 无 execute 的工具停止当前 generate，支持消息历史续接 | 问题表单、答案校验、幂等提交与落盘 | 序列化续接 + 双浏览器原生侧栏 |
| 审批与串行 | toolApproval / needsApproval、toolCallConcurrency | 整轮提问优先、权限和最多一个操作 | SDK 审批小样；串行并非提问屏障的负例 |
| 错误与取消 | 工具错误回传、AbortSignal、步骤超时 | 未知副作用、累计预算、重复错误退出 | SDK 取消测试 + 服务重复 finish/预算用例 |
| 会话恢复 | 接收 messages、输出规范 response messages 与生命周期回调 | IndexedDB、执行世代、断线/重启、已派发状态 | 生产服务与面板关闭后续接 |
| 流式输出 | stream、事件与流式消费 API | 本项目 UI 映射 | 官方接口与已装源码核对；生产仍用 generate，未宣称流式 UI 验收 |

核心依据：[ToolLoopAgent](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent)、[Loop Control](https://ai-sdk.dev/docs/agents/loop-control)、[Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)、[Tool Approvals](https://ai-sdk.dev/docs/agents/tool-approvals)。11 项可执行 SDK 能力用例不包含任何真实模型网络请求；它们证明运行机制，不证明模型能正确规划真实业务。

停止须区分三层：SDK 自然终止（纯文本、外部工具等）、运行限制（预算、取消、重复错误）、业务完成回执。hasToolCall 只检测调用，不能证明工具执行成功；工具抛错通常作为结果交回模型，不自动判定业务失败或防止循环。finish_run 由运行时绑定最新观察，不接受模型猜测内部证据 ID；相同工具同一错误连续三次停止，正确执行该工具才清除计数。全部校验保留在有限工具执行边界，不预写业务工具顺序。

Skill 采用官方 [Add Skills to Your Agent](https://ai-sdk.dev/cookbook/guides/agent-skills) 的工具加载方式：本产品在录制详情已选定唯一技能，所以无需全库发现，read_skill 返回本次固定快照，模型按技能内容自主选择有限页面工具。SKILL.md 提供任务知识；workflow.json 仅提供输入、站点、限制与依据，不重建 DAG。技能文本不授予额外站点或任意代码权限。另一种 [Skill Uploads](https://ai-sdk.dev/docs/ai-sdk-core/skill-uploads) 依赖提供商专属接口/容器，当前 OpenAI 兼容提供商未验证支持，不作为本地浏览器执行方案。

SDK 不自带本产品 IndexedDB 事务、Chrome/Edge 文档身份或跨文档 exactly-once；这些留在 Worker 和现有 Router。首步上下文、每次模型预算、整轮意图、派发状态和真实结果分别落盘；onStepEnd 再保存 SDK 规范步骤消息。关闭页面、崩溃或迟到结果必须按账本判断，不能把 SDK 停止等同于取消了已发送动作。
