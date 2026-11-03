# ADR-0092：增量扩展自研录制器的文档范围

## Status

Proposed · 2026-11-03。用户要求精简开发计划；本次以“单层同源 iframe”替换原通用生产者与独立回执方案。继续自研录制器、PageController 执行层不变已确定，具体设计待审阅；未实施或验收。

## Context

当前录制器只监听顶层，但已具备脱敏、批次 ACK、事务提交和停止收尾。主要缺口是文档范围：每 Tab 只有一份文档与批次状态，不能直接放开 iframe 来源。

原计划同时建设生产者协议、独立回执库、覆盖时间轴并加强事件语义，超出首期需要。用户要求以较小改动指导录制开发，暂不写代码。

## Decision

1. 首期支持单层同源、活动 HTTP/HTTPS iframe；跨域、嵌套及特殊文档延后。
2. 保持顶层静态注入，子文档按需注入固定 ISOLATED 录制脚本，复用 DOMRecorder 与传输；只有顶层有浮条，子文档不创建 Controller。
3. 以现有 sessionId/epoch 和浏览器 tabId/frameId/documentId 管理身份；将现有文档登记、批次游标和收尾扩展到 document，不另设 producerId 或独立状态机。
4. 在现有 sessions/events 内事务提交事实与游标，复用重试、限额和异常恢复策略；不新建回执 store、不强制升库。
5. 使用现有 gaps/Alert 区别范围限制和保存失败，不建设覆盖时间轴；导航、旧消息、引用隔离、隐私和 Chrome/Edge 验收仍是必须项。
6. 执行层、Native 协议与重放能力保持不变；不把事件语义全面改造捆绑为本轮前置条件。

## Alternatives

| 备选                               | 取舍                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------- |
| 只改 allFrames 并移除来源限制      | 缺少逐文档准入、游标和生命周期，不能采用                                  |
| 顶层直接监听子 document            | 入口更少，但文档卸载/重新挂载仍要管理；按文档独立采集便于复用现有生命周期 |
| 通用生产者平台、摘要回执和覆盖区间 | 首期没有足够收益，移出本轮计划；发现真实缺陷时再局部设计                  |
| rrweb/Playwright CRX 整体接入      | 用户选择继续自研；只参考所需规则与测试场景                                |

## Consequences

改动集中在文档登记、子文档采集和现有机制的范围扩展。仍需承担导航竞态、尾部缺口和双浏览器回归，不能保证注入前或文档销毁时零丢失。范围限制通过提示明确，后续跨域能力不自动获得授权。

## References

- [详细开发设计](../architecture/browser-recorder-reliability.md)
- [测试计划及状态](../poc/browser-recorder-reliability-validation.md)
- [原录制边界 ADR-0086](0086-browser-extension-recording-and-local-replay.md)
- [PageController 执行边界 ADR-0089](0089-browser-skill-unified-agent.md)
