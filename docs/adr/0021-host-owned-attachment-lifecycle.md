# ADR-0021: Host 持有附件生命周期并在消息边界适配给 Pi

## Status

Accepted

## Context

当前附件以 JSON Base64 上传到 Server 内存，发送 Prompt 时图片进入 Pi RPC `images`，其他文件按 UTF-8
拼入文本，然后立即从内存删除。该实现适合原型，但无法提供持久回显、失败重试、流式上传、安全处理、
大文件治理和不同模型/文件类型的能力适配。

Pi `0.84.3` 的公开 RPC 与 `UserMessage` 契约只支持 text/image，不存在通用 file content。与此同时，
Dr.Octopus 需要保留 Pi Session 作为 Agent 对话权威，并保持一个 Session runtime 一个隔离进程的现有架构。

## Decision

1. 附件是 Host 持有的 Workspace 资源。默认且完整的生产部署只依赖 SQLite 与应用受管的
   `LocalFileBlobStore`：SQLite 保存元数据、状态、操作日志、本地任务、派生索引和消息关联；本地文件系统保存
   原件及大派生物。S3/MinIO、PostgreSQL、Redis、外部队列和向量数据库都不是核心依赖。
2. 浏览器通过 Fastify 二进制流式/断点续传端点上传；HTTP JSON、WebSocket 与 Pi JSONL 不传原始大文件，
   浏览器也不接触本地绝对路径或预签名对象 URL。
3. Prompt 只携带附件 ID。Host 在提交时冻结附件清单，并在 Pi 用户消息获得 `entryId` 后幂等写入
   `message_attachments`；附件不再采用一次性 `consume` 语义。
4. Host 的 `AgentAttachmentAdapter` 根据模型能力和文件类型生成 Pi 支持的 text/image：
   受限图片派生物走 `images`，其他文件通过受限文本抽取、Workspace materialization、文档派生或检索提供；
   扫描型 PDF 只按需渲染页图，不运行本地 OCR。
5. Conversation 以 Pi 消息为对话权威，以 Host `message_attachments` 为附件展示权威；snapshot 和实时投影按
   `entryId/requestId` 合并。预览和下载使用 Host 鉴权 streaming endpoint，不在消息中保存 Blob 字节或本地路径。
6. 原件不可变且不因传输优化被覆盖。只为 JPEG/PNG/WebP 和受限 PDF 页图生成模型派生物。白名单音视频不预处理，
   只交付标记 `contentAvailableToModel: false` 的 manifest；模型只能决定下一步，不能声称已经理解媒体内容。
7. 能力分类器与安全策略矩阵实现为独立、可复用的 `attachment-capability` lib。第一阶段位于
   `apps/server/src/lib/attachment-capability/`；它只接受显式 evidence、部署能力、Agent 能力和有效策略，
   确定性输出四类 capability、处理计划、允许的交付方式、硬限制和稳定诊断。
8. 该 lib 不依赖 Fastify、数据库、Blob、Sharp/PDF、Pi SDK 或供应商 SDK，不执行 I/O。
   出现第二个实际消费者时才无行为变化地提取为 `packages/attachment-capability/`；不得放入 `packages/shared`。
9. SQLite 与文件系统使用持久 operation journal、staging、流式 checksum、`fsync`、同卷原子重命名和启动对账
   达成可恢复一致性。大附件原件不进入 SQLite BLOB；任何中间状态都必须可重放或可安全清理。
10. 可预处理大文件默认生成结构化派生物与 manifest，由 Agent 按页/sheet/section/range 读取；内嵌搜索使用
    SQLite FTS5。向量化不是前置条件，`VectorRetriever` 只允许未来经独立 ADR 作为可选 Adapter 引入。
11. 产品不提供病毒特征扫描，改用不可放宽的固定格式准入：扩展名、检测 MIME、magic bytes 与容器结构必须一致。
    默认只接受 JPEG/PNG/WebP、PDF、DOCX/XLSX/PPTX、固定 UTF-8 文本/源码和 manifest-only 音视频；归档、SVG/GIF、
    HTML/XML、宏/旧 Office、可执行文件和未知格式拒绝。该策略只能收缩攻击面，不能表述为病毒扫描或无恶意内容保证。
