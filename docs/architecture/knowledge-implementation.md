# 知识库实施与验收记录

2026-09-10，Codex。用户已授权实施。配套设计：[领域框架](knowledge-base.md)、[问答 Session](knowledge-session-mode.md)、[MCP 与 Web](knowledge-mcp-and-web.md)。本文记录当前代码与验证边界。

## 已交付

- Agent 内置知识库扩展、轻量公共 SDK、按 Agent 目录及 OS 用户划分的单例后台；LanceDB 分块/向量/FTS，独立 SQLite/Drizzle 元数据与任务，原文自有 CAS。
- 全局/工作区集合，集合及文档分页、新增文本、上传、重命名、替换原文、删除、集合重建、任务取消/重试、七天证据保留与空闲清理。
- LangChain TS Document/切分/Embeddings，LanceDB Node SDK 负责检索与版本过滤。中文采用 `Intl.Segmenter` + whitespace FTS，避免额外 jieba 词典。
- 共享 `packages/document-processing` 支持 DOCX、XLSX、PPTX、CSV、MD、TXT、PDF、扫描/混合 PDF，以及 ZIP/TAR/GZIP/TGZ 递归展开。原聊天 DOCX 附件入口保留契约并复用解析包。
- 普通 Agent tools 和 Host 签发的会话附件导入凭证；计划任务的受限执行配置不自动加载知识库扩展。
- Settings → 知识库的三个模型配置/测试、服务启停、MCP 出口与远程挂载；shadcn 管理页与会话入口。
- 双向 MCP 仅实现 Dr.Octopus `octopus-knowledge/v1`。远程集合并入本地全局列表，数据仍由对端持有；出口仅发布明确选择的本地全局集合，禁止远程集合再次发布。
- 普通 Session 中切换知识问答，复用原有消息、取消、重试、历史与通知；Agent 拥有配置及工具边界。
- `apps/cli` 五个管理命令转发、发行目录使用锁及首次安装保护；无依赖 CLI 帮助/诊断不加载 Pi、LanceDB 或原生锁模块。

## 所有权与入口

| 所有者      | 代码与职责                                                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Shared      | `packages/shared/src/protocol/knowledge`：操作 DTO 和固定 MCP schema                                                              |
| Agent       | `extensions/knowledge/sdk`：Host 出口；`daemon`：后台装配/协议；`services`：纯领域规则；`lib`、`db`：持久化、索引、模型与解析执行 |
| Parser      | `packages/document-processing`：无 Host 生命周期的文档及容器解析                                                                  |
| Server 管理 | `modules/knowledge`：HTTP、tus、MCP transport，通过公共 Agent SDK 调用后台                                                        |
| CLI         | `apps/cli/src/knowledge.ts`：动态调用 Agent 公共出口                                                                              |

不引入消息队列、LangGraph、通用多运行时会话基类、远程向量同步或第三方知识库兼容层。

## 开发模型与运行

以下为模型配置示例，地址使用文档保留网段，不可直接连接；请替换为自己的服务地址，并按服务要求设置 API Key。

| 用途      | 模型                    | Base URL                    | 验证协议                               |
| --------- | ----------------------- | --------------------------- | -------------------------------------- |
| Embedding | `bge-m3`                | `http://192.0.2.10:8031/v1` | `/embeddings`，1024 维，开发批量 8     |
| Reranker  | `bge-reranker-v2-m3`    | `http://192.0.2.10:8030/v1` | `/rerank`，候选索引与分数              |
| OCR       | `PaddleOCR-VL-1.6-0.9B` | `http://192.0.2.10:8088/v1` | `/chat/completions`，PNG + `OCR:` 指令 |

运行真实模型集成测试时，设置 `OCTOPUS_KNOWLEDGE_MODEL_TEST=1` 和 `OCTOPUS_KNOWLEDGE_EMBEDDING_URL`（自己的 Embedding 服务 URL）；未开启时测试不连接模型服务。

执行 `pnpm install --frozen-lockfile`、`pnpm build`、`pnpm dev`。进入 Settings → 知识库，启动服务并填写、测试、保存三个配置；知识问答始终使用当前会话模型；已有模型选择器修改 Session 模型，切换知识问答模式不覆盖或恢复模型。

```powershell
# 开发态，无需预先打开工作区或完成模型 onboarding
pnpm --filter @octopus/agent dev knowledge start
pnpm --filter @octopus/agent dev knowledge status
pnpm --filter @octopus/agent dev knowledge health
pnpm --filter @octopus/agent dev knowledge stop

# 产品 CLI，同时接受 knowledge service <action> 别名
dr-octopus knowledge start
dr-octopus knowledge restart
dr-octopus knowledge status
dr-octopus knowledge health
dr-octopus knowledge stop
```

命令可传 `--agent-dir <path>`。status/health 不启动服务；health 检查本地服务/存储/配置，模型真实可用性由 Settings“测试模型”探测。

