# Session 创建与加载耗时诊断

实测日期：2026-09-15。Windows，Node v24.20.0，Pi 0.84.3，General Workspace，当前本机扩展配置。

## 结论

新建和冷加载主要阻塞在 **RPC 子进程启动到首次 `get_state` 响应**。这个时间包含 CLI 模块导入、Pi 资源/扩展加载、模型目录初始化和 `session_start`，不能等同于操作系统的 `spawn` 耗时。

每个冷 Session 都启动独立 Node 进程，重新承担完整 CLI 和扩展导入成本。当前外部扩展通过 Pi 的 jiti loader 逐个加载；进程内缓存不能跨新进程复用。这是本次空 Session 也需等待数秒的主要原因。

全局 admission 队列还会放大等待：它持有整个启动临界区，直到进程 ready 才释放。一个慢启动会阻塞后续不同 Workspace/Session 的冷启动。本次顺序样本没有队列积压；此放大效应来自代码审查，没有以本次顺序数据冒充并发实测。

## 实测总耗时

默认诊断模式连续三组，每组先新建并 bootstrap，然后停止该诊断进程，冷加载同一个空 Session，再立即热加载。

| 场景             |   第 1 次 |   第 2 次 |   第 3 次 |      平均 |
| ---------------- | --------: | --------: | --------: | --------: |
| 新建 + bootstrap | 5911.2 ms | 6018.2 ms | 6054.7 ms | 5994.7 ms |
| 冷加载 bootstrap | 5955.4 ms | 5946.0 ms | 5992.9 ms | 5964.8 ms |
| 热加载 bootstrap |   12.7 ms |    9.1 ms |   10.3 ms |   10.7 ms |

补充对照：

- 最早探索样本：新建 10032.0 ms，冷加载 6780.8 ms，热加载 10.3 ms。该样本提示文件缓存和运行环境影响明显；后续三组数据覆盖了原始探索文件，不能据此报告统计分位数。
- 使用正式 CLI 入口而非诊断入口：新建 6759.6 ms，冷加载 6515.2 ms，热加载 9.8 ms，同样复现秒级冷启动。
- 首页实际 draft 路径 `prepareDraftSession → getBootstrap`：6825.2 ms；同一 draft 冷加载 5907.0 ms，热加载 8.8 ms。
- 仅向诊断子进程传 `--no-extensions`：新建 2862.6 ms，冷加载 2794.8 ms，热加载 11.0 ms。保留内置 inline extensions，没有修改用户 settings。相对三组默认均值约减少 3.1 秒/52–53%；这是单次对照，不能当作关闭某一个扩展的精确收益。

## 分阶段耗时

以下使用默认第 2 次新建作为代表，单位 ms。

| Host 阶段              |        耗时 | 说明                                     |
| ---------------------- | ----------: | ---------------------------------------- |
| Workspace resolve      |        1.86 | 创建前解析 Workspace                     |
| admission 排队         |        0.06 | 顺序采样，无竞争                         |
| 容量检查/回收          |        0.02 | 未触发淘汰                               |
| Pi Session header 创建 |        4.62 | 使用正式 bootstrap，写入临时目录         |
| RPC start → ready      | **5981.66** | 占总耗时 **99.4%**                       |
| ready 后 metadata 读取 |        0.78 | 有界 JSONL header 读取                   |
| catalog upsert         |        4.71 | 临时 SQLite，正式 Repository             |
| bootstrap 整体         |       22.27 | 含第二次 Workspace resolve、RPC、投影等  |
| 创建 + bootstrap 总计  | **6018.18** | 还包含未单独包裹的路径校验/调度/投影开销 |

RPC start → ready 内部：

