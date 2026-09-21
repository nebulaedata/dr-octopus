# ADR-0063: 显式区分知识写权限与本地模型调用权限

## Status

Accepted

## Context

Knowledge daemon 原先使用 `globalWrite` 同时表示全局知识写权限和本地独立模型调用资格。只读子代理必须设置 `globalWrite: false`，因此即使父会话已授权 `ocr_image`、`embed_text` 或 `rerank_documents`，daemon 仍会在推理前返回 `FORBIDDEN`。把子代理改成 `globalWrite: true` 会连带扩大知识库写权限。

## Decision

- `KnowledgeContext` 新增必填的 `modelAccess: 'none' | 'invoke' | 'manage'`。`globalWrite` 仅负责知识库全局写入、共享与连接管理，不再参与独立模型授权。
- `models.ocr`、`models.embed`、`models.rerank` 要求 `modelAccess` 为 `invoke` 或 `manage`。`principal` 仅用于审计，不参与授权；能力由持有 daemon 控制凭证的可信适配器固定。
- `settings.get`、`settings.save`、`settings.probe` 只接受 `modelAccess: manage`。
- 主 Agent 使用 `globalWrite: true, modelAccess: invoke`；受父权限快照约束的子 Agent 使用 `globalWrite: false, modelAccess: invoke`；Web 知识管理使用 `manage`；Knowledge MCP 使用 `none`。
- `modelAccess` 由可信适配器固定在客户端构造参数中，不来自模型工具输入。父会话的工具权限名单、模式和参数级路径检查仍先于 daemon 能力检查。
- 产品仅支持当前协议，不进行历史版本能力协商或兼容回退；请求缺少 `modelAccess` 时协议校验失败关闭。
- 子客户端继续使用 `autostart: false`，因此获得模型调用能力不会获得 daemon 生命周期所有权。

## Alternatives

- 将子代理的 `globalWrite` 改为 `true`：会同时授予全局知识写权限，违反最小权限原则。
- 仅检查 `principal.startsWith('agent:')`：主体字符串用于审计，不能表达调用、管理和写入三种不同能力。
- 为每个模型工具创建独立 daemon：隔离更强，但重复凭证、生命周期和存储管理，当前没有必要。

## Consequences

子代理可在保持知识只读的同时调用 OCR、Embedding 和 Rerank；MCP 无法借用本地模型凭证，子代理也无法修改模型设置。测试必须经过真实 `createKnowledgeApplication` 授权边界，HTTP 桩只能验证传输，不能代替 daemon 授权结果。