## 存储、备份与 MCP 部署

后台数据位于 `dirname(realpath(AgentDir))/knowledge/`（默认 `~/.dr-octopus/knowledge/`，与 `permission-system/`、`scheduler/` 同级）：`control.sqlite`、`lance/`、`blobs/`、配置与私有凭据。新问答配置随普通 Session custom entry 保存。迁移来自 Drizzle schema，启动使用官方 migrator；已验证升级保留原会话、反馈和通知，旧 Session 默认 `agent`。

先 stop，再以公共 SDK `withStoppedKnowledgeService(agentDir, async directory => ...)` 包住完整目录复制。回调持有后台相同的 OS 排他锁；复制时排除 `daemon.lock`、`endpoint.json`、`startup-error.json`，目标目录保持用户私有并保留 stop 状态。恢复后显式 start；真实进程测试已验证恢复集合目录。恢复问答历史还需备份 Server 数据与普通 Session JSONL。

重建使用 shadow generation，成功才切换发布指针。旧原文/索引至少保留七天，活跃引用继续保护分块；任务保留三十天，上传暂存保留一天。

MCP 出口位于 `/mcp/knowledge`，默认关闭，仅发布勾选的本地全局集合，使用 Bearer token。另一实例在全局 `mcp.json` 配置该 HTTP 连接后，可从 Settings 选择并挂载。目录 TTL 60 秒，失败保留旧目录、短暂退避，支持手动刷新；检索报告部分/全部不可用。

默认仅 loopback。对外访问选择 TLS 策略及 Host/Origin 白名单；同机 HTTPS 反向代理必须覆盖 `X-Forwarded-Proto: https` 并保留正确 Host，仅 loopback 代理的该头被信任。非 loopback 不能伪造此头绕过 TLS。本次 MCP 集成测试使用本机 HTTP，真实部署还需验证代理与证书。

## 本版具体边界

以下是较宽泛设计草案在当前版本中的具体落点：

- 重新索引按整个集合执行并使用当前 Embedding 配置；未提供逐文档重建或“旧/新模型配置”选择器。替换单篇原文会独立索引新版本。
- 模型每类一份当前配置，已受理任务使用快照；OCR 设置变更影响后续任务，运行中任务可显式取消。模型测试不建立回执数据库，也不强制每次保存前测试。
- 使用字符数、文件大小、页数、归档深度和 worker 时间/内存预算；不引入 tokenizer 服务或容器。RSS 定时采样不是严格的内核内存配额。
- 容器校验/展开失败使整包失败；展开成功后的文档解析失败按叶项记录 partial，成功叶项可检索。压缩格式限上述系列，文本采用 UTF-8。
- 集合/文档分页，任务返回有界叶项结果；未增加全局任务中心、叶项分页和上传取消 UI。移除失败/未完成附件引用后可仅使用已有资料提问。
- 原始问题与已受理附件关联持久保存；未发送草稿在当前浏览器进程内保存，不承诺刷新恢复未提交 File。页面关闭不撤销已受理问题，迟到创建响应不触发离页后的导航。
- 远程挂载只读，未提供远端文档列表/写入、通用第三方兼容、OAuth 或 stdio 知识源。

## 2026-09-10 模式整合

取消独立 QA Session 后，普通会话的 knowledge 模式由 Agent 管理，前端来源选择和模型配置经已有控制链路转发。内置 Skill 直接注入问答提示，工具层限制集合，检索结果使用普通工具卡引用展示。历史实验表保留为归档。

本轮验证结果：

- `pnpm build`、`pnpm lint`、`pnpm typecheck` 通过；Server `db:check` 通过。
- `pnpm test --concurrency=1` 通过：550 项通过，1 项内网模型集成测试默认跳过。已更新旧协议中拒绝 knowledge 模式的过时断言。
- 单独设置 `OCTOPUS_KNOWLEDGE_MODEL_TEST=1` 执行知识集成测试通过：使用上述三个内网服务且不配置 ApiKey，覆盖扫描 PDF OCR 入库、混合检索与 reranker、重建期间旧引用及删除后证据失效。
- 真实 Pi Session SDK 验证同一身份与历史、工具和提示词切换、Session 模型选择在来源修改和模式切换后保留；额外加载本机已安装的 Plan 扩展，验证双向工作流互斥。
- 浏览器实测普通首页进入知识模式、自动/指定集合、检索引用展开、刷新恢复、模型切换与退出恢复；桌面 1440×1000 和手机 390×844 无横向溢出，测试流程未出现页面错误。

浏览器验证使用隔离的 Agent/Server 数据目录，调用真实知识后台及 Embedding/Reranker；回答模型使用确定性的 OpenAI SSE 测试服务，验证工具交互和状态流转，不作为实际回答质量评测。Browser plugin 不可用，因此使用 Python Playwright。测试用临时服务已关闭，不修改用户现有 Gateway 或模型配置。