| 子进程阶段                            |    代表耗时 | 多次观察/解释                                          |
| ------------------------------------- | ----------: | ------------------------------------------------------ |
| 环境模块导入及配置                    |       20.47 | 三组新建约 19–20 ms                                    |
| CLI 模块导入                          | **2386.15** | 六次冷进程约 2299–2525 ms                              |
| 初始 ModelRuntime.create              |       27.63 | 含其内部 refresh                                       |
| resources.reload                      | **2477.50** | 六次冷进程约 2431–2583 ms                              |
| resources 之后的 ModelRuntime.refresh |  **728.42** | 还有一个重叠的后台 refresh，不能相加                   |
| extensions.bind                       |      144.75 | 包含 session_start 144.02 ms                           |
| 其余                                  |  未单独归因 | Node 进入入口前、CLI 准备、Pi Session 建立、协议接线等 |

Pi 自带扩展计时中，主要的 `module import` 区间：

| 外部扩展               | 代表耗时 | 六次冷进程范围 |
| ---------------------- | -------: | -------------: |
| pi-subagents           | **1270** |      1235–1270 |
| pi-mcp-adapter         |  **417** |        410–499 |
| pi-web-access          |  **302** |        298–322 |
| rpiv-ask-user-question |  **292** |        290–310 |

这些数值来自 Pi 的相邻时间标记，不是所有模块的独立 CPU 时间。尤其首个扩展标记会包含此前资源发现等工作。`resources.reload` 才是直接包裹测量的完整资源阶段。无外部扩展对照中该阶段降至约 96 ms，后续模型 refresh 也降至约 15–29 ms。尚未把模型 refresh 的差额归因到某一个扩展/Provider。

bootstrap 的 `get_state`、`get_messages`、`get_entries`、`get_session_stats`、`get_available_models`、`get_commands`、`get_available_thinking_levels` 在 Host 中并发发送。代表样本各 RPC 约 1.96–2.25 ms；它们相互重叠，不能相加作为 bootstrap 总耗时。额外 `/knowledge status` 约 2.26 ms。没有发送用户模型 prompt。

## 页面为什么一直等待

首页：[AgentHomePage.tsx](../../apps/web/src/features/home/AgentHomePage.tsx) 先等待 draft prepare 成功，才启用 `useSessionRuntime`。prepare 内部已经要等待完整 RPC 激活。

已有 Session：[realtime-queries.ts](../../apps/web/src/queries/realtime-queries.ts) 发起 bootstrap，同时保留 WebSocket 订阅；只有 bootstrap 与订阅的 runtimeId/epoch 一致才 hydrate。[Session 页面](../../apps/web/src/features/session/index.tsx) 再检查 `loadState` 和 readiness 才解除 loading/输入禁用。

因此新 Session 和已有 Session 冷加载都被完整的 runtime readiness 阻塞。HTTP bootstrap 与 WebSocket 激活通过同一 Slot Promise 合并，不是各自再创建一个进程。

主要代码证据：

- [SessionsService](../../apps/server/src/modules/sessions/sessions.service.ts)：创建、draft、bootstrap 与并发 RPC。
- [Coordinator](../../apps/server/src/lib/runtime/coordinator.ts)：新建/已有 Session 在 admission.run 内等待 manager.start。
- [Admission](../../apps/server/src/lib/runtime/admission.ts)：前一个 operation 完成后才释放串行队列。
- [AgentRpcProcess](../../packages/agent/src/rpc/rpc-process.ts)：spawn 后立即发送 `get_state` 并等待响应。
- [run-cli](../../packages/agent/src/cli/run-cli.ts)：静态导入 Pi 和多个内置扩展，再进入 Pi main。
- 当前安装的 Pi `dist/core/extensions/loader.js`：逐个 await loadExtension，jiti `moduleCache: false`，扩展缓存属于进程内。

## 复现与测量边界

在仓库根目录执行（需要已有匹配当前 Agent 源码的 dist 和安装好的扩展）：

```powershell
pnpm --filter @octopus/server exec node --import tsx scripts/profile-session-startup.mjs general 3 startup.json
pnpm --filter @octopus/server exec node --import tsx scripts/profile-session-startup.mjs general 1 draft.json draft
pnpm --filter @octopus/server exec node --import tsx scripts/profile-session-startup.mjs general 1 production.json production
pnpm --filter @octopus/server exec node --import tsx scripts/profile-session-startup.mjs general 1 no-extensions.json no-external-extensions
```

