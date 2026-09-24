# 知识库 MCP、HTTP 与管理页面契约

> 状态：Accepted；当前实现差异见[实施记录](knowledge-implementation.md)。日期：2026-09-10。作者：Codex。  
> 关联：[领域框架](./knowledge-base.md)、[会话问答模式](./knowledge-session-mode.md)。

## 1. 双向 MCP 的准确含义

按用户确认，远端挂载仅支持其他 Dr.Octopus 实例提供的知识库 MCP，统一使用本系统的 `octopus-knowledge/v1` 应用契约。远端集合并入本地全局列表，原文与索引仍由对端管理；不设计第三方知识库、通用 MCP 工具映射或 REST 接入适配器。

对外共享仍保留：其他智能体可通过标准 MCP 客户端调用本系统发布的知识库工具，无需为这些客户端单独开发接口。自动挂载与统一集合列表是 Dr.Octopus 自身的行为，不要求外部客户端采用相同 UI。

### 1.1 出口与挂载分开管理

| 能力           | 所有者与配置                                             | 生命周期                                             |
| -------------- | -------------------------------------------------------- | ---------------------------------------------------- |
| 入站出口       | Settings → 知识库 → 对外服务；本地只读发布策略及 token   | Gateway/Server 承载 `/mcp/knowledge`；关闭即拒绝请求 |
| 远端连接配置   | 已有 Settings → MCP 服务器，Pi MCP 配置为权威            | 不改写已有普通 Agent MCP 运行时语义                  |
| 远端知识库挂载 | Knowledge Service 保存 connectionRef、契约版本与挂载状态 | 独立只读连接池，按需连接，与普通 Pi MCP 扩展实例分离 |

出站配置当前只影响新建 Agent Runtime，知识库挂载则读取已保存配置 revision 后主动重新连接；UI 必须分别显示影响范围。挂载复用 `pi-mcp-adapter/config` 的有效配置解析与来源信息，不复制另一份 token/URL 到 mount 表。只解析全局配置，禁止受工作区文件覆盖。

挂载固定使用 Streamable HTTP 与对端 Dr.Octopus 签发的 Bearer token。Settings → 知识库的挂载区域选择已保存的全局 MCP 连接，执行“验证并挂载”；验证通过后才进入集合目录。不提供适配器选择、工具名/参数映射、stdio 启动或 OAuth 登录流程。连接地址和凭据仍在已有 MCP 配置入口维护；认证失败标记 auth-required，提示更新对端 token。

出口是 Server 的 transport，知识库能力仍可脱离 Server 在 CLI 使用。Gateway 不运行时对外 MCP 不可用，Settings 显示这一依赖；不为出口再增加第二个公网 daemon。

## 2. `octopus-knowledge/v1` 应用协议

使用 MCP 标准 `tools/list`/`tools/call`，在工具输入输出 schema 上固定业务版本。发现操作：

| 工具                         | 输入                                 | 输出摘要                                                                                                                  |
| ---------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `knowledge_describe`         | 空对象                               | productId（固定 dr-octopus）、serverVersion、protocolVersion、instanceId、capabilities、limits；instanceId 持久且不含路径 |
| `knowledge_list_collections` | cursor?、limit（默认 20、最大 100）  | items、nextCursor、catalogRevision；只返回该 caller 可读且发布的本地全局集合                                              |
| `knowledge_search`           | query、collectionIds?、topK、budget? | hits、coverage、sources、warnings；每项有 title、locator、documentVersionId、remoteReadRef                                |
| `knowledge_read`             | readRef、maxChars                    | 文档片段、locator、revision、是否过期；不能按绝对路径读取                                                                 |

`capabilities` 如 `collectionCatalog: true, search: true, read: true, documentListing: false, mutations: false`。首版自动挂载必须提供 describe/list/search/read；少任一项显示 incompatible，不猜测工具参数。文件清单分页为后续可协商扩展，首版远端集合详情显示说明、来源、能力、检索测试和连接状态，不伪造本地文件管理功能。

挂载验证检查 productId、应用协议主版本、必需工具及其输入输出契约；不兼容时拒绝挂载并提示使用支持版本的 Dr.Octopus，不尝试其他工具或 HTTP 接口。相同应用协议主版本只允许兼容的可选字段/能力扩展，忽略未知可选字段；serverVersion 用于诊断，不要求两端软件版本完全一致。productId 是兼容性标识，不能替代 TLS、token 鉴权和用户对目标地址的信任。

