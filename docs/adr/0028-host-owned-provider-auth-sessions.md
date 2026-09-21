# ADR-0028: 使用 Host-owned 短生命周期认证会话桥接 Pi Provider 登录

## Status

Accepted

## Context

Pi Provider 的登录不是统一的单字段 API Key 写入。`AuthInteraction` 可以产生 `text`、`secret`、`select` 和 `manual_code` prompt，以及 `info`、`auth_url`、`device_code` 和 `progress` event。OAuth callback 还可能通过 prompt-level signal 使当前 `manual_code` 输入失效，而整段登录继续执行。

Settings 是独立于 Workspace 和 Agent Session 的全局控制面。现有 Session WebSocket 绑定 Agent Session 生命周期；如果复用它承载 Provider 登录，会把全局配置错误地绑定到 Workspace/Session runtime。为认证单独引入 SSE 或新的双向 WebSocket，则会增加连接恢复、授权、清理和测试成本。

Web 使用 TanStack Query 管理 server state，但 mutation state 会保存 variables。把 secret answer 作为普通 mutation variables 会增加凭证残留在内存缓存和 Devtools 中的风险。

## Decision

1. Server 使用内存中的 Host-owned Auth Session，把 Pi `ModelRuntime.login()` 的 `AuthInteraction` 映射为 HTTP resource。
2. 协议使用 `POST create`、`GET poll`、`POST answer` 和 `DELETE cancel`；第一阶段不使用 Session WebSocket、SSE 或新的 realtime transport。
3. Auth Session 不持久化，与 Workspace、Agent Session 和浏览器路由解耦。
4. 同一 Provider 最多一个活动认证会话；login、logout 和 refresh 共享 Provider-scoped serialization，不同 Provider 可并发。
5. whole-session abort 取消整个登录；prompt-level abort 只废止当前 prompt。answer 与 abort 使用单一 settle guard。
6. secret 和其他 answer 通过专用直接 transport hook 提交，不作为 TanStack Query mutation variables，不进入任何 Query cache。
7. 活动会话默认 15 分钟过期，终态默认保留 5 分钟；事件、文本、options 和 answer 都有明确容量上限。
8. `CredentialSynchronizationError` 是 `committed_but_unsynced` 终态，表示 credential 已经提交，不提供误导性的安全重试动作。
9. 第三方 Provider 的 event 和 prompt 内容按不可信数据处理，只渲染纯文本，并限制 URL scheme 为 HTTP/HTTPS。
10. Credential delete 成功返回带 `outcome/warnings/effect` 的 `200` JSON response；当它使全局默认模型暂时不可用时必须返回 fallback 影响警告，不使用无法承载警告的 `204`。

## Consequences

### Positive

- 完整保留 Pi Provider-owned API Key、OAuth 和多 prompt 登录语义。
- 全局 Settings 不依赖 Agent Session 是否存在或正在运行。
- HTTP polling 易于在现有 Fastify/TanStack Query 架构中测试和运维。
- Prompt-level cancellation、TTL 和 Server shutdown 有清晰所有者。
- Secret 不进入 Query/mutation cache，降低浏览器内存与 Devtools 泄漏面。

### Negative

- 本地页面在活动登录期间会产生短间隔轮询请求。
- Server 重启会丢失未完成会话，用户需要重新发起登录。
- Manager 需要正确实现 answer、prompt abort、session abort 和 TTL 的竞态。
- 页面刷新后第一阶段不会自动恢复原 Dialog，即使 Server session 仍在 TTL 内。

### Neutral

- Credential 持久化仍完全由 Pi CredentialStore 负责。
- Auth Session 只保存交互快照，不是审计日志或工作流引擎。
- 未来如有跨网络部署需求，可以在保持状态机和 DTO 语义的前提下评估 SSE，但不是第一阶段要求。

## Alternatives Considered

- **复用 Agent Session WebSocket**：拒绝。其生命周期和权限语义绑定 Workspace/Session，违反 Settings 全局边界。
- **新增认证 WebSocket**：拒绝。双向通信自然，但增加连接鉴权、断线恢复和资源回收复杂度，当前本地控制面没有必要。
- **使用 SSE 推送事件，HTTP 回答 prompt**：暂不采用。相比条件轮询只减少少量本地请求，却引入新的长连接生命周期；未来可在实际性能证据出现后重评。
- **一个同步 HTTP 请求等待完整登录**：拒绝。OAuth/device flow 时间长，且无法自然承载多 prompt、取消和浏览器断连。
- **持久化 Auth Session**：拒绝。会扩大 secret 和 OAuth 中间态的攻击面，同时无法在 Server 重启后安全恢复 Pi 内存 Promise。
- **普通 TanStack Query mutation 提交 secret**：拒绝。mutation variables 会被 mutation cache 持有，违背 write-only secret 约束。
- **前端直接调用 Provider OAuth/API Key 接口**：拒绝。会复制 Pi Provider 规则，并绕过 CredentialStore 与 Runtime synchronization。

## Verification Requirements

1. API Key、OAuth、device code、manual code 和多 prompt Provider 使用同一协议完成。
2. prompt-level abort 不会取消整个 session，过期 prompt 的 answer 返回稳定冲突。
3. whole-session cancel、TTL 和 Server shutdown 都向 Pi 传播 AbortSignal。
4. 同 Provider 并发被拒绝，不同 Provider 可同时运行。
5. secret answer 不出现在 Query cache、mutation cache、日志、telemetry、URL 或 DTO。
6. 非 HTTP/HTTPS event link 不可点击，Provider 文本不作为 HTML 渲染。
7. `CredentialSynchronizationError` 返回 `committed_but_unsynced`，UI 不建议重复登录。
8. 终态 TTL 后 session 和 resolver 引用全部释放，无 unhandled rejection。

## References

- [Settings 模型服务认证会话详细设计](../architecture/settings-provider-auth-sessions.md)
- [Settings 模型服务详细设计](../architecture/settings-model-providers.md)
- [ADR-0027](./0027-pi-model-runtime-authoritative-provider-management.md)