12. 上传采用 tus 1.0：`@tus/server` 使用项目自有 SQLite + staging datastore，Web 使用 `tus-js-client`；
    `@tus/file-store` 不成为附件权威。应用仍通过 operation journal 和幂等 finalize 完成原子发布。
13. capability 契约不为尚未实现的媒体派生能力保留不可达类别。未来新增音频转录、视频关键帧等能力时，
    必须按实际派生产物增加语义明确的类别和 processor capability、升级规则版本，并通过独立 ADR 评审。
14. Web 将附件 UI 分为两个阶段：Composer Input 上方使用 shadcn `AttachmentGroup` 展示
    `uploading/processing/ready/failed/rejected/deleted` 任务卡片并执行提交门禁；Conversation 只消费 Host 冻结的
    `presentationKind`，以图片、音频、视频、普通文件四种 `Attachment` 卡片稳定回显。图片使用 Dialog 预览，
    音视频通过 Host 鉴权 Range endpoint 使用浏览器原生控件播放；浏览器播放不改变 Pi 的 manifest-only 语义。
15. V1 实施契约进一步冻结：tus progress + TanStack Query revision polling 的状态同步；统一 REST/tus DTO 和错误码；
    SQLite foreign key/CHECK/CAS、job lease 与 operation journal；一次一任务 Node child processor 和版本化 artifact Schema；
    音视频 DTO 不含服务端 duration/poster；默认配额、磁盘水位、保留、备份以及 RPO 24 小时/RTO 4 小时。

完整设计见 [企业级附件—智能体架构](../architecture/attachment-agent-system.md)。

## Consequences

### Positive

- 上传、处理、Prompt、Conversation 和模型提供商之间形成清晰且可替换的边界。
- 大文件不会线性占用 Server 堆或突破 WebSocket/RPC 帧限制。
- 失败、重试、断线、刷新、会话恢复和审计都有持久身份与幂等落点。
- 不修改 Pi 私有协议，Pi 升级和多 provider 兼容风险较低。
- 可以逐步增加文档解析、页图渲染、检索、DLP 和租户治理，不污染 Channel 或 UI。
- 分类和安全策略可以独立测试、版本化、审计并被后续 Host 复用。
- 四类结果都对应当前真实行为，避免不可达枚举让调用方误判产品已经具备媒体派生能力。
- Composer 任务状态与历史 Message 展示状态解耦，刷新、重连和处理失败不会产生含混的消息卡片。
- 音视频无需引入 FFmpeg 即可供用户播放，同时继续准确表达模型没有读取媒体内容。
- REST、SQLite、Worker、UI 和运维参数拥有同一规范性契约，可据此拆分任务并编写跨模块契约测试。
- 不打包 ClamAV、OCR、FFmpeg 或模型资产，离线安装体积、内存和升级链路显著简化。

### Negative

- 增加本地 BlobStore、后台处理器、状态机、操作对账、清理任务和消息合并的实现复杂度。
- 图片发送给 Pi 仍需在受限边界内 Base64 编码，Pi Session 也会持久化图片派生物。
- PDF/Office 不能依赖 Pi 原生 file 输入，需要 Host 维护派生和工具路径；音视频只提供 manifest，能力明确受限。
- Conversation 由 Pi 历史与 Host 元数据组合，备份和删除策略必须一致覆盖 Pi 数据、SQLite 与附件目录。
- 上传完成和 Prompt 提交需要分别求值；策略、模型或工具变化会带来显式的二次决策成本。
- 单机磁盘容量、IOPS 与本地 worker 吞吐构成明确上限，系统必须通过磁盘水位、配额和背压治理。
- 固定格式准入不能识别格式合法文件中的恶意载荷；安全性依赖及时更新解析器、严格结构探测、资源隔离和禁止执行。
- 浏览器 codec 支持存在平台差异，受支持格式仍可能无法内联播放，必须保留失败降级和下载路径。
- `synchronous=FULL`、最终校验、一次一任务子进程和本地备份会增加 I/O 与处理延迟，以换取可恢复性和独立部署。

### Neutral

- `BlobStore` 与 retrieval 仍保留端口以便测试和未来扩展，但默认实现不得因未配置远程服务而降级核心能力。
- 附件可以被多条消息引用，删除采用墓碑和异步物理清理，而非关系级联立即删字节。

