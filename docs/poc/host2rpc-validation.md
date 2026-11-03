# host2rpc：概念验证与验收

架构设计：[原设计](../architecture/host2rpc.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

## 17. 验证清单

- 一个 Tab 只建立一条 `/ws`，可同时收到多个 Session 的交错事件。
- 同一 Session 的并发 activate 共享一个 Slot activation Promise，只启动一个 process。
- 两个不同 Session 可以对应两个不同 pid 并同时输出。
- snapshot 在订阅前完成水合，重连后订阅能够重放。
- Prompt ACK 与 Agent completion 分离，完成以 `agent_settled` 为准。
- RPC response、Agent event、Extension UI request 能正确分流。
- RPC stdout 跨 chunk、UTF-8 半字符、CRLF 和残帧均被正确处理。
- sequence gap 会触发 snapshot reconcile。
- running/compacting/queued/pending UI/in-flight runtime 不可被容量回收。
- 删除 Session 和 Server shutdown 能执行 abort、settled、SIGTERM、SIGKILL 兜底。
- 慢 WebSocket 消费者和过大 RPC frame 不会造成无界内存增长。
