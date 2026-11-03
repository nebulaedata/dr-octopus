# settings-provider-auth-sessions：概念验证与验收

架构设计：[原设计](../architecture/settings-provider-auth-sessions.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

## 15. 验证矩阵

### 15.1 Agent SDK 契约

- API Key 单 prompt login；
- Provider-specific 多 prompt login；
- OAuth auth URL、device code、manual code；
- whole-session abort 传递到 Pi；
- prompt-level abort 只使当前输入失效；
- `CredentialSynchronizationError` 保留 committed credential 语义。

### 15.2 Server Manager

- 同 Provider 冲突、跨 Provider 并发；
- answer 与 prompt abort 竞态各自获胜；
- duplicate answer 幂等；
- stale prompt、错误 select option、超长 answer；
- active TTL、terminal TTL、shutdown；
- event ring buffer、文本和 URL 限制；
- task rejection 无泄漏、无 unhandled rejection。

### 15.3 HTTP

- 所有 endpoint 的 schema、状态码和错误 DTO；
- provider/session path 混淆返回 404；
- answer body 和 auth URL 不进入日志；
- cancelled/expired/committed-but-unsynced 的稳定响应；
- DELETE cancel 和 terminal cancel 幂等。

### 15.4 Web

- 轮询只在 Dialog 活跃且 session 未终止时运行；
- secret 不出现在 Query cache、mutation cache、URL、localStorage 和错误对象；
- prompt 变化或 abort 时表单 reset；
- auth URL 非法 scheme 不可点击；
- device code 复制、键盘焦点、Dialog 关闭取消；
- partial success 展示正确，不提供误导性“重新保存”。
