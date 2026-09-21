# Scheduler 实施与验证记录

日期：2026-09-05。配套设计：[Scheduler 架构设计](./scheduled-tasks.md)。

## 当前结论

Scheduler 已完成代码实现与 Windows 开发环境验收。服务由 `packages/agent` 的独立单例 daemon 持有；内置 Extension、CLI 和 Server 薄适配都通过 Agent SDK 访问同一服务。RPC Runtime 或 Server 退出不会停止 daemon，只有显式 `service stop`、服务故障或 OS 终止会结束它。

每个 Run 使用独立 Pi RPC 进程和 Session 目录。Runner 在 prompt 前提交 Session dispatch barrier，在 prompt 持久化后提交 entry evidence；不确定的 dispatch/running 遗留状态恢复为 `interrupted`，不会自动重放。Run 终态与来源会话待回显记录在同一 SQLite 事务提交。

来源 Session 的 `SchedulerResultDelivery` 在 `session_start`、`agent_settled` 与低频轮询时统一协调投递。它只在 Session 空闲时写入不触发模型 turn 的自定义消息，按 deliveryId 查找持久 evidence 后再 ack，并使用 Session 范围 OS 排他锁串行化跨 Runtime 的“查找—写入—确认”。该机制是 SQLite 持久投递清单，不引入消息队列。

## 已实现边界

- daemon：canonical Agent profile 单例、OS 文件锁、原子 endpoint、独立生命周期凭证、显式 start/status/stop/restart 和持久 stop 抑制。
- Windows 脱离：优先验证 detached/Job 行为；嵌套 Job 下使用本地 WMI `Win32_Process.Create` 启动并校验用户与 Job 归属。失败时拒绝启动，不接受会随 Runtime 回收的候选进程。
- 存储：Agent 专有 `better-sqlite3 + drizzle-orm` 四表 schema、版本化 migration、外键与事务；不导入 Server schema 或 repository。
- 控制面：严格 Workspace/来源 Session fence、规范化计划、revision、幂等 mutation replay、软删除、暂停、手动运行与取消。
- Worker：单扫描时钟，全局按 maxConcurrentRuns 配置（默认 3）、每 Workspace 2、每 Task 1 的 claim 限额；misfire、queue-one/skip、取消意图、恢复和有界关闭。
- Runner：每 Run 独立 Session、配置快照、绝对超时、交互请求转 `needs_attention`、最终文本有界摘要、Runner 禁止递归启动 Scheduler Extension。
- 回显：终态事务创建 delivery，来源离线保留；持久 evidence 去重、ack/defer、指数退避、跨进程来源锁、shutdown dispose。
- 接入：内置 `extensionFactories` 注册八个工具、命令、生命周期事件和 TUI completion renderer；通过 `@octopus/agent` 根入口公开 Scheduler SDK。
- Server/Web：Server 仅校验 Workspace/Session、映射 Web Session ID 与 Pi Session ID、调用 SDK 并投影响应；Server preClose 不停止 daemon。Web 管理页展示独立运行语义、暂停状态和历史。

## 验证证据

Scheduler 专项当前共 31 项，通过内容包括：

- concurrent start、canonical alias、restart ownership、离线 stop 与自动 ensure 抑制；
- 正常 Runtime stop 和异常 Runtime exit 后 daemon 继续存活；
- Windows OS 锁竞争、持有者强杀恢复、主动交接、launcher 强杀与 argv 编码；
- SQLite 空库迁移、重开保留、事务回滚和缺少 migration 时拒绝启动；
- CRUD/replay、scope、revision、暂停/删除、不可变 Run snapshot 与取消 delivery；
- claim 容量、dispatch/running evidence、abandoned recovery、Worker 取消；
- Runner 成功、交互中止、取消和超时；
- 回显 readiness、single-flight、evidence-before-ack、退避和来源 Session 锁。

Server 薄适配测试验证 Agent/Web Session 身份双向映射、SDK 转发、客户端关闭不停止 daemon。自动化测试使用临时 profile、确定性 fake Runner/RPC，不调用真实模型。

## Web 真实模型端到端验证

2026-09-06 在 Windows 开发环境使用 Web、Server、独立 Scheduler daemon 和已配置的 DeepSeek V4 Flash 完成两条真实链路验证：

- 管理页入口：从“定时任务”页选择 General Workspace 和来源 Session，创建一次性任务并立即运行；两个连续手动触发按 `queue-one` 顺序完成，摘要均为 `E2E_WEB_SCHEDULER_OK`，运行历史显示成功，两个结果均回显到来源 Session。
- Session 入口：在来源会话中由模型调用 `scheduler_create`，权限确认后成功创建任务；该任务出现在全局管理页并正确映射回 Web Session，手动运行产生独立 Run，摘要为 `E2E_SESSION_SCHEDULER_OK`，随后回显到同一来源 Session。
- 收尾：通过公开接口验证暂停和删除语义，清理测试 Task、Run、mutation 与 delivery 数据，显式关闭 Scheduler；管理页显示服务已停止，浏览器控制台无错误。

此次验证发现成功 Run 未写入 `startedAt`。Worker 现已在持久 prompt evidence、状态转为 `running` 的同一更新中记录开始时间，并增加回归断言。

## 可重复执行

```powershell
pnpm --filter @octopus/shared build
pnpm --filter @octopus/agent build
node --test packages/agent/test/scheduler-*.test.mjs
pnpm --filter @octopus/server build
node --test apps/server/test/scheduled-tasks-adapter.test.mjs
```

管理命令在 Workspace、onboarding 和模型初始化之前分发：

```powershell
node packages/agent/dist/bin/octopus.js scheduler service status --agent-dir <Agent数据目录>
node packages/agent/dist/bin/octopus.js scheduler service start --agent-dir <Agent数据目录>
node packages/agent/dist/bin/octopus.js scheduler service stop --agent-dir <Agent数据目录>
node packages/agent/dist/bin/octopus.js scheduler service restart --agent-dir <Agent数据目录>
```

省略 `--agent-dir` 时使用 Pi 公共 Agent 路径解析。源码开发入口（`pnpm dev:agent` / tsx）也启动 dist 中的 daemon，以保持 Runner 和迁移资源一致；首次使用及修改 daemon 后先运行 `pnpm build:agent`，再启动或重启服务。缺少构建入口时会立即返回构建提示。

## 发布矩阵剩余项

Linux/macOS 的 `flock`、安装包内 native SQLite/Koffi 资源、Agent 升级替换、长期休眠/唤醒和更多真实模型/权限组合仍需在目标发布环境验证。当前实现与测试不会把这些 Windows 开发环境之外的结果标为已验证。

参考：[Windows 嵌套 Job](https://learn.microsoft.com/en-us/windows/win32/procthread/nested-jobs)、[WMI 进程创建](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/create-method-in-class-win32-process)。