## Alternatives Considered

### A1: 继续 Base64 + 内存一次性暂存

拒绝。实现简单，但复制开销、进程崩溃丢失、刷新不回显、100 MiB 与 8 MiB RPC 帧冲突均无法通过局部补丁解决。

### A2: 扩展 Pi RPC，增加通用 `files` 字段

拒绝。Pi 公共消息模型没有对应语义，各 provider 的文件 API也不一致；这会形成长期维护的私有 fork，且没有解决
Blob 生命周期、格式准入、授权和 Conversation 投影问题。

### A3: 所有非图片文件都抽取全文并拼入 Prompt

拒绝。二进制会损坏，大文档成本不可控，嵌入图表丢失，还扩大 Prompt Injection 与敏感数据外发范围。

### A4: 所有附件都复制进 Workspace 并只让 Agent 用文件工具读取

部分采用，但不作为唯一方案。它对 coding agent 和大文件很自然，却会降低图片模型的直接视觉体验，也需要处理
可丢弃物化、清理、路径隔离和远程 Workspace。最终采用按能力适配的混合方案。

### A5: 直接复用某个模型供应商的 Files API

拒绝作为领域模型。供应商 file ID 可作为 Adapter 私有缓存，但不能成为 Conversation 的附件身份，否则 provider
切换、数据驻留、删除、离线运行和多模型会被外部生命周期锁定。

### A6: 将分类和安全判断内嵌在 AttachmentsService 或 AgentAttachmentAdapter

拒绝。内嵌会让上传状态机、处理器选择、模型适配和安全规则相互耦合，难以独立测试和供其他 Host 复用，
也容易在不同调用路径中产生不一致的放行结果。采用纯 `attachment-capability` lib 作为唯一决策入口。

### A7: 生产默认使用 S3/MinIO、PostgreSQL 或外部任务队列

拒绝。该方案有成熟的横向扩展能力，但会让 Agent 的安装、恢复和离线使用依赖额外基础设施，违反完全独立部署约束。
远程实现只能在未来作为显式可选 Adapter，不能进入核心启动、readiness、备份恢复或验收路径。

### A8: 把附件原始字节全部写入 SQLite BLOB

拒绝。SQLite 适合状态、关系、任务与文本索引，但 100 MiB 级 BLOB 会放大事务、WAL、备份和 vacuum 成本，
也不利于 Range streaming、媒体预览及 Agent 文件工具读取。采用 SQLite 管控制面、本地 BlobStore 管数据面。

### A9: 所有可预处理大文件强制向量化

拒绝。单文档或少量附件可通过结构化 manifest、按需读取和 SQLite FTS5 获得稳定、可定位的上下文；强制 embedding
会引入模型、索引迁移、资源消耗与外部依赖。仅在长期跨大规模语料的语义检索需求被验证后评审可选 Adapter。

### A10: 内置本地 OCR、音视频预处理与病毒扫描

拒绝作为默认基线。本地 OCR 与多模态模型能力重复，FFmpeg/转录链路扩大二进制和模型资产，ClamAV 引擎与病毒库
显著增加发行体积、常驻内存和离线更新负担。扫描型 PDF 改为按需页图交给 vision 模型；音视频只发 manifest；
安全边界改为严格固定格式准入、结构验证、资源隔离和禁止执行，并明确不提供病毒检测保证。

## References

- [企业级附件—智能体架构](../architecture/attachment-agent-system.md)
- [Attachment Capability Lib 设计](../architecture/attachment-capability-lib.md)
- [附件系统实施契约 V1](../architecture/attachment-implementation-contracts.md)
- [ADR-0001: Pi RPC Host 架构](./0001-pi-rpc-host-architecture.md)
- [ADR-0007: Web 控制与实时协议](./0007-web-control-and-realtime-protocol.md)
- [OpenAI File inputs](https://developers.openai.com/api/docs/guides/file-inputs)
- [Claude Code Desktop](https://code.claude.com/docs/en/desktop#add-files-and-context-to-prompts)
- [SQLite Write-Ahead Logging](https://sqlite.org/wal.html)
- [SQLite FTS5 Extension](https://sqlite.org/fts5.html)
