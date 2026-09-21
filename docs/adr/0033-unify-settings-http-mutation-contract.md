# ADR-0033: 统一 Settings HTTP Mutation、幂等与部分成功契约

## Status

Accepted

## Context

Settings 同时包含 models.json 原子 mutation、Pi settings.json 更新、Provider 网络命令、Auth Session、credential commit 和 Extension filter。Models Repository 可以锁内检查 revision，Pi SettingsManager 没有公开 CAS，认证又包含长生命周期交互。

现有 Server 已有 `ApplicationError` 投影和进程内 `MutationIdempotencyLedger`。各详细设计分别定义过 202、If-Match、重复 answer 和幂等，但尚无一致的 header、response、retry 和 commit-point 契约。Model ID 还可能包含 `/`，不适合直接作为 path parameter。

## Decision

1. Success 不增加 global data envelope；mutation 统一包含 outcome/warnings/effect。
2. Error 沿用 code/message/requestId/retryable，增加闭集 safe details。
3. Canonical 状态已提交但 snapshot 未同步时返回 `202 committed_but_unsynced` success，不使用 error envelope、不自动重试。
4. 除 secret Auth Prompt answer 外，所有 Settings mutation 必须携带 Idempotency-Key，复用现有 15 分钟、10,000 entry 的 ledger。
5. Secret answer 使用 authSessionId/promptId 领域幂等，不 fingerprint 或缓存 answer。
6. Ledger 只是 retry 优化；Server 重启后仍依靠稳定 ID、显式 mode、If-Match 和后置条件保证安全。
7. 只有 models.json mutation 使用 ETag/If-Match；default model 和 Extension 不声明 SettingsManager 无法保证的 CAS。
8. Provider/Model DTO 返回基于完整 SHA-256 digest 的版本化、确定性 opaque API key；routes 使用 providerKey/modelKey，同时保留领域 ID，Server 不维护第二份 key map。
9. Settings response 使用 no-store 和 X-Request-Id；replay 用 header 标识。
10. AbortSignal 传播到下游；进入 canonical commit 后必须取得稳定结果，不能报告 cancelled。
11. Models、global settings 和 Provider auth 使用分离 queue；文件锁内不等待网络或 Web prompt。
12. 5xx、secret、URL、绝对路径和 Pi 原始错误遵循现有安全投影。
13. 需要表达 warning 或 effect 的成功操作必须返回 JSON；credential delete 固定返回 `200` mutation response，不使用 `204`。Auth Session 过期统一返回 `410` error envelope，不与资源 snapshot 混用。

## Consequences

### Positive

- 三个 Settings 模块具有一致的 retry 和错误处理方式。
- 网络断连后的重复 mutation 可以 single-flight 或重放。
- 部分成功不再诱导 UI 重复执行已提交操作。
- models.json 保留强 revision，同时不对 SettingsManager 做虚假保证。
- 特殊 Provider/Model ID 不影响 route parsing。
- 复用现有 Server 基础设施。

### Negative

- Web 必须为 mutation 生成并在 retry 中复用 Idempotency-Key。
- 进程内 ledger 无法跨 Server restart 重放原响应。
- DTO 同时维护 opaque key 与领域 ID。
- ApplicationError/PublicError 需要支持 optional safe details。
- default/Extension 跨进程同字段写仍是 last-writer-wins。

### Neutral

- GET 不需要 Idempotency-Key。
- Auth answer 保留 prompt-level 重复提交语义。
- 204 只用于没有 outcome/effect 的成功操作。

## Alternatives Considered

- **全局 `{data,error,meta}` envelope**：拒绝。与现有 Server direct response 风格不一致。
- **只依赖 HTTP method 幂等性**：拒绝。无法解决 commit 后断连、POST command 和 async single-flight。
- **Secret answer 进入通用 ledger**：拒绝。会扩大 secret 生命周期。
- **所有 mutation 使用 ETag**：拒绝。SettingsManager 没有公开原子 CAS。
- **所有并发 last-writer-wins**：拒绝。models.json 已能提供强 stale detection。
- **部分成功返回 5xx**：拒绝。会诱导 retry 已提交 mutation。
- **Model ID 直接作为 path segment**：拒绝。ID 可以包含 slash 等保留字符。
- **持久化 idempotency 数据库**：延期。本地控制面规模不需要额外存储。
- **客户端任意指定 deadline**：拒绝。会造成无界资源占用。

## Verification Requirements

1. 所有 mutation 明确 Idempotency-Key/If-Match 要求。
2. Same-key replay、conflict、TTL、capacity 和 restart 后安全重试有测试。
3. Secret answer 不进入 ledger、Query cache、日志或 details。
4. 202 partial 不使用 error envelope且不自动 retry。
5. Models stale revision 锁内检测；SettingsManager endpoint 不声称 CAS。
6. providerKey/modelKey 支持特殊字符并阻止跨资源替换。
7. Request abort 在 commit 前后产生确定结果。
8. Global handler 对 safe details、5xx masking 和 requestId 有 contract test。
9. Response header、cursor 和 body limit 有 transport test。
10. Controller 不包含 Pi 领域逻辑。

## References

- [Settings HTTP API 统一契约](../architecture/settings-http-api-contract.md)
- [Settings 模块架构设计](../architecture/settings-module.md)
- [Settings models.json Mutation 详细设计](../architecture/settings-model-config-mutations.md)
- [Settings 模型服务认证会话详细设计](../architecture/settings-provider-auth-sessions.md)
