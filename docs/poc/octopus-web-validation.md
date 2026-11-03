# octopus-web：概念验证与验收

架构设计：[原设计](../architecture/octopus-web.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

# 78. 关键验收测试

必须验证：

### Case 1

```text
打开 Session A
发送 Prompt
Agent A 开始 Streaming
```

### Case 2

在 A 尚未结束时：

```text
切换 Session B
```

结果必须：

```text
A 不 abort
A WebSocket subscription 不断
A SessionStore 继续更新
```

### Case 3

等待 A 在后台继续生成。

### Case 4

重新进入 A。

必须：

```text
立即看到后台期间生成的完整最新消息
```

而不是：

```text
重新请求
丢消息
从旧状态恢复
```

### Case 5

A、B 同时有 Agent Event。

必须：

```text
A Event → Store A
B Event → Store B
```

绝对不能串 Session。

### Case 6

WebSocket 断线重连。

必须：

```text
Session Store 保留
RealtimeClient reconnect
SubscriptionManager resubscribe
Server snapshot/reconcile
```

### Case 7

A、B 同时 streaming，或旧 runtime 的迟到事件到达时：

```text
A Event → Store A
B Event → Store B
old runtimeId Event → discard / diagnose
```

### Case 8

dormant、starting、recovering、failed、capacity 和 waiting extension UI 都有独立可理解的展示；切页后 UI response 仍只发送给原 `runtimeId/sessionId/requestId`。

### Case 9

切换 Workspace 不停止原 Workspace 的 running Session；同 Workspace 多个 running Session 有可见的并发编辑风险提示。

---
