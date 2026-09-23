# 指令生命周期专项复查

## 范围与结论

基线为 `bfcf87e` 加当前工作区未提交的记忆与指令收尾改动。此次复查覆盖 Server Channel、运行时状态与停止协调、Web 实时消息处理、回合 Store、订阅保留，以及 Agent RPC 和相关扩展入口的只读检查；不代表全仓所有业务已经完成审计。

确认 4 项缺陷，均待修复。下列证据来自当前生产实现的最小复现，不是仅凭搜索结果判断。本次只更新规范和审查记录，不修改这些业务实现。

## P1-01：非斜杠输入被扩展接管后没有完成确认

位置：[ChannelService](../../apps/server/src/modules/channel/channel.service.ts) 的 `#confirmCommandCompletion()`，约第 277 行。

该方法只观察以 `/` 开头的 prompt。实际 Pi 也允许 `input` handler 返回 `action: handled`：普通输入被扩展直接处理后，仍会得到成功 prompt ACK，但不会启动 Agent 回合，也不产生 `agent_settled`。

这不是假设中的新扩展：当前 [knowledge/mode.ts](../../packages/agent/src/extensions/knowledge/extension/mode.ts) 在知识模式恢复失败时会处理输入并返回 `handled`；[background-task/events.ts](../../packages/agent/src/extensions/background-task/extension/events.ts) 在停止屏障关闭接收时也会这样做。

隔离真实 Pi Session，注册 `input → handled`，经生产 Channel 投递普通文本，结果为：

```json
{
  "calls": ["prompt"],
  "ack": { "type": "command.ack", "requestId": "ordinary", "sessionId": "s" },
  "agentEvents": [],
  "isStreaming": false
}
```

没有状态确认，也没有后续 Agent 终态可供前端收尾。修复应覆盖实际的输入处理结果，不再依靠斜杠前缀推断生命周期。

## P1-02：结束先于 ACK 到达时，待确认请求无法清理

位置：[reducer.ts](../../apps/web/src/stores/session/reducer.ts) 的 `agent_settled` 分支（约第 265 行），以及 [store.ts](../../apps/web/src/stores/session/store.ts) 的 `acknowledgeUserCommand()`（约第 354 行）。

`agent_settled` 只清理已经标记 `commandAcknowledged` 的本地请求；不含 completion 的迟到 ACK 只补上标记，不重新应用已经收到的终态。

生产 Store 最小复现：

1. 建立 `/generate` 的乐观请求。
2. 先送达 `agent_settled`。
3. 再调用不含 completion 的 ACK 处理。

结果：回合已经 `completed`，但 `pendingUserRequestIds` 仍含该请求。Composer 依据这个数组判断提交状态，因此仍可能显示提交中。

真实传输存在这种交错的入口：Pi 状态响应观察到 busy 后，结束事件可能在 Channel 发送 ACK 前到达；RPC 解码在同一批数据中同步转发事件，而 Promise 的后续 ACK 处理要稍后执行。现有只覆盖 ACK 先到的用例不足以排除该路径。

修复应让接受和终态证据可按身份汇合，对两种顺序得到相同结果，而不是再增加一种消息类型特判。

## P1-03：会话级结束事件误结束新请求并删除其关联

位置：[reducer.ts](../../apps/web/src/stores/session/reducer.ts) 的 `completeActiveTurn()` 调用，以及 [UserMessageRequestCorrelator](../../apps/server/src/modules/channel/channel.service.ts) 的 `agent_settled → #clearSession()` 分支（约第 854 行）。

两个位置都把“某次执行结束”扩展成了“当前会话中的全部或当前工作结束”：

- Web 无条件结束当前 `activeTurnId`，它可能已经是刚提交、尚未被接受的新请求。
- Server 无条件删除整个会话的 pending 关联，其中可能包含在旧执行结束前已经登记、但还没发出 user 消息的新请求。

生产实现最小复现：

1. Store 建立新请求，尚未收到其 ACK 或 user 消息；注入旧执行的 `agent_settled`。新回合立即变成 `completed`，`activeTurnId` 被清空，但新请求仍待确认。
2. Correlator 登记 `new-request`，收到旧执行的 `agent_settled`，再收到匹配正文的新 `message_start`；返回事件的 `requestId` 为 `null`（未关联）。

影响包括回合提前结束、后续消息关联丢失与乐观消息重复。修复应限定结束事件拥有的执行范围，保护未进入该执行的新请求；同一个 runtimeId/epoch 内也可能有多个执行，版本校验不能替代执行身份。

## P1-04：停止命令仍排在被停止操作后面

位置：[ChannelService.handleMessage()](../../apps/server/src/modules/channel/channel.service.ts)，约第 146 行。

当前仅 ping、focus 和 UI 回复绕过会话指令队列，`agent.abort`、`agent.abort-retry` 仍进入普通队列。长指令或压缩操作的 RPC 响应尚未返回时，停止请求无法到达已经具备停止协调能力的运行时。

生产 Channel 最小复现：让 prompt 的执行承诺保持等待，然后在同一连接发送 `agent.abort`。释放 prompt 前执行记录仅为 `["prompt"]`；释放之后才变成 `["prompt", "get_state", "abort"]`。

修复应按“能够解除等待的控制操作”设计调度，同时保留身份、权限与幂等校验。还应区分主模型取消和扩展自有任务取消，不能承诺一个 abort 能终止任意扩展 handler。

## 已核查的合理实现

- Goal/Plan 的专用投影器识别自身的 `customType` 并校验领域数据，未将它们当作通用任务结束信号；这些判断不应被机械删除。
- `stop-session.ts` 与 `stop-background.ts` 将 ACK 和资源终态分开，验证停止屏障、generation、revision、stopId 与活动数量；应保留这些证据检查。
- `awaitRealtimeCommand()` 的实际契约是等待确认。当前后台任务控制调用方还会复核权威快照，不能因为该 helper 等待 ACK 就直接认定它错误，也不能把它推广为通用“等待任务结束”。
- 前端有完成标记的 ACK 已做运行时版本校验，相关逻辑应保留；本次发现的是同一版本内的执行归属与到达顺序缺口。

## 尚需验证的恢复边界

`#confirmCommandCompletion()` 在状态观察失败时返回普通 ACK，避免误拒和重放的方向正确。但仅依赖已有恢复路径，是否能保证无输出指令最终离开 pending，尚缺少自动恢复的集成证据；应纳入故障恢复测试，不能宣称当前已经闭环。

## 验证与后续修复原则

- 复现使用生产 Store、构建后的 Channel/Correlator 和安装的 Pi SDK；真实 Pi 使用独立临时目录与内存模型存储，没有发送用户会话消息或修改用户记忆。
- 事件顺序问题通过确定性事件序列复现，未进行真实浏览器网络并发注入。
- 本轮未运行无关的全量测试，也未把先前的通过结果当作这些新路径已覆盖的证据。
- 修复优先明确请求与执行的关联契约，再调整队列和前端归并；回归保留这四条复现，并覆盖消息有无输出、ACK/终态反序、旧执行与新请求交错、交互等待时停止。
- 长期规则已归入《代码开发规范》5.4、7.2、7.3；此文件只记录本次审查结果，不承担长期规范职责。
