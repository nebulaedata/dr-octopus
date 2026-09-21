# ADR-0030: 使用受网络约束的 Preset Adapter 探测本地模型服务

## Status

Accepted

## Context

Settings 和 Onboarding 需要连接 Ollama、vLLM 与 LM Studio，发现模型并生成 Pi models.json Provider。三种服务虽然都可提供 OpenAI-compatible inference，但模型发现接口与元数据并不相同：Ollama 使用 `/api/tags`；vLLM 使用 `/v1/models`，且该路径可能受 API Key 保护；LM Studio 0.4+ 推荐 `/api/v1/models` 并提供 richer model metadata，同时保留 `/v1/models` compatibility endpoint。

现有 Onboarding 实现只验证 HTTP(S)，使用普通 fetch，并把 HTTP、DNS、TLS、timeout、认证和 response schema 错误都压缩为 `reachable=false`。Settings 允许用户输入 URL，因此该请求能力构成 SSRF 边界。vLLM 还常运行在 Docker、WSL 或局域网 GPU 主机上，不能简单限制为 loopback。

Pi custom Provider 必须具有 auth resolution。无认证本地服务需要非秘密 placeholder；API Key protected 服务则必须先形成最小 Provider，之后通过 Pi Auth Session 保存 credential。

## Decision

1. Ollama、vLLM 和 LM Studio 使用独立 typed preset adapter，复用统一受保护 HTTP transport。
2. Preset 只生成普通 models.json Provider，不持久化独立本地 Provider registry，也不写 Pi schema 外的 Octopus metadata。
3. 默认只允许 loopback；RFC1918/IPv6 ULA private network 需要每次显式确认；public、link-local、metadata、multicast 和 reserved target 始终拒绝。
4. DNS 解析结果在连接前验证并通过受控 lookup/dispatcher 固定；禁止 redirect、proxy、retry 和未验证的 DNS fallback。
5. 探测使用 connection/overall timeout、2 MiB body cap、1000 model cap 和全链路 AbortSignal。
6. Ollama 使用 `/api/tags`；vLLM 使用 `/v1/models`，`/health` 只辅助诊断；LM Studio 优先 `/api/v1/models`，仅在明确 404 时 fallback `/v1/models`。
7. 模型元数据保守导入：只有 Runtime 明确报告的能力才映射；不从模型名称猜测 reasoning、vision 或 context window。
8. 无认证模式写固定非秘密 placeholder；API Key 模式不写 models.json key，创建最小 Provider 后统一走 Pi Auth Session。
9. 探测只返回 transient catalog 和短 TTL signed fingerprint；创建和模型导入必须经过统一 models.json Mutation Service 与 If-Match。
10. 重新探测只生成差异预览，不自动添加或删除模型，不发送 completion。
11. Onboarding 迁移为同一 LocalProviderPresetService 的调用方，删除重复 URL、HTTP 和写入逻辑。

## Consequences

### Positive

- 三种 Runtime 的接口差异被限制在 adapter 内，模型服务领域不维护条件分支。
- 用户可以安全连接 loopback、Docker、WSL 和私有 GPU 主机。
- DNS rebinding、proxy 泄漏、redirect 跳转和 cloud metadata SSRF 有明确阻断点。
- API Key protected 本地服务复用 Pi credential 和 Auth Session，不增加秘密存储。
- LM Studio 可利用官方 native metadata，Ollama/vLLM 不会被不可靠名称推断污染。
- Settings 与 Onboarding 行为收敛。

### Negative

- 受控 DNS/dispatcher、TLS server name 和 IP 分类实现复杂，必须做平台测试。
- API Key protected 新 Provider 需要“手工 Model ID → 认证 → 重新探测”的多步骤流程。
- 无认证 placeholder 可能作为多余 Authorization header 发送，目标服务必须能够忽略；否则需要切换 API Key 模式。
- public remote vLLM 不能使用 local preset，需走普通自定义 Provider 流程。
- 保守模型导入会要求用户补充部分 capability 和 token limit。

### Neutral

- Preset 不负责启动 Runtime 或下载模型。
- 探测不是端到端 inference 健康检查。
- 已配置但探测时缺失的模型默认保留。

## Alternatives Considered

- **三种 Runtime 共用一个宽松 `/v1/models` adapter**：拒绝。Ollama native catalog 不同，LM Studio native API 提供更可靠能力，错误与 fallback 语义也不同。
- **只允许 loopback**：拒绝。无法覆盖 Docker、WSL、LM Studio LAN 和远程私有 GPU 主机。
- **允许任意 HTTP(S) URL**：拒绝。会把 Server 暴露为内部网络和 metadata SSRF 客户端。
- **使用系统 HTTP proxy**：拒绝。loopback/private endpoint 和模型信息可能泄漏给代理，代理也会改变地址校验语义。
- **允许 redirect 后重新探测**：拒绝。增加 SSRF 跳转和认证 header 泄漏风险。
- **在探测请求 body 直接提交 API Key**：拒绝。会创建第二条 secret transport，并与 Auth Session/Pi CredentialStore 分叉。
- **创建 Provider 与 credential 保存组成补偿事务**：拒绝。跨 models.json 和 CredentialStore 无法安全回滚，部分成功状态更复杂。
- **自动发送最小 completion 判断 chat 能力**：拒绝。可能加载大模型、消耗 GPU/配额并写第三方日志。
- **自动删除 catalog 中消失的模型**：拒绝。离线、JIT、权限或暂时 unload 都可能造成假缺失。
- **在 models.json 写 `x-octopus.preset`**：拒绝。会依赖 Pi 当前对 unknown fields 的宽松行为；稳定 ID 约定和显式请求已足够。

## Verification Requirements

1. 三个 adapter 用官方 fixture 验证 endpoint、fallback 和 schema mapping。
2. loopback/private scope 正常，public/link-local/metadata/reserved 全部拒绝。
3. mixed DNS、DNS rebinding、redirect、proxy 和 self-signed TLS 覆盖安全测试。
4. timeout、body cap、model cap、duplicate 和 abort 有确定结果且无资源泄漏。
5. vLLM health 200 + models 401 返回 auth required，不误报 available。
6. LM Studio 只有 native 404 才 fallback；401/5xx/invalid response 不掩盖。
7. no-auth placeholder 和 API Key Auth Session 两条流程均能由 Pi candidate Runtime 加载。
8. Secret 不经过 detection DTO/body，不进入日志或 fingerprint。
9. 重探测不 mutation，catalog diff 不自动删除配置。
10. Onboarding 与 Settings 使用同一 preset service 和 models.json repository。

## References

- [Settings 本地模型服务 Preset 与探测详细设计](../architecture/settings-local-model-providers.md)
- [Settings models.json Mutation 详细设计](../architecture/settings-model-config-mutations.md)
- [Settings 模型服务认证会话详细设计](../architecture/settings-provider-auth-sessions.md)
- [Ollama List models](https://docs.ollama.com/api/tags)
- [vLLM OpenAI-compatible Server](https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/)
- [LM Studio REST API](https://lmstudio.ai/docs/developer/rest)
- [LM Studio List Models](https://lmstudio.ai/docs/developer/rest/list)
