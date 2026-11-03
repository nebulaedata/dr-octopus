# octopus-memory：概念验证与验收

架构设计：[原设计](../architecture/octopus-memory.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

## 16. 可观测性与性能验收

普通诊断只记录 action、store revision、候选数、token 估算、duration、错误码与脱敏 requestId，不记录完整 Wiki、原始对话、查询秘密或凭证。

建议事件：`memory.context.injected`、`memory.recall.search`、`memory.recall.page`、`memory.read`、`memory.curator.skipped`、`memory.mutation.committed`、`memory.write.conflict`、`memory.store.unavailable`。结构化日志与面向用户的提交/错误反馈分开，不能一概要求所有信息对用户隐藏。

初始性能验收使用固定本地环境、10 万条 Index 的 fixture，报告 p50/p95、数据库大小、FTS 状态、冷/热缓存和并发数。最近索引/单页查询 p95 目标 50 ms、单 Section 读取 20 ms、短事务 100 ms；这些是待实测目标，不是已有指标。模型延迟单列，另测 TUI 事件循环延迟和 context 实际 token。

不设固定的小记忆条数上限，但需要单条大小、数据库磁盘增长、导出与人工清理能力；“可长期积累”不等于无限磁盘或无界推理成本。

## 17. 测试与实施顺序

测试使用仓库约定的 `node:test`、`packages/agent/test/*.test.mjs`，每个独立 fixture 显式注入专用临时 dataRoot，数据库位于 `<tempDataRoot>/memory/memory.db`；agentDir 与 Workspace 另用临时目录。验证改变 agentDir 不改变记忆位置、CONFIG_DIR_NAME 默认规则以及各入口解析一致；不能仅覆盖 agentDir 后让测试落到用户真实 memoryDir。不写入用户正常 Pi 配置。核心 Service 的模型由确定性 fake port 替换。

| 范围      | 必须覆盖                                                                                                                                                               |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 装配      | 实际构建产物能加载；CLI/TUI 与 RPC 工具/命令一致；Skill 与 migration 随构建存在                                                                                        |
| 无 Server | TUI 中 remember → recall/read → forget → 再次查询，独立运行完成                                                                                                        |
| Context   | 150 条时不超过最近 100；全部来自统一全局排序；中文 token 截断；遗漏候选可续页；多轮/压缩不重复注入                                                                     |
| 全局共享  | 不同 Workspace 的 TUI/Web 读到同一事实；不同 dataRoot 隔离；更换 agentDir 不改变 memoryDir；路径别名归一；错误 storeId/cursor/路径被拒绝；项目规则不会覆盖另一项目规则 |
| Recall    | 第 101 条以后可查；中文/别名 FTS miss 可分页；截断或不可用不误报 exhausted；预算到达即停                                                                               |
| 并发分页  | 更新 activation_seq 后旧 cursor 明确 stale；有界重启；read revision 与 page 无竞态                                                                                     |
| Mutation  | canonical 唯一约束、20 个并发写、全事务回滚、FTS 一致、requestId 重试、同 ID 异请求拒绝、冲突重新判断                                                                  |
| Curator   | 不持久化助手猜测/tool 注入/未确认方案；旧事实查重；无模型/超时/取消不会卡住主回答                                                                                      |
| 生命周期  | retry/compaction/续跑不会逐 turn 重复保存；resume/fork/tree 不重写旧来源；关闭/换 Session 后无晚到写和资源泄露                                                         |
| 模式      | 知识问答工具白名单下不强行激活 memory；子代理/授权进程不自动写；readOnly 和 off 在提交时生效                                                                           |
| 忘记      | 删除事实及 superseded 历史、FTS、Section；旧 epoch 任务失败；旧来源不自动恢复；自身旧 tool 正文被过滤且配对有效                                                        |
| TUI/RPC   | hasUI=true 的 RPC 不用 TUI custom；紧凑/展开/取消/错误文本可见；JSONL 无额外 stdout                                                                                    |
| Web       | tool details 未知版本 fallback；snapshot generation/sequence 防倒退；重连重建；跨进程修改按刷新契约出现                                                                |
| Web 导航  | Header“记忆”跳转 /memory 并高亮；页面显示正确标题；无 Workspace/Session 也可打开；直接访问、刷新、前进/后退及窄屏入口可用；不启动 Agent runtime                        |
| 管理接口  | 用户环境隔离、全局读写授权、无 Workspace 参数、requestId 与 revision、写后刷新、断线后重试不重复提交                                                                   |
| 降级      | DB busy/损坏/迁移失败/磁盘满/FTS 缺失，记忆不可用而主 Agent 继续运行；无法完成的写入不得回成功                                                                         |

实施按垂直链路推进，自动整理最后开启：

1. **事实模型与 SDK**：全局路径、Drizzle Schema 与独立 memory 迁移、事务、幂等、显式 remember/read/forget；首先验证删除与并发。
2. **内置扩展与 TUI**：统一装配，`/memory`、工具、context、Skill、生命周期，完成无 Server 冒烟。
3. **RPC 与 Web**：先做 tool 及状态投影，再接管理 SDK/API；启用 Header“记忆”菜单并实现 `/memory` 页面、刷新与错误反馈，验证两端语义一致。
4. **有界深层召回**：FTS、中文 fixture、分页失效、token 与调用预算；证明能找旧记录而不会无限搜索。
5. **Curator**：资格/来源过滤、有限模型调用、候选查重、版本检查、幂等与取消，先以 manual 验证写入闭环，全部保护通过后启用全局记忆的默认 auto。
6. **整体验收**：并发、切换/恢复、模式共存、删除屏障、跨进程刷新和性能指标。

实现阶段运行 memory 的 Drizzle generate/check、实际迁移升级测试及受影响包的 test、lint、typecheck，并按 InlineExtension 指南完成构建及真实 Pi 隔离加载。本轮已经完成 SDK、TUI/RPC 适配、HTTP 与 Web 管理、预算与删除屏障的实现。测试使用隔离 dataRoot 与确定性模型替身；真实模型效果和跨平台指标需单独验收。

### 17.1 当前实现入口与边界

- SDK：`createMemoryService({ dataRoot?, readOnly? })`，公开于 `@octopus/agent`；读取不会创建目录，普通 Agent 的 session_start 惰性初始化。
- 内置扩展：`octopus-memory`；模型只有 `memory_recall` 与 `memory_read`，显式写入通过 `/memory` 或管理 API。
- 管理 API：GET `/api/memory/status`、`/indexes`、`/export`；POST `/read`、`/remember`、`/forget`、`/policy`、`/rebuild`。导出为 Markdown 副本；重建只修复派生 FTS 行。
- Web：Header“记忆”与窄屏入口均指向 `/memory`，支持创建、编辑、忘记、全文候选检索、游标分页和导出；全局模式在 Settings → 基础 → 记忆（`/settings/memory`）配置，独立页与设置弹窗共用。页面可见时每 5 秒刷新目录/状态，冲突后提供返回首页操作。
- 会话投影：版本化 `octopus-memory-state` 经过 Server 校验进入 snapshot 和事件信封，Web 展示会话最近观察状态，Runtime 更换时清除。工具卡片保留原始正文及错误回退。
- Curator：完整 run 稳定后，最多两次无工具模型调用（格式纠正与冲突重判共用次数预算），共用 10 秒期限；仅接受新用户来源。自动模式受 Project Trust、工具启用状态及 readOnly 限制，事务提交检查 writeEpoch。
- 有界读取：目录最多 100 条并同时限制字节数；模型正文每次最多 14 KB（含元数据预留），来源显示有界摘录。管理端使用更大响应预算读取完整正文与来源后才允许编辑。
