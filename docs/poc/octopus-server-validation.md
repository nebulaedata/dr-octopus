# octopus-server：概念验证与验收

架构设计：[原设计](../architecture/octopus-server.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

# 72. 测试策略

## Unit Test

重点：

```text
SessionService
WorkspaceService
SessionsService
SessionRuntimeCoordinator
SessionRuntimeDirectory
AgentErrorMapper
MessageRouter
EventBus
```

SessionRuntimeCoordinator 测试注入 Mock AgentProcessManager Adapter。

---

## Integration Test

测试：

```text
Fastify HTTP
+
temporary SQLite
+
Drizzle
```

不一定启动真实 Pi。

---

## Agent Integration Test

单独测试：

```text
apps/server
+
@octopus/agent/rpc
+
test workspace
```

必须覆盖：

- 同一 Workspace 的两个 Session 可同时 running；
- 同一 Session 并发 activation 只启动一个进程；
- Session/Workspace/launch cwd 不一致时 spawn 前失败；
- dormant Session 按原 Session 恢复；
- replacement 命令无法绕过 Coordinator；
- 单 Session 崩溃只恢复对应 runtime，且新 generation 重新绑定事件；
- LRU 只回收已 settled 且所有安全门禁满足的 idle runtime；
- 每 Workspace 配额不误回收其他 Workspace；全部 running 时返回 capacity error；
- 事件和 extension UI response 始终带正确 runtime/workspace/session 身份。

避免普通单测都启动 Agent process。

---

## WebSocket Test

验证：

```text
connect
subscribe
prompt
event broadcast
unsubscribe
reconnect
slow consumer
disconnect cleanup
```

额外验证页面选择变化与 WebSocket disconnect 都不会发送 abort/stop，单 runtime `sequence` 可用于去重和 gap detection。

---
