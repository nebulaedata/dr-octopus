# ADR-0019: Pi 权威化 Thinking Controls

## Status

Accepted

## Context

Web Composer 曾固定展示 Pi thinking level 的全集，并从 Session catalog 偏好读取当前值。模型实际只支持其中一部分，Pi 还会对不支持的输入进行 clamp。由于浏览器没有消费 clamp 后的结果，界面、数据库投影和 runtime 可能显示不同等级。

功能要求包括：选项随当前模型变化、切换后显示 Pi 实际采用的等级、模型切换后重新同步能力，以及页面恢复时不依赖过期 catalog 偏好。

## Decision

1. Pi runtime 是 thinking level 与 available levels 的唯一权威。
2. Session bootstrap 和 snapshot 通过 `get_state` 与 `get_available_thinking_levels` 返回统一的 `ThinkingStateDto`。
3. `set_model` 与 `set_thinking_level` 成功后，在同一个 runtime operation lease 内读回 thinking state，并随 `command.ack` 返回。
4. Server 只持久化 Pi 返回或 `thinking_level_changed` 事件携带的实际等级，不持久化未经确认的请求值。
5. Web Session store 消费 bootstrap、ACK 和 Pi event；`ThinkingSelect` 只渲染 store 中的 available levels。

## Consequences

### Positive

- UI、catalog 与 Pi runtime 收敛到同一实际等级。
- 不支持 reasoning 的模型只暴露 `off`，扩展等级由模型能力决定。
- 模型切换与 thinking 切换共享同一确认路径。

### Negative

- 两类控制命令成功后增加两次轻量 RPC 查询。
- Realtime ACK 合约增加可选 thinking 投影，旧客户端不会使用该字段。

### Neutral

- Pi 的 `thinking_level_changed` 事件仍用于处理 Extension 或其他非 Web 发起的变更。

## Alternatives Considered

- 在 Web 根据 `reasoning` 或 `thinkingLevelMap` 推导：拒绝，因为会复制 Pi clamp 规则并可能随版本漂移。
- 继续乐观更新 Session catalog：拒绝，因为请求值不等于模型实际采用值。
- 每次选择后重新加载完整 bootstrap：拒绝，因为成本更高，并且存在与实时命令完成时序竞争。

## References

- [ADR-0006](./0006-pi-web-semantic-parity.md)
- [ADR-0007](./0007-web-control-and-realtime-protocol.md)
- Pi RPC `get_available_thinking_levels` and `thinking_level_changed`
