# settings-model-providers：概念验证与验收

架构设计：[原设计](../architecture/settings-model-providers.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

## 14. 验证矩阵

### 14.1 Provider composition

- pure built-in；
- built-in + models.json overlay；
- pure models.json；
- Extension Provider；
- Extension Provider + models.json overlay；
- composition error fallback。

### 14.2 Authentication

- generic API Key login；
- Provider-specific multi-prompt API Key login；
- OAuth auth URL；
- device code；
- manual code；
- prompt cancellation；
- logout；
- ambient-only Provider；
- `CredentialSynchronizationError` partial commit。

### 14.3 Configuration

- endpoint overlay and reset；
- custom Provider create/update/delete；
- unknown fields preserved；
- malformed models.json rejected without overwrite；
- concurrent mutation conflict；
- local Provider preset validation。

### 14.4 Catalog

- static catalog；
- dynamic cached catalog；
- successful network refresh；
- timeout/abort；
- refresh failure retains previous models；
- credential-dependent model filtering。

### 验证

覆盖所有接受的 Completions 模板与原厂 Pi 请求体一致、自动与手动来源、逐模型协议继承、恢复自动匹配、当前目录重建、重复刷新、别名保持实际请求 ID、本地未知模型以及旧能力编辑接口失效。生图配置和请求使用隔离目录与模拟上游，不调用真实收费接口。
