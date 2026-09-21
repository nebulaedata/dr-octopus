# ADR-0045: 内置知识库与普通 Session 问答模式

## Status

Accepted，2026-09-10。用户确认取消此前的隔离 QA Session，采用本修订。

## Context

知识库服务 CLI/RPC 多个 Host；需要全局/工作区范围、Office/文本/PDF/OCR/递归压缩包导入、管理 UI 与本产品实例间双向 MCP。设计以轻量、高内聚和低耦合为目标。

## Decision

1. Agent 内置 knowledge 扩展通过轻客户端连接共享后台；按 canonical AgentDir 的父级数据根和 OS 用户单例，知识库默认存放于 `~/.dr-octopus/knowledge/`，数据库和原生依赖只在后台加载。沿用 Scheduler 风格 start/stop/restart/status/health 和 apps/cli 转发。
2. LanceDB 保存分块/向量/全文索引，后台自有 SQLite 保存目录、配置和任务；LangChain TS 用于切分与模型适配，不增加通用编排框架。
3. OCR、Embedding、Reranker 在 Settings → 知识库分别配置，无需 API Key 的模型连接不强制填密钥；重建和执行保存必要快照。
4. MCP 仅适配 Dr.Octopus 知识协议：本地全局集合可只读发布，远端集合挂载到统一列表，不复制索引、不再转发远端挂载。
5. 知识问答是普通 Session 模式。Agent 拥有模式、集合、工具、提示词和内置 Skill，回答模型由普通 Session 统一管理；Server 复用原 RPC 进程，只转发控制和投影状态，Web 复用同一 Composer、历史、附件和通知。
6. Plan 与知识模式通过既有工作流互斥协议协调。切换仅在 idle 且无队列时执行；退出恢复原模型和工具，不更改权限模式。其他扩展保持加载，此模式不等价于安全沙箱。
7. 默认自动匹配可见集合；指定集合在工具层限制。问答以工具证据为准，模糊时直接反问用户，明确保存请求可调用知识写入工具。Skill 随模式加载，不要求开放 read/bash。
8. 删除独立 QA runtime、协议、页面与草稿。历史 JSONL 和实验数据库表只归档保留，新请求不再写入。前端用 shadcn 组合来源与引用交互。
9. 维持已批准轻量化：普通分页、每类一个当前模型配置、重跑未完成叶文档、无阶段 checkpoint/租约心跳、停服排他备份；保留索引版本、幂等与取消。

## Consequences

保留一个共享后台，取消第二套问答生命周期和模型运行时。模式控制对原会话链路的变更集中于 Agent extension、已有控制转发及模式投影；管理、解析、索引和 MCP 不依赖 Session。

需要验证同会话切换、互斥、模型失败与恢复、分支恢复、集合边界、普通流程回归，以及来源/引用 UI。历史实验表后续只有在明确数据迁移或删除要求下才清理。

## References

[领域框架](../architecture/knowledge-base.md)、[Session 模式](../architecture/knowledge-session-mode.md)、[MCP/Web](../architecture/knowledge-mcp-and-web.md)、[实施记录](../architecture/knowledge-implementation.md)。
