# ADR-0038: Agent 持有独立单例 Scheduler 服务

## Status

Accepted and implemented — 2026-09-05。

用户已确认的架构约束：Agent 侧服务、不依赖 Server、跨 Runtime 共享单例、Runtime 回收不停止服务、保留 `extensionFactories` 内置加载、独立命令管理服务生命周期。
每次运行使用独立 Run Session，完成摘要投递到来源 Session；回显策略由 Agent 内部协调器统一管理，持久化采用独立 SQLite 与 Drizzle 技术栈。实现与验证证据见[配套记录](../architecture/scheduler-verification.md)。

## Context

Scheduler 必须作为 Agent 能力独立完成任务持久化、调度与执行。Server 只负责请求、Workspace 与 Session 映射以及结果投影，不能成为 Scheduler 的运行依赖。

Server 的一个 Session 对应一个可回收 RPC Runtime。所有 Runtime 的 Scheduler Extension 都必须连接同一后台服务；
启动服务的 Extension 退出、Session 切换、最后一个客户端断开及 Server 退出，都不是停止服务的指令。
无需创建独立 Pi package；代码组织、Pi 加载方式与 OS 进程生命周期是三个独立问题。

## Decision

1. Scheduler 作为 `packages/agent` 内聚的可选能力，拥有独立 daemon 入口、Client SDK、存储、计划计算、Worker 和 Agent Runner。不得导入 `apps/server`。
2. 内置 Extension 仍通过 `extensionFactories` 加载。factory 只注册 Pi surfaces；`session_start` 或首次使用通过 Agent SDK 发现/启动服务，不在加载发现阶段创建进程。
3. 单例范围为同一 OS 用户和规范化 Agent 数据目录。不同 Workspace、Session、CLI/RPC 模式及客户端版本不得各自启动 daemon。
4. daemon 持有覆盖整个运行生命周期的 OS 排他锁；PID、endpoint 文件及 heartbeat 均不是唯一性权威。健康检查超时不得触发抢占。
5. 服务由独立命令启动、查询、停止、重启。停止具有持久抑制状态，后续 Extension 自动连接不能把用户刚停止的服务重新拉起。
6. daemon 在启动 Runtime 死亡后仍可独立执行。Runner 使用 Agent/Pi 公开能力；Server 仅将请求、Workspace 映射和结果投影到 Client SDK。
7. 每个 Run 使用独立 Pi Session，来源 Session 用于回显和追溯，不作为可并发重开的执行文件。继续原交互 Session 执行需要 Agent 侧跨进程所有权协议。
8. 同一 profile 共享 Scheduler 专有 SQLite，由 daemon 单写；采用 `better-sqlite3 + drizzle-orm`，`drizzle-kit` 为开发依赖。Scheduler 独立拥有 schema、repository 和版本化迁移，客户端仅通过 SDK 访问，不导入 Server 数据库模块。数据库依赖仅由 daemon 路径加载，公开契约不泄漏 ORM 类型。调度语义包括 schedule、幂等、revision、lease、cancel intent、misfire、dispatch evidence，以及不确定执行禁止自动重放。
9. 服务身份、客户端身份与执行 Runtime 身份分离。Runtime capability 不作为 daemon 存活、恢复或长期认证依据。
10. Run 终态与待回显记录在同一 Scheduler SQLite 事务提交，不引入 Redis/RabbitMQ 或通用消息平台。来源离线时保留 pending，重新打开后补拉。
11. `SchedulerResultDelivery` 内聚 readiness、查询、去重、写入确认、ack 和重试；session_start、agent_settled、低频检查只调用 reconcile，shutdown 只 dispose 本实例。Worker 不持有来源 Pi context，Server 不实现第二套投递逻辑。
12. 摘要由来源 Session 当前合法 owner 写入，daemon 不直接追加来源 JSONL。以稳定 deliveryId 和持久 entry evidence 去重，确认丢失只补 ack；SQLite 与 Pi 之间不宣称原子 exactly-once。
13. 完成摘要进入后续模型上下文，但不自动启动模型 turn、不打断正在执行的用户任务。完整执行过程留在 Run Session；Web/TUI 提供明确的完成消息和执行详情入口。投递失败不改变 Run 结果、不重跑任务。