输出相对路径以 apps/server 为基准；可传绝对路径。第一个参数也可替换为目标 Workspace ID。

[主脚本](../../apps/server/scripts/profile-session-startup.mjs) 使用当前 Server 源码、正式 Repository/Coordinator/RPC 进程，创建临时 catalog 和临时 Session 文件，并在结束时关闭自己创建的 runtime、清理临时文件。[诊断子进程入口](../../apps/server/scripts/session-startup-child.mjs) 调用已构建的正式 Agent CLI，只在本进程包裹 SDK 方法并向 stderr 输出计时。它们均位于 Host scripts 下，没有修改 Agent 源码或用户配置。

JSON 含每个阶段的起点、持续时间、结果状态、子进程计时。span 是 inclusive wall time；父子 span、并发 span 和各 Pi namespace 的 TOTAL 不能累加。模型输出和凭据不写入报告。

本次原始结果保存在仓库本地 `.cache/session-startup/`（不提交缓存）：`session-startup-profile.json`、`session-startup-production.json`、`session-startup-no-extensions.json`、`session-startup-draft.json`。

本次统计覆盖完整 Server service 创建/加载流程到 bootstrap DTO 返回，**不包含浏览器网络、WebSocket 确认、React 渲染或大型历史的额外成本**。这些是空 Session 在 General Workspace 的本机观测，不代表全部 Workspace。没有将顺序样本称为磁盘冷缓存基准，也没有以这三组样本计算 P95。

## 后续优化优先级

1. 针对 CLI 的全量静态导入和外部 TypeScript 扩展导入做减重/预编译，重点检查 pi-subagents。保留扩展能力，先逐项对照验证。
2. 检查资源注册后的模型目录 refresh 重叠与重复工作，再做去重；当前只确认耗时和相关性。
3. 缩短 admission 全局临界区；设计容量预留和失败回滚后，让不同 Session 的进程启动可并发，避免启动耗时叠加。
4. 若希望历史内容更早显示，可另行设计离线快照先呈现、runtime 后就绪；需要保留当前代际一致性和输入安全契约。

本次仅完成诊断，未实现以上优化。验证：真实新建/冷/热/draft/正式入口/无外部扩展对照均成功；Server lint、typecheck 通过，现有 Server 测试 252/252 通过。

## 后续实施：历史先展示

后续按优化方案第 3 点增加 `GET /api/workspaces/:workspaceId/sessions/:sessionId/history`。该接口检查 Workspace 归属，只读取当前持久化分支、消息附件和反馈，不激活 Pi，也不返回 runtime identity 或 readiness。

Web 在 runtime bootstrap 期间独立获取历史。`historyLoaded` 只代表有可展示的历史，`hydrated`、runtimeId/epoch 和发送就绪条件仍由实时快照决定。空历史也可结束骨架屏；启动失败后已读历史继续保留。迟到的历史响应不能覆盖已经 hydrate 的实时投影、其他 Session 或乐观发送消息。正式 hydrate 替换历史投影并继续回放缓冲事件，保留草稿。

已有会话启动期间可以编辑草稿；发送、命令和模型控制继续等待原有就绪检查。首页已有允许输入草稿的逻辑，继续沿用。此改动改善可读/可输入时间，**没有缩短 RPC 冷启动时间**。

第 5 点进一步确认：Pi `registerNativeProvider` 会自动启动 refresh，启动编排随后又调用 refresh。按用户要求不修改 Pi/第三方源码、不修改 patches，相关试验补丁和锁文件变更均已撤回，当前依赖已恢复。第 5 点暂不实施，不能把上游内部刷新去重称为 Server 内的简单修复。

历史预览回归验证：Server 254 项、Web 130 项、Shared 2 项测试通过，各范围 lint 和类型检查通过。Server 的原有崩溃恢复测试在并行检查时出现一次失败，单独复测和随后完整测试均通过。新增测试覆盖 Workspace 隔离、分支历史读取、空历史、启动失败、草稿与缓冲保留、迟到/跨 Session 响应，以及实时快照接管。浏览器自动化因认证不可用未完成目视验证。
