# ADR-0010: Workspace 包含 Web Session Catalog，并映射 Pi Agent Session

## Status

Accepted

## Context

Web 需要持久化可编辑的会话列表标题等产品元数据，而 Pi Session JSONL 持有对话历史、分支和 Agent Session 身份。Workspace 已由 `@octopus/agent` 的受管 Registry 提供稳定身份与可信 cwd；若 Server 再建立 Workspace 表，会产生双重事实源。

Web Session 与 Pi Agent Session 也不能视为同一个实体。Web Session 属于一个 Workspace，并通过 Server 私有映射绑定一个 Pi Agent Session；Web 标题不应通过 `set_session_name` 修改 Pi 数据。

## Decision

1. `@octopus/agent` Workspace Registry 是 Workspace 唯一权威，Server 不创建 SQLite Workspace 表。
2. Workspace 与 Web Session 是一对多关系；所有 Session HTTP 资源位于 `/api/workspaces/:workspaceId/sessions/...`。
3. SQLite Session Catalog 是 Web 产品元数据的权威，保存独立 `id`、`workspaceId`、`agentSessionId`、私有 `agentSessionPath` 和 `title`。
4. Pi Session JSONL 是对话内容与 Agent Session 身份的权威。Server 打开 runtime 前必须验证 Catalog 映射、Pi header identity 和 canonical Workspace cwd。
5. `sessionId` 表示 Web Session，`agentSessionId` 表示 Pi Session，`runtimeId` 表示进程实例；三者不得混用。对外事件只暴露 Web Session ID。
6. Web 标题 mutation 只更新 SQLite Catalog，不调用 Pi `set_session_name`。
7. 旧 Catalog 在启动时以 `agentSessionId = id` 迁移，保持既有 Session 可用。

## Consequences

- Workspace 不产生 Registry/SQLite 双写问题。
- Web 标题、排序和后续归档等产品元数据可以独立演进。
- runtime binding 必须同时持有 Web Session ID 和 Pi Agent Session ID。
- SQLite 与 Pi 文件跨存储边界，Catalog 指向缺失 Pi Session 时必须返回稳定错误，不能静默改绑。
- Workspace 删除必须在存在 Catalog Session 或活动 runtime 时拒绝；级联删除不属于当前决策。

## Alternatives Considered

### A1: 为 Workspace 建立 SQLite Repository

拒绝。当前 `@octopus/agent` Registry 已是跨 CLI/Host 的权威，会引入没有业务收益的双写与恢复成本。

### A2: 直接把 Pi Session ID 当作 Web Session 实体

拒绝。Web 标题等产品元数据不属于 Pi，且会让 Host 生命周期与外部 Session identity 耦合。

### A3: 每次从 Pi Session 列表重建 Web Catalog

拒绝。Web 标题等数据无法从 Pi 稳定重建，Catalog 不是缓存。

## References

- [ADR-0004](./0004-workspace-pi-extension-control-plane.md)
- [ADR-0005](./0005-host-owned-session-runtime-processes.md)
- [ADR-0007](./0007-web-control-and-realtime-protocol.md)