readRef 为有期限的不透明标识，服务端仍验证调用 token、目标集合与版本；不能当作永久授权 URL。返回内容用标准 MCP text content 和结构化结果（需锁定 SDK 验证 supported schema），文字 fallback 保持可用。应用错误区分 AUTH_REQUIRED、FORBIDDEN、NOT_FOUND、REVISION_EXPIRED、RATE_LIMITED、UNAVAILABLE、INVALID_QUERY；JSON-RPC/transport 错误由官方 SDK 处理。

版本分两层：MCP transport 协议版本通过官方 SDK 协商；`octopus-knowledge/v1` 是独立应用协议，不能混用。2026-07-28 MCP Streamable HTTP 修订删除了旧 GET stream 与协议 session 等行为，因此实现前须核对当前 `@modelcontextprotocol/client@2.0.0` 和拟新增 server 包实际支持的协议版本，并测试一对匹配版本，禁止照抄旧版 SSE/session handshake。[MCP Streamable HTTP 规范](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx)

### 2.1 远程集合生命周期

```text
configured -> connecting -> ready
                    \-> auth-required | incompatible | unavailable
ready -> stale（刷新失败）-> ready（完整刷新成功）
ready/stale -> disabled -> removed
```

- 添加挂载前执行 describe，完成 Dr.Octopus 实例与契约兼容性检查后再分页列举集合。mountId 与 remoteInstanceId 绑定，自连接直接拒绝；相同 remoteInstanceId 重复挂载要求明确替换，不创建重复目录。每次重新连接重验契约，失败时保留目录并标 incompatible，停止该来源检索。
- 全部目录页成功后，在一个本地 SQLite 事务更新缓存与缺失 tombstone；中途一页失败保留上次完整快照并标 stale，不能误删剩余集合。
- 默认 TTL 60 秒，页面打开或用户刷新触发更新；支持的通知仅用于加速，不能依赖通知保证正确。revision 不一致时重新拉取完整目录，cursor 必须可过期。
- 全局 UI 中本地和远程集合按同一列表分页，但 id 使用 opaque namespaced ref；同名可并存，来源 Badge 始终可见。离线集合保留并标不可用，不把缓存目录冒充在线可读。
- 远端集合内容由远端索引，查询路由到远端，禁止把远端向量复制到本地索引表。发送范围只含用户选中集合和 query，不发送全量对话。
- 单来源建议 timeout 3 秒、全部远端 deadline 5 秒，并发最多 4；尊重取消和 Retry-After；读请求最多一次安全重试且不得超过总 deadline。连续失败短路 30 秒，手动重试可以探测恢复。
- 远端撤销权限/删除集合立即停止该来源读取并更新目录；历史引用展示 unavailable/removed。移除 mount 清理目录缓存，不删除远端文档。
- 远端集合不能从本地出口再次发布；避免 A 挂 B、B 挂 A 形成递归搜索。认证、超时和 schema 校验按来源独立执行。

### 2.2 出口安全与启停

Settings 默认 disabled。开启前选择具体本地全局集合，创建只读 token，显示端点与客户端配置。token 明文只展示一次，服务保存 hash/credential reference；每请求执行 constant-time 凭据校验、过期/撤销检查和集合 allowlist 交集。

