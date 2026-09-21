# ADR-0007: Web 控制面使用 HTTP，运行面使用单 WebSocket

## Status

Accepted

## Context

Workspace、Session 和历史查询适合可缓存、可重试的请求；流式消息、工具更新和多个后台 Session 则需要低延迟双向通道。只使用 WebSocket 会削弱恢复和缓存语义，只使用 HTTP 会让多 Session streaming 复杂化。

## Decision

1. HTTP 承担 capability、Workspace/Session CRUD、activate、snapshot、entries/tree、fork/clone、stats/export、models、commands、preferences 和附件暂存；Session 资源使用 `/api/workspaces/:workspaceId/sessions/...` 表达父子关系。
2. 每个 Browser Tab 只创建一个 WebSocket，并在其上订阅多个 Session；页面切换不关闭连接、不停止 runtime。
3. 所有 mutation 携带 `requestId`；Session 命令携带 Web Catalog `sessionId`，对旧实例敏感的命令还携带 Server 签发的 `runtimeId`。Pi `agentSessionId` 不对浏览器公开。
4. Server 事件信封包含协议版本上下文、`runtimeId`、`workspaceId`、`sessionId`、单 runtime `sequence` 和时间戳；用户消息生命周期事件还携带原始 mutation `requestId`，用于精确替换客户端乐观消息。
5. WebSocket 负责 ACK、事件广播、queue、health、Extension UI 与错误；断线恢复依赖 HTTP snapshot + entries cursor，而不是内存事件回放。
6. 客户端发现 sequence gap 时停止相信增量投影并重新获取权威快照。

## Consequences

- HTTP 查询可由 TanStack Query 管理，Session 实时投影由独立 Zustand vanilla store 管理。
- Server 必须执行 Origin、尺寸、订阅数、速率和慢消费者限制。
- 协议升级必须修改 `OCTOPUS_PROTOCOL_VERSION` 并通过 capability 协商。

## References

- [Pi Web 架构](../architecture/octopus-web.md)
- [Server 架构](../architecture/octopus-server.md)
