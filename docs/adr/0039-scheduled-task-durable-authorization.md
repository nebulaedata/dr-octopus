# ADR-0039: 定时任务使用 Permission 管理的持久授权

## Status

Accepted — 2026-09-06。用户确认方案并明确要求实施；已落地的范围、验证和剩余边界见[实施记录](../architecture/scheduled-task-authorization.md#11-实施记录2026-09-06)。

补充 ADR-0020 的唯一权限门禁和 ADR-0038 的独立 Scheduler 执行模式，不改变交互 PermissionMode 的进程级生命周期。

## Context

会话创建的新闻任务成功保存，但独立 Runner 默认 ask，在第一条 bash date 操作上要求交互，随后被 Runner 取消。来源会话的临时批准不能满足无人值守执行；统一改成 full 会扩大权限，且不能处理工具自身的问答。

用户希望授权对指定任务持续有效，同时维持 Scheduler 与权限系统清晰边界，并提供撤销、错误定位和重新运行闭环。

## Decision

1. permission-system 持有任务主体绑定的 durable grant，默认持续有效；批准/撤销通过可信用户入口，模型只能提案。
2. Scheduler 保存引用与执行摘要，通过 Runner 组装层注入上下文。Permission 不依赖 cron、Task 数据库或 Server；范围匹配只在唯一门禁执行。
3. 无人值守权限以 grant 为上限，敏感输入及当前强制 deny/ask 优先；全局 allow、读默认规则和 full 不得扩权。每次工具调用读取最新授权，撤销对后续门禁生效。
4. 授权使用 Permission 自有 SQLite 与事务审计；Scheduler SQLite 保持调度权威。以幂等操作和 CAS 协调绑定，崩溃时保留不可执行的未完成状态，无跨库事务或新服务。
5. 执行内容或能力变更使授权失效，重新批准生成新 grant；暂停保留授权，撤销阻断后续执行。来源会话关闭与进程重启不使有效授权丢失。
6. 保持独立后台配额和每 Run 进程，不占 Server Runtime 池。上下文初始化完成前禁止发送任务 prompt。
7. 权限失败与工具输入请求分开诊断；授权修复不自动重放旧 Run。历史必须展示具体原因和只读执行详情。

完整的数据字段、事务窗口、批准身份、撤销竞态、范围限制和验收矩阵以[专项设计](../architecture/scheduled-task-authorization.md)为准。

## Consequences

### Positive

- 一次明确批准可支持跨进程的持续执行，无需继承来源会话的宽泛模式。
- 一个权限门禁拥有完整执行判断与审计；Scheduler 只负责调度及状态转换。
- 失败可解释、可处理，撤销和崩溃恢复有确定性语义。

### Negative

- 新增授权存储与跨模块幂等协调，需要维护 CAS、版本及恢复测试。
- 每次门禁读取最新 grant 带来本地查询成本，不能用无限期缓存优化掉撤销一致性。
- 首期执行提示词修改一律重新确认；工具细粒度范围需要真实适配器，无法支持任意 shell 的安全前缀批准。

### Neutral

- 不是 OS 沙箱；已获许可并开始执行的外部副作用不可因撤销回滚。
- 现有任务需显式补授权；交互 ask/auto/full 语义不变。
- Pi 公开结构化 readiness/失败信号适配必须先通过锁定版本集成测试，再实现正式链路。

## Alternatives Considered

- 继承来源 full 或会话批准：拒绝，生命周期和范围不匹配。
- 全局静态工具 allow：可作为现有手动配置，但影响其他任务/会话，缺少任务级撤销与变更绑定。
- Scheduler 自动批准 UI：拒绝，会形成第二个判断点并误批非权限交互。
- grant 直接存入 Scheduler 表：拒绝，权限生命周期及匹配会依赖调度内部结构。
- 单独权限 daemon/消息总线：拒绝，当前单用户本地场景可用 SQLite 短事务与既有维护循环完成。
- 仅在运行启动时冻结 allow 快照：拒绝，长任务无法及时感知撤销。

## References

- [唯一权限门禁 ADR-0020](./0020-single-authority-permission-gate.md)
- [独立 Scheduler ADR-0038](./0038-agent-owned-singleton-scheduler-daemon.md)
- [持久授权专项设计](../architecture/scheduled-task-authorization.md)
