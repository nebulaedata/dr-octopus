# scheduled-tasks：概念验证与验收

架构设计：[原设计](../architecture/scheduled-tasks.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

## 11. 验收门槛

| 范围           | 交付                                                                     | 必须通过                                                                              |
| -------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 平台生命周期   | 独立入口、OS SingletonLease、发现、stop 抑制                             | Windows 多进程与 Runtime 回收测试通过；Unix 实现纳入构建并完成发布矩阵实机验证        |
| Agent 控制面   | 专有 SQLite/Drizzle schema 与迁移、planner、Service、Client、独立 CLI    | 空库、重开、事务回滚、CRUD/replay、凭证隔离与 stop 抑制测试通过                       |
| Agent 执行     | 独立 Run Session、Runner、配置快照、权限中止及 result_deliveries         | claim 限额、dispatch evidence、cancel、timeout、交互中止、恢复与终态事务测试通过      |
| 内置接入与投递 | extensionFactories、tools/commands、SchedulerResultDelivery、Pi 写入适配 | 内置加载、Runner 防递归、离线补拉、忙时延迟、evidence 去重和 Session 范围排他锁已实现 |
| Host 接入      | Server Client adapter、Web 管理与消息投影                                | Server 仅映射 Workspace/Session 并调用 SDK                                            |
| 发布矩阵       | 构建产物、升级/停止说明、独立命令帮助                                    | Windows 与仓库 checks 已覆盖；Linux/macOS、安装包升级和长时间休眠恢复需发布环境验证   |

专项测试覆盖控制面 replay、并发启动、stop/start/restart、daemon 恢复、Runner 屏障和回显事务。发布前仍需在 Linux/macOS 与安装包环境验证 native SQLite/lock、升级替换和长时间休眠恢复。

回显专项验收：Run 完成事务失败不得出现孤立消息；来源 Runtime 被回收后补投；同时触发 start/settled/timer 只进行一轮；append 后 ack 前崩溃不重复展示；排队未持久化不能 ack；来源忙碌不触发额外模型调用；Session 替换后旧实例不写入；来源删除/临时不可达分开处理；fork/clone/切换分支不误投；投递失败不重跑任务；关闭协调器后无遗留 timer；Web/TUI 自定义消息和详情入口一致。核心策略通过窄 ports 单测，持久化/生命周期用真实 Pi RPC 集成验证。
