# Agent 配置更新通知检查

日期：2026-11-04。范围：当前 Web/Server 配置写入入口及其 Agent 消费方式；不修改 Pi RPC 架构或 Agent 核心。

用户选择：只提示，由用户点击重启；不自动中断任务、不自动重启。设计见[通知范围扩展](../architecture/session-config-restart.md#10-通知范围扩展2026-11-04)。

## 检查矩阵

| 配置项                              | 检查时的生效方式与通知情况                                                       | 本次处理                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 模型服务、模型目录及认证            | 已有 ModelConfigMonitor 和 RuntimeConfigChanges；实际模型或凭据变化提醒旧实例    | 保留原链路                                                |
| 全局默认模型                        | 刷新未提交会话的模型意图，不覆盖已有会话选定模型                                 | 不增加旧会话重启提示                                      |
| MCP 新增、编辑、启停、删除          | 写入 mcp.json，旧进程保留加载状态；原来没有会话变更通知                          | 接入已提交变更通知；重复启停不写入、不提醒                |
| Agent 环境变量                      | 独立进程启动时注入，旧 process.env 不更新；原来没有会话变更通知                  | 实际文件 revision 变化后提醒                              |
| Jev 凭据                            | 写入同一 Agent environment.json；已启动 Agent 可能继续使用启动时的密钥           | 提交后按 Agent 环境变化提醒；响应投影失败也检查已提交版本 |
| 全局技能                            | Pi 持有已发现技能与描述；原来增删改和上传没有通知                                | 提交后提醒所有已有受管会话                                |
| 工作区技能                          | 同上，但只影响该 Workspace                                                       | 按 workspaceId 记录版本，只提醒匹配工作区的会话           |
| 权限策略                            | tool_call/user_bash 前重载；等待审批后再次检查策略变化                           | 保留按操作重读，不要求重启                                |
| 会话权限模式、模型、thinking 等偏好 | 已有会话命令直接操作当前 runtime                                                 | 不增加配置过期提示                                        |
| 生图服务                            | before_agent_start 读取最新上下文，image_generate 每次读取配置和凭据             | 保留按调用生效                                            |
| Jev 模型与记忆筛选策略              | 每次筛选读取模型与筛选配置                                                       | 保留按调用生效                                            |
| 语音服务                            | Server 每次转录读取保存的服务配置                                                | 不需要 Agent 重启                                         |
| Server 配置与 Server 环境变量       | 已有 current/next、pendingRestartFields、additionalPendingRestart 和服务重启响应 | 保留服务级提示，不能用重启会话替代                        |
| 知识库模型与凭据                    | 配置保存在知识库服务数据库；模型执行和检索读取当前设置，凭据按引用读取           | 不要求 Agent 重启；已有索引的模型代际按索引契约保留       |
| 记忆策略与内容                      | 通过记忆服务提交；策略变更增加 fence 并使待处理推理失效                          | 不要求 Agent 重启                                         |
| 计划任务与调度设置                  | 任务归 Scheduler；配置保存后 daemon 重新设置 worker 并发上限                     | 不要求 Agent 重启；不把旧任务执行快照重写成新配置         |
| 扩展管理                            | Web 是占位页，没有可用的安装/启停写入入口                                        | 尚未接入；不宣称扩展变化已有通知                          |
| 外观、语言、快捷键、片段            | 浏览器侧偏好                                                                     | 不需要 Agent 重启                                         |

源码依据：

- [配置版本](../../apps/server/src/infrastructure/runtime-config/configuration-changes.ts)、[集中名单](../../apps/server/src/infrastructure/runtime-config/configuration-catalog.ts)、[模型监视器](../../apps/server/src/modules/model-settings/model-settings.service.ts)。
- [MCP 提交](../../apps/server/src/infrastructure/pi-mcp/pi-mcp-store.ts)、[Agent 环境](../../apps/server/src/modules/environment-settings/environment-settings.service.ts)、[Jev 凭据](../../apps/server/src/modules/jev-settings/jev-settings.service.ts)、[技能写入](../../apps/server/src/modules/skills/skills.service.ts)。
- [权限边界](../../packages/agent/src/extensions/permission-system/extension/events.ts)、[生图上下文](../../packages/agent/src/extensions/imagegen/extension/index.ts)、[生图执行](../../packages/agent/src/extensions/imagegen/services/imagegen-service.ts)。
- [知识库设置](../../packages/agent/src/extensions/knowledge/lib/model-settings.ts)、[知识库检索](../../packages/agent/src/extensions/knowledge/lib/search-engine.ts)、[记忆策略](../../packages/agent/src/extensions/memory/services/memory-service.ts)、[调度配置应用](../../packages/agent/src/extensions/scheduler/daemon/lifecycle-server.ts)。
- [Jev 配置](../../packages/agent/src/lib/jev/settings.ts)、[记忆筛选](../../packages/agent/src/extensions/memory/lib/jev-screen.ts)、[语音调用](../../apps/server/src/modules/speech/speech.service.ts)、[Server 判定](../../apps/server/src/modules/server-settings/server-settings.service.ts)、[扩展占位页](../../apps/web/src/features/settings/extensions/ExtensionsPage.tsx)。

## 边界

- 新增通知只覆盖本 Server 受管实例及上述配置接口。直接编辑 MCP、环境或技能文件、CLI 安装扩展、修改 AGENTS.md/提示模板，没有新增文件监听通知；模型原有监视器保持不变。
- 通知只携带配置类别、版本与已有会话身份，不携带环境变量、密钥、技能正文或 MCP 配置值。
- 保存成功不等于旧进程已经应用；用户重启后从原 Session 文件恢复。运行中会话仍走既有中断确认或用户主动选择的任务结束后重启流程。
- MCP 在原子文件写入后、响应投影前通知；投影失败不能撤销提交事实。技能也在提交后、响应读取前通知。
- MCP 启停与技能普通保存的无变化操作不提醒；环境与 Jev 凭据根据返回的已提交文件 revision 区分无变化。上传替换技能视作一次提交。
- 这是源码检查与聚焦回归范围，不代表插件生态、外部文件修改或独立服务配置传播已全面验收。

## 验证记录

- 修改前 Server 干净构建通过，10 项相关基线测试通过。第一次测试在构建未完成时误启动，因 dist 缺失失败；等待构建完成后重跑，未修改断言或放宽超时。
- 首轮扩展聚焦测试 28/29 通过：发现重复启用已启用的 MCP 服务会写入 disabled=false 并错误提醒；已改为按有效 enabled 状态识别无变化，随后 29/29 聚焦测试通过。
- 新增生产模块 HTTP 装配及确定性 RPC 子进程测试，覆盖重启前运行代际不变、显式重启后提醒清除、幂等重放、Workspace 隔离、全局通知、无驻留实例不启动进程和秘密不进入响应。
- 后续增加 Jev 凭据提交后响应读取失败的回归，16/16 相关聚焦测试通过。
- Server 初次全量 443 通过、1 失败、1 跳过：C 盘使用率约 94.2%，触发附件存储 90% 水位保护；附件源码与测试均未变，单独运行同样返回 507。仅将测试 TEMP/TMP 改到 D 盘后，444 通过、0 失败、1 跳过。跳过项是既有的私有扫描 PDF fixture 测试。新增 Jev 回归后的全量在并行 lint/typecheck 时出现既有 dev-watch 测试等待超时；其源码与 fixture 均未改动，在 apps/server 目录独立运行通过。随后不并行运行其他检查，复跑全量：444 通过、0 失败、1 项既有跳过。未放宽测试超时或业务断言。
- Server/Web lint 与类型检查通过；Web 包没有 typecheck 脚本，使用 tsc -b 验证。Web 全量未通过；将本次三个 Web 文件临时恢复为 HEAD、使用相同依赖运行基线后，仍为 284 通过、3 失败，均为未修改的 ScrollArea 在测试渲染时报 React is not defined；随后已恢复本次改动，未编辑受保护的 UI 源文件。
- 原始日志保存在仓库本地 .cache/config-notification-server-test.log、.cache/config-notification-server-test-d-drive.log、.cache/config-notification-web-baseline.log、.cache/config-notification-server-final.log、.cache/config-notification-server-final-isolated.log。日志不提交。
- 本次未做浏览器人工验收，不调用真实付费模型。
