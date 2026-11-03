# settings-local-model-providers：概念验证与验收

架构设计：[原设计](../architecture/settings-local-model-providers.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

## 17. 验证矩阵

### 17.1 URL 与网络

- root、`/v1`、path prefix、尾斜杠；
- userinfo/query/fragment 拒绝；
- IPv4/IPv6 loopback；
- private DNS、Docker/WSL hostname；
- public、link-local、metadata、multicast、reserved 拒绝；
- mixed DNS answers 全部验证；
- DNS rebinding 模拟；
- redirect 不跟随；
- outbound proxy 不使用；
- self-signed TLS 拒绝；
- connect/body timeout 和 AbortSignal。

### 17.2 Adapter

- Ollama valid/empty/malformed `/api/tags`；
- vLLM authenticated/unauthenticated `/v1/models`；
- vLLM health 200 但 models 401；
- LM Studio native v1 rich metadata；
- LM Studio native 404 后 OpenAI fallback；
- LM Studio native 401/500 不 fallback；
- duplicate、empty、overlong model IDs；
- body/model count limits；
- embedding filtering 和 unknown-kind warning。

### 17.3 配置与认证

- no-auth placeholder；
- API Key provider 先手工模型、后 Auth Session；
- credential-assisted re-detect；
- none/api_key 双向切换；
- orphan credential 提示但不自动删除；
- stale detection fingerprint；
- detected/manual model create；
- catalog diff 不自动删除 configured-only model；
- existing `octopus-ollama/vllm/lmstudio` migration。

### 17.4 集成

- Settings 与 Onboarding 调用同一 preset service；
- create 委托统一 models.json mutation 和 If-Match；
- candidate Pi Runtime 能加载生成配置；
- 当前 Agent Session 不变，新 Session 使用新 Provider；
- 探测不发送 completion，不产生模型推理费用。
