# settings-http-api-contract：概念验证与验收

架构设计：[原设计](../architecture/settings-http-api-contract.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

## 16. 验证矩阵

- 每个 endpoint 的 method、route、schema、status、body 和 header snapshot；
- Success 无 global data envelope；mutation 包含 outcome/warnings；
- Error details 闭集且兼容现有 handler；
- Same-key replay、payload conflict、TTL、capacity 和 restart 后安全重试；
- Secret answer 不进入 ledger、Query cache 或日志；
- 202 partial 不使用 error envelope、不自动 retry；
- If-Match missing/stale/success 与文件锁竞态；
- client disconnect 在 commit 前后结果确定；
- providerKey/modelKey 特殊字符、tamper 和跨 Provider 验证；
- cursor filter mismatch、signature invalid、snapshot stale 和 page boundary；
- CORS、body/count/deadline 和 5xx masking。
