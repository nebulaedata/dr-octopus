# ADR-0059: Memory 单例后台与异步 SDK

## Status

Accepted — 2026-09-18。用户确认 Memory 使用单例 daemon、异步 SDK 和单一写入连接，并提供设置页启停管理。本决策更新 ADR-0050 的数据库访问与生命周期边界。

## Context

原 Memory SDK 在每个 Session RPC 和 Server 进程中同步打开 SQLite。缩短 busy timeout 能减少单次等待，但无法隔离这些进程的事件循环，也无法消除多个受控客户端的写锁竞争。Scheduler 和 Knowledge 已有独立后台，本轮不改变它们。

## Decision

- Memory 数据路径保持产品全局 `memory/memory.db`，不按 Workspace 或 Agent 配置目录拆分。按 OS 用户和规范化存储目录确定唯一服务身份。
- 复用 `daemon-platform` 的 native lifetime lock 和 detached launcher。只有锁持有者加载数据库、应用既有迁移，并持有一个长驻写入连接；发布 endpoint 前必须完成初始化。
- 公开 SDK 仅使用异步本机请求。HTTP 绑定 loopback，校验控制令牌、profile 与 daemon 身份，限制正文、响应、并发和仓储队列。原生数据库模块不进入 Memory 客户端依赖链。
- 每个仓储事务完整执行，不跨 IPC 暴露数据库对象或事务回调。仓储队列串行化事务与外部锁竞争重试；保留 50ms 锁等待及最多六次尝试。
- 模型推理留在 Session 侧。后台保留有容量和期限限制的整理 continuation，使用不透明 ticket 往返上下文和候选结果；候选提交仍由后台验证来源、版本、write epoch、删除屏障与幂等 receipt，且保持批次原子性和一次冲突重评。
- Session 启动只触发后台初始化，不等待服务启动或数据库迁移。晚到状态不能写入已关闭 Session；首次实际使用存储时仍等待就绪。Session/Server 的 client dispose 不停止全局服务。
- 显式停止先持久化停止意图，拒绝新工作并收尾，释放连接后才释放 lifetime lock。自动发现与普通业务请求尊重停止抑制；显式启动解除抑制。重启沿用控制 revision，禁止旧的重启覆盖较新的停止操作。
- 设置页使用独立服务状态查询和显式 start/stop/restart。停止服务与记忆模式 off 分别表示后台不可用和业务策略关闭，均不删除事实。服务停止时模式编辑禁用。
- Markdown 导出通过有界目录/正文请求读取，并检查 store identity 和 revision，避免混合快照；不在 daemon 内缓冲整个导出。

## Alternatives

- 每个 Session 一个 Worker：隔离阻塞但仍有跨进程写竞争，并增加线程数量。
- Memory daemon 再加 Worker：当前没有必要；发现后台自身的查询延迟问题后再评估。
- 合并 Scheduler、Knowledge、Memory 数据库或后台：扩大故障域和本轮改造范围，不采用。

## Consequences

受控客户端的数据库工作离开 Session/Server 主线程，写入归于单一所有者。代价是本机 IPC 和后台生命周期管理。外部 SQLite 工具或升级前仍运行的旧客户端仍可能争锁；更新后应重启旧 Session 和 Server，不能承诺任何情况下都没有 SQLITE_BUSY。

连接中断不代表写入未提交。SDK 不自动重放未知结果的写入；调用方使用既有 requestId 和 revision 查询或重试。后台重启使未提交的整理 ticket 失效，不恢复推理或伪报成功。

## Validation

验证跨进程并发启动只产生一个 owner、启动客户端退出后服务存活、停止抑制、重启保留事实、身份认证、远程整理的策略屏障、Session 启动不等待和关闭后忽略晚到状态。保留领域回归与真实 Pi SDK 测试；通过 Fastify 验证 lifecycle HTTP 端点和锁竞争期间无关请求响应，并在隔离数据库中验证设置页操作。