支持预配置 Bearer token 的客户端，token 放 Authorization header，不在 query/URL/日志中；Dr.Octopus 实例间挂载采用同一认证方式。该模式是明确协商的自定义认证，不提供 OAuth 自动发现或额外授权服务器。[MCP authorization overview](https://modelcontextprotocol.io/specification/2025-11-25/basic)

本地默认回环访问；校验 Host/Origin、防 DNS rebinding，拒绝不允许的 Origin。局域网/公网启用是独立配置动作，要求 TLS 终止与鉴权；不能因 Gateway 已监听所有地址就默认暴露 MCP。代理只信任配置的代理头。每 token 设置速率、请求体、并发和结果预算。

远端 URL 在保存/连接/重定向时重新校验 scheme、主机和最终地址；拒绝云元数据/链路本地等非预期目标。用户明确配置的 localhost/内网 MCP 可以允许，不能简单全面封禁私网导致本地互联失效；跨主机重定向不转发凭据。

出口策略变更通过 expectedRevision CAS；disable/revoke 先持久化，再取消相关在途查询/流并重新校验响应。不能继续使用旧 allowlist 的长连接。控制面同步失败时标记 pending/degraded，对外 fail closed，不能返回已完全生效。删除集合立即从发布交集中消失。

## 3. HTTP 管理契约

资源 DTO 使用 `@octopus/shared/protocol/knowledge.ts` 的 Zod schema 为边界权威。遵循现有 controller/service/repository、ApplicationError、X-Request-Id 和无全局 data envelope 约定；内部 Agent domain 不反向导入 Web DTO。

统一前缀：

- 全局：`/api/knowledge`。
- 工作区：`/api/workspaces/:workspaceId/knowledge`。
- Settings：`/api/settings/knowledge`。

| 方法与相对路径                      | 用途                                                                  | 成功语义                                                     |
| ----------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------ |
| GET `/collections`                  | 集合分页，本地/远程来源过滤                                           | items/page/pageSize/total                                    |
| POST `/collections`                 | 新建本地集合                                                          | 201 + collection                                             |
| GET/PATCH/DELETE `/collections/:id` | 详情、名称/说明修改、删除                                             | PATCH 返回 revision；DELETE 返回已 tombstone 与 cleanupJobId |
| GET `/collections/:id/documents`    | 文档分页、状态/格式/名称过滤                                          | items/page/pageSize/total                                    |
| POST `/collections/:id/documents`   | 新增文本                                                              | 202 + document/job                                           |
| POST `/collections/:id/imports`     | 已验收 upload/attachmentRef 导入                                      | 202 + durable accepted job；复制未成功不能称 accepted        |
| GET `/documents/:id`                | 状态、版本、覆盖率、导入来源                                          | document                                                     |
| PATCH `/documents/:id`              | 更新名称/文本版本                                                     | 新内容 202 + job，纯名称 200                                 |
| DELETE `/documents/:id`             | 撤销可见性并排队清理                                                  | 200 + tombstone/cleanupJobId                                 |
| POST `/documents/:id/reindex`       | 单文档重建                                                            | 202 + job，旧版本继续可读                                    |
| POST `/collections/:id/reindex`     | 集合 shadow generation 重建；模型来源 existing/current，默认 existing | 202 + job；同集合仅一个重建，新增/修改排队                   |
| GET `/jobs/:id`                     | 阶段、数量、诊断、取消状态                                            | job                                                          |
| GET `/jobs/:id/items`               | 压缩包叶项分页                                                        | items/page/pageSize/total                                    |
| POST `/jobs/:id/cancel`             | 明确取消持久任务                                                      | 200/202 + 当前取消状态                                       |
| POST `/jobs/:id/retry`              | 重试可恢复失败项                                                      | 202 + job；已成功项不重复                                    |
| POST `/search`                      | 管理页检索测试                                                        | hits/coverage/sources/warnings                               |
| GET `/documents/:id/preview`        | 鉴权后定位预览                                                        | 有界内容/安全预览工件，不返回本机路径                        |

上传仍走现有 TUS/附件基础设施，由 purpose 指定知识导入策略，不在每个 collection controller 再造 multipart/断点续传栈。workspace 上传必须绑定工作区；全局管理上传新增合法的全局 staging 归属，不能借用任意 workspaceId 隐式提升权限。

具体归属：Server 增加 `knowledge_uploads` 表保存 id、ownerId、scopeKind、workspaceId（仅 global 可空）、collectionId、uploadId、blobSha256、status、expiresAt、consumedJobId；通过 schema check 约束 scope。现有 `attachments.workspaceId NOT NULL` 和普通附件状态机不改为可空。TUS 的存储/校验组件通过显式 upload purpose 分派到该 staging repository，传给知识服务的仍是受限 import ticket。只有原文已复制并持久接受后才标 consumed，未消费上传按 TTL 清理；若复用 Host Blob，GC 引用检查必须覆盖 knowledge_uploads，不能只检查 attachments。所有这些表由 Server Drizzle 生成迁移管理。

Job 接受与 Host 标 consumed 没有跨进程事务：先由服务按 uploadId 幂等持久接受，Host 再记录 consumedJobId；中断后查询同一幂等请求补记，不重复导入。未确认消费但仍关联活动导入 ticket 的 staging 不得过早回收。

Settings 的三类当前模型配置、模型测试、OCR 本地资源安装、token create/revoke、mount create/probe/refresh/delete 分属明确动作。普通配置修改不执行隐式扫描、模型调用或下载；Embedding 变更显示需要重建才会采用新模型的集合。秘密采用 write-only mutation 与 masked GET，不提供模型档案 CRUD。模型配置契约见 §3.2。

### 3.1 分页、冲突、幂等与事件

Web 页码分页采用 `page>=1, pageSize=20|50|100`，默认 20，最大 100；固定排序 createdAt DESC/id DESC，名称排序补 id tie-breaker。items 与 total 在同一 SQLite 读事务获取。

Web 使用普通页码分页，不要求跨页目录快照，不传 expectedCatalogRevision，也不因其他页面增删而强制退回第一页。并发变更可能使跨页条目短暂重复或遗漏；mutation/SSE 触发查询刷新，当前页超出最后一页时才回到有效页。远程挂载的 Web 分页查询本地缓存目录，不在一次请求中串行遍历所有远端页。MCP 目录同步仍保留 catalogRevision 与完整分页校验，失败不据此删除缓存条目。

PATCH/DELETE/reindex 使用 If-Match 或明确 expectedRevision；HTTP 412 表示版本冲突。POST mutation 使用 Idempotency-Key，服务存储 principal/operation/payloadHash；同 key 不同内容返回 409。删除重试返回当前 tombstone，不因资源已不存在而重启 cleanup。

业务 SSE 只发布 `knowledge.collections.changed`、`knowledge.documents.changed`、`knowledge.jobs.changed`、`knowledge.mounts.changed` 的资源身份/revision。Web 用 TanStack Query 精确 invalidation；断流重连重新拉取，进度页可低频轮询兜底。SSE 不传原文、秘密或未授权 scope，后台任务进度节流至约每秒一次。

### 3.2 Settings → 知识库：OCR、Embedding 与 Reranker

用户要求三类模型统一在此配置。页面在服务状态之后提供“模型配置”区域，依次显示 OCR、Embedding、Reranker 三张 Card；对外 MCP 服务和远端挂载保持独立区域。配置源是知识服务，不写 Pi `models.json`，不在 Composer 或集合页重复保存凭据。

| 分组           | 表单与状态                                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OCR 模型       | 本地/远程受支持 adapter，模型 id/version；本地模型/语言资源选择及安装状态，远程 endpoint/secret；识别语言、auto/force/off、页面超时、并发；测试样本识别结果 |
| Embedding 模型 | adapter、endpoint、secret、model、维度与 normalization/distance、batch/timeout；显示“配置维度/实测维度”、当前模型和仍使用旧索引配置的集合                   |
| Reranker 模型  | 独立 enabled Switch、adapter、endpoint、secret、model、候选数/输入预算/超时、失败策略；远程片段转发选项；测试 query 与候选重排结果                          |

三个分组均提供“测试模型”“保存”及脱敏错误，保存中禁用重复操作，成功返回 revision 和 effect。模型名称允许手动输入，提供方确实支持枚举时才显示模型列表；不拿聊天模型目录冒充 OCR/Embedding/Reranker 能力目录。关闭 Reranker 显示“使用混合检索基础排序”，不将其显示为故障。已启用但运行失败显示降级原因和重试入口。

每类只有一个当前配置，页面直接编辑这三个分组；不提供新建/复制/删除模型档案或默认档案选择器。模型配置 API 前缀为 `/api/settings/knowledge`，`:kind` 限 ocr/embedding/reranker：

| 方法与相对路径             | 契约                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| GET `/`                    | 返回 revision、ocrConfig/embeddingConfig/rerankerConfig（脱敏，含 configRevision）、capabilities、最近诊断与旧索引依赖摘要           |
| PATCH `/models/:kind`      | If-Match 更新该类当前配置（包括 mode/enabled），递增 configRevision；选用模型前校验测试指纹，关闭不要求测试；返回 effect，不隐式重建 |
| POST `/models/:kind/probe` | 接受当前配置或该类草稿，调用模型做有界测试，返回 validationFingerprint、维度/能力和脱敏诊断；不保存                                  |
| POST `/models/ocr/install` | 安装当前本地 OCR 配置所需受管资源，返回安装 Job；远程 OCR 不支持此操作                                                               |
| PATCH `/credentials/:id`   | 仅更新或显式撤销已有受管秘密引用，校验其属于本知识服务并展示依赖影响；不修改 endpoint/model，不创建模型档案                          |

共享 schema 采用 kind 判别联合，限制每类 adapter 的字段；不允许任意 URL、shell 命令或模型上传替代受支持 adapter。配置错误、验证过期、维度不匹配和依赖被引用使用稳定 code。Provider 网络地址沿用已定义的地址/重定向/secret 安全策略，显式允许用户配置的本机或内网模型服务。

测试使用内置小样本，涉及远程调用时明示发送内容和可能产生的用量；不自动读取用户知识文档做测试。Secret 输入为空表示保持原凭据，删除凭据必须显式操作；GET 只返回是否配置和掩码，probe 日志不包含秘密或正文。配置修改通过业务 SSE 发布 `knowledge.settings.changed` 的 revision，Query 重新获取状态。

切换 OCR 后提示“仅新解析生效，可重新解析已有文档”；切换 Embedding 后提示“已有集合需要单独重建”；切换 Reranker 后提示“下次检索生效，无需重建”。配置 revision、执行快照、重建排队后的模型绑定和失败策略以[框架 §7.1–7.2](./knowledge-base.md)为权威。三类表单使用 TanStack Form 与 FieldGroup/Field，显示服务端校验错误；Page/Settings 现有布局和语义色保持一致。

验收包括：分别编辑/测试三类当前模型、secret 脱敏、测试指纹过期、Embedding 维度不符、OCR 缺资源、Reranker 默认关闭与运行失败降级、配置更新不改变已绑定的执行快照、旧集合继续使用原 Embedding、旧凭据轮换/撤销，以及服务 stopped 时不被 Settings 查询自动拉起。重建成功后排队写入使用新代配置，失败后使用旧代，不能混写维度。

## 4. 管理页面与 shadcn 视觉框架

设计遵循当前应用的 Page、PageHero、语义色、shadcn primitives，业务布局放 `features/knowledge`。不修改 `packages/ui/src/components/`。缺失的官方 primitive 用项目规定的 shadcn CLI 安装。

### 4.1 信息架构

- 顶部菜单与 Skills 页保持一致：工作区入口为 `/workspaces/$workspaceId/knowledge`，会话入口为 `/workspaces/$workspaceId/sessions/$sessionId/knowledge`。会话入口保留顶部会话信息及侧栏选中态，切换技能或返回聊天继续使用相同 Session ID；两个入口复用同一知识库页面。用“工作区 / 全局” Tabs 切换管理范围，默认当前工作区，全局页签展示本地全局与远程挂载。侧栏不添加知识库菜单，切换 Tabs 不改变路由。
- PageHero 标题“知识库”，说明当前范围；右侧搜索、新建集合、上传。名称与操作区域留出足够空白，避免把设置参数堆在首屏。
- 集合默认卡片网格，卡片显示名称、两行说明、文档数、可检索状态、更新时间，以及“本地/远程 · 来源” Badge。大量集合允许切换紧凑列表，分页和筛选保留在 URL。
- 集合详情用 PageHero + Breadcrumb，顶部显示可问答文档数、待索引/失败数量；主体为文档 Table，下方 Pagination。
- 文档行展示名称、格式、来源、状态、大小、更新时间；常用查看/重试可见，删除和重建放 DropdownMenu。上传进度与索引进度分开显示。

页面线框是信息布局约束，非最终视觉稿：

```text
知识库                                      [搜索…] [新建集合] [上传]
全局知识 · 本地与已挂载来源

[全部来源 v] [全部状态 v]                          [卡片 / 列表]

┌ 产品规范                    ┐ ┌ 工程手册                    ┐
│ 本地 · 12 份可问答          │ │ 远程 · 团队知识服务        │
│ 版本约定与交付规范…         │ │ 接入和故障处理…            │
│ 最近更新 10 分钟前     […]  │ │ 已连接                […]  │
└────────────────────────────┘ └────────────────────────────┘

                                     共 28 个集合  [1] [2] [下一页]
```

### 4.2 交互与组件

| 交互       | shadcn 组合与状态                                                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 新建集合   | Dialog、FieldGroup/Field、Input、Textarea、scope 说明；TanStack Form 校验                                                          |
| 上传       | Dialog/Sheet、拖放区域、Attachment、Progress；目标集合固定可见                                                                     |
| 导入详情   | Sheet + Table + Badge；成功/失败/跳过筛选，可只重试失败项                                                                          |
| 文档预览   | SheetTitle + ScrollArea；PDF 按页、PPTX 按 slide、表格按行；引用位置高亮                                                           |
| 重建       | AlertDialog 说明“查询仍可用，新增/修改将排队，删除会取消重建”；显示沿用索引模型/采用 Settings 当前模型，默认沿用；job 展示阻塞原因 |
| 批量删除   | Checkbox 选择，明确显示“当前页 n 项”；跨页全选必须显示范围与数量                                                                   |
| 检索测试   | 右侧 Sheet，输入问题、命中片段、引用定位、来源诊断；默认不产生 LLM 回答费用                                                        |
| 空/慢/失败 | Empty/Skeleton/Alert，显示行动入口；远程不可用有重连入口                                                                           |
| 问答来源   | Dialog/Command 多选、范围 Badge；远程附来源名称                                                                                    |
| 引用       | 已有 MessageRow 内的轻量 citation 按钮 + Sheet；registry 验证后才可点击                                                            |

使用现有语义颜色、字体层级与组件 variants；卡片边框轻、信息分组清晰。状态同时有文字与图标，不能只靠红绿区分。移动端列表变紧凑文档行、Sheet 占全宽，主要动作保持可达。所有图标按钮有 accessible name，Dialog/Sheet 有 Title，键盘可选择集合、翻页、打开引用并恢复焦点。

页面文案使用“等待索引 / 正在识别扫描页 / 可问答 / 部分内容可问答 / 需要重试”。LanceDB、generation、OCR worker 等实现术语只放技术详情；用户首屏主要看文档是否可用和如何修复。

React 使用已有 TanStack Router/Query/Form，必要客户端状态才用现有 Zustand 模式；进度和目录属于 server state，不另建双份 store。一般页面采用 Page + PageHero，会话模式和引用展示复用 session feature。工具 renderer 仅呈现 versioned details，实施前遵守 [Tool Renderer Development](./web-tool-renderers.md)。

知识问答复用普通 Session draft、agent.prompt 和 agent.set-work-mode。Agent 管理配置，Server 不新增问答运行时或独立 QA HTTP/WS 协议，完整约定见[普通 Session 问答模式](./knowledge-session-mode.md)。

## 5. 端到端验收场景

1. 管理页新建工作区集合，上传一个包含 DOCX、XLSX、嵌套 ZIP 与扫描 PDF 的归档；每个叶项状态可见，失败不覆盖成功项，完成后能按页/行/段定位。
2. 普通 Agent 根据用户明确请求新建集合并导入本会话附件；tool 返回 durable job；原消息/附件删除后知识文档仍可检索。
3. Composer 开启新的 knowledge 会话，选择集合并上传文件；等索引完成后回答含有效引用；全过程没有 Pi RPC Process 或其他扩展启动。
4. 集合重建时继续问答，新增/替换文档显示排队；成功切换后按新代配置执行，失败后按旧代执行。删除立即生效并取消重建，重启不遗留永久门禁；旧索引仍可查询，失败不清空知识库。
5. Settings 发布一个全局集合，外部标准 MCP client 可 search/read；工作区及未发布集合不可枚举，撤销 token 后旧连接也不能继续读。
6. 挂载另一 Dr.Octopus 实例后，远程集合并入全局分页列表；同名集合不冲突，远端掉线保留目录并显示状态，本地回答仍可继续且标识 partial。验证不同软件版本但同一兼容应用协议的互通；普通 MCP 服务、应用协议主版本不兼容或缺少必需工具时拒绝挂载，且不回退到其他接口。
7. 两实例互相挂载并发布本地集合，查询不递归转发；对端目录分页中途失败不误删本地缓存条目。
8. 服务进程在不同提交阶段被终止后重启，入库任务可恢复、重复请求不重复文档；SDK 首次回答前重启不丢已 ACK 问题、不自动重放。