## Alternatives Considered

| 方案                                      | 判断                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| 保留 Server-owned Worker                  | 不满足独立 Agent 能力与依赖方向                                                   |
| 每个 Extension 启动自己的 Scheduler       | 不满足共享单例，会产生重复计划与执行                                              |
| 仅 `unref()` 或延长 Runtime TTL           | 不提供独立进程所有权及服务管理契约                                                |
| 独立 Pi package                           | 本轮明确不采用；内置扩展可以携带 daemon                                           |
| daemon 调用 Server Runner                 | 执行仍依赖 Server，不满足 Agent 独立运行要求                                      |
| daemon 重开原 Session 文件                | 未统一交互进程所有权前不安全                                                      |
| SQLite 驱动直接编写全部 SQL               | 可行，Drizzle 并非 SQLite 必需；本项目选择沿用已有 ORM 与迁移工作流，降低维护成本 |
| 共用 Server 数据库或每个 Extension 各建库 | 前者依赖 Host，后者拆散共享权威；采用 profile 级 daemon 专有数据库                |
| 引入外部消息队列                          | 本地单例投递需求由 SQLite 持久清单和低频补拉满足，无需额外中间件                  |
| 在每个事件中分别写投递策略                | 导致忙闲、去重、重试规则分叉；事件只触发同一协调器                                |
| daemon 直接向来源 JSONL 写完成消息        | 绕过来源 Session owner，可能双写；由来源 Extension 通过 Pi 写入并确认             |

## Consequences

- 独立 Agent 与 Server 使用相同调度领域实现；Runtime 回收不再参与服务生命周期。
- Agent 会显式新增 SQLite 驱动、Drizzle ORM 及独立迁移资源，无需额外数据库服务；迁移工具仅作开发依赖。还需提供 daemon 启动及后台执行基础设施；通过独立入口、延迟加载和窄 SDK 保持其他 Agent 使用路径轻量。
- 跨平台进程脱离、单例锁、停止抑制、安装升级以及无人值守配置成为必须验证的能力。
- 独立 Run Session 拥有自己的上下文和权限快照，来源 Session 只接收完成摘要。
- 无客户端时 daemon 自身崩溃后的自动拉起、开机自启不属于当前承诺；不影响 Runtime 被回收后健康 daemon 继续执行的核心要求。
- Windows Job Object/Unix 进程组清理需要实际平台证明；不能仅用 `detached` 配置宣称验收完成。
- 回显只增加同库记录和 Agent 内聚投递模块；代价是补齐 Pi 持久 evidence 确认与 Web/TUI 消息投影，来源离线时摘要延迟到重新打开后显示。

## Verification

以 [Scheduler 架构与验证矩阵](../architecture/scheduled-tasks.md) 为准。最高优先级场景为：多个客户端并发启动仅一个 daemon；杀死启动它的 Runtime 和全部客户端后任务仍到期执行；完全不启动 Server 的 CLI 路径可完成创建、执行、取消与查询；显式停止不被客户端自动拉起。

存储还必须覆盖：空库初始化、版本化迁移、迁移失败拒绝 ready、事务回滚、原生驱动和迁移资源随 Agent 独立分发；普通 Agent/SDK 入口不加载数据库模块。

回显还必须覆盖：终态与通知原子提交、离线补投、来源忙碌延迟、并发事件 single-flight、append 后 ack 前崩溃去重、Session 替换后拒绝晚到写入、Web/TUI 历史与实时一致、投递失败绝不重新执行任务。

## References

- [Scheduler 架构设计](../architecture/scheduled-tasks.md)
- [Scheduler 实施与验证记录](../architecture/scheduler-verification.md)
- [Node child process](https://nodejs.org/api/child_process.html#optionsdetached)
- [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
