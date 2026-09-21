# ADR-0008: 在不可变 runtime 外离线派生 Session

## Status

Accepted

## Context

Pi 的 `switch_session`、`new_session`、`fork` 和 `clone` 会替换当前 AgentSession。Web 的源 Session 可能仍在后台 streaming；直接透传这些 RPC 会 abort 或换绑源 runtime，破坏多 Session 隔离和 Lease 不变量。

## Decision

1. Web 不暴露 Pi 的原始 Session replacement RPC。
2. “从此处继续”与 clone 是 Host 产品用例，必须创建新的业务 Session；源 Session、runtime、消息流和 Lease 保持不变。
3. Server 的 Sessions Module 通过 `PiSessionRepository` Adapter 使用 Pi 公开 `SessionManager` 离线读取 entries/tree，并创建分支或克隆 Session 文件。
4. 派生成功后写入 Session catalog；只有用户打开或显式 activate 新 Session 时才分配 runtime。
5. fork 以选定 entry 为新 leaf，并可返回用户消息 prefill；clone 复制当前 leaf，不修改源文件。
6. 派生请求必须验证源 Session 与 Workspace 映射，任何本地路径只保留在 Server 内部。

## Consequences

- 后台运行不会因浏览历史或派生操作被中断。
- 源/派生 Session 拥有独立 ID、URL、偏好和 runtime 生命周期。
- Session catalog 与离线派生需要原子失败语义，不能留下已展示但无法打开的记录。

## References

- [ADR-0005](./0005-host-owned-session-runtime-processes.md)
- [Pi Web 架构](../architecture/octopus-web.md)
