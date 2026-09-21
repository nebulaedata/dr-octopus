# ADR-0027: 使用 Pi ModelRuntime 统一模型服务与认证

## Status

Accepted

## Context

Settings 需要管理 Pi built-in、Extension-registered 和 models.json Provider，支持 API Key、OAuth、ambient credential、动态模型刷新和自定义 Provider 配置。

Pi Provider 拥有自己的认证能力。不同 Provider 的 API Key login 可能不只是一个 Secret 输入，还可能要求 Provider-scoped environment、账号、区域或其他字段。OAuth 可能产生 auth URL、device code、manual code 和异步 progress。

Pi `ModelRuntime.setRuntimeApiKey()` 只创建非持久进程内 override，不适合作为 Settings 保存入口。直接修改 `auth.json` 会绕过 Provider login、Credential Store 串行化、OAuth refresh 和 Runtime 快照同步。

## Decision

1. Pi `ModelRuntime` 是模型 Provider、Model、认证能力和可用性状态的唯一 Runtime 权威。
2. 持久认证统一使用 `ModelRuntime.login(providerId, type, interaction)`。
3. 移除持久认证统一使用 `ModelRuntime.logout(providerId)`。
4. Settings 不直接读写 `auth.json`，不使用 `setRuntimeApiKey()` 保存用户输入。
5. Web 通过 Host-owned Auth Session 适配 Pi `AuthInteraction.prompt()` 和 `notify()`；Auth Session 不实现 Provider-specific 认证规则。
6. Provider 的可见操作由 Provider 公共能力和配置 provenance 计算，不在 Web 中维护 Provider ID allowlist。
7. models.json 是用户 Provider 和 overlay 的配置事实来源；写入必须保留未知字段，并在写后调用 ModelRuntime refresh 验证组合结果。
8. Provider 列表使用 side-effect-free auth check；只有用户显式 verify/login 时才允许 OAuth refresh、命令解析或网络访问。
9. 动态模型刷新使用 `ModelRuntime.refresh()`，失败保留旧 catalog，不自动发起付费推理请求。

## Consequences

### Positive

- API Key、OAuth 和 Provider-specific 多步骤认证共用 Pi 原生逻辑。
- Credential Store 锁、OAuth refresh 和 Runtime snapshot synchronization 不被重复实现。
- Extension Provider 能自动暴露其认证和动态 catalog 能力。
- Settings、Onboarding 和 Agent Runtime 可以共享同一套模型服务语义。
- 凭证不需要经过额外的 Octopus 持久化层。

### Negative

- Web 需要设计通用 Auth Session transport 承接 Pi prompt/event。
- Credential 提交后 Runtime 同步失败是部分成功状态，不能使用普通事务成功/失败二分法。
- Provider 来源是组合层，DTO 和 UI 比单一 `kind` 更复杂。
- models.json 未公开给 UI 的复杂字段仍需做无损合并。

### Neutral

- Provider-specific credential 指引和 ambient 配置仍由 Pi Provider 决定。
- 第一阶段 verify 不发送真实模型 completion，因此不等价于端到端推理健康检查。

## Alternatives Considered

- **使用 `setRuntimeApiKey()` 保存 API Key**：拒绝。该 API 明确是非持久 Runtime override。
- **Server 直接写 `auth.json`**：拒绝。会绕过 Pi Credential Store、Provider login 和同步语义。
- **为每个 Provider 编写 Server 认证实现**：拒绝。会重复 Pi Provider 逻辑并持续漂移。
- **通过 Pi `/login` RPC 命令驱动 Web**：拒绝。Built-in interactive command 不是稳定的 Host API，且难以结构化管理 prompt 生命周期。
- **Provider 列表加载时调用 `getAuth()`**：拒绝。可能触发 OAuth refresh 或命令型 credential 解析，列表读取不应产生网络或命令副作用。
- **用一次真实 completion 验证 Provider**：不作为默认 verify。可能产生费用、写入第三方日志并消耗配额；未来只能作为明确的用户操作单独设计。

## Verification Requirements

1. API Key login 通过 Provider login 持久化，重建 ModelRuntime 后仍可读取配置状态。
2. `setRuntimeApiKey()` 不出现在 Settings 持久化路径。
3. OAuth 和多 prompt login 能通过同一 Auth Session transport 完成和取消。
4. logout 后 stored credential 消失，ambient credential 若仍存在必须正确显示为 configured。
5. `CredentialSynchronizationError` 返回 credential committed 的稳定部分成功语义。
6. Provider 列表读取不执行 command credential、不刷新 OAuth、不访问网络。
7. refresh 失败保留旧模型集合并返回 provider-scoped error。
8. models.json overlay 写入不丢失未公开字段，删除 overlay 能恢复底层 Provider。

## References

- [Settings 模型服务详细设计](../architecture/settings-model-providers.md)
- [Settings 模块架构设计](../architecture/settings-module.md)
- [Pi SDK](https://pi.dev/docs/latest/sdk)
- [Pi Providers](https://pi.dev/docs/latest/providers)
- [Pi Custom Providers](https://pi.dev/docs/latest/custom-provider)
