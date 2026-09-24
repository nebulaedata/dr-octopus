# Architecture Decision Records

本目录记录 Octopus 已接受或提案中的架构决策。文件按四位序号递增；被替代的决策保留原文并更新状态。

| ADR                                                                         | 状态     | 决策                                                                                                      |
| --------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| [ADR-0001](./0001-pi-rpc-host-architecture.md)                              | Accepted | 采用 Pi RPC 模式作为 Agent 与宿主（Web/Desktop）间的桥梁；进程基数由 ADR-0005 更新                        |
| [ADR-0002](./0002-modular-monorepo-packages.md)                             | Proposed | 采用 pnpm Monorepo 组织 Agent SDK 与多宿主应用                                                            |
| [ADR-0003](./0003-shared-ui-component-layer.md)                             | Proposed | 通过 `packages/ui` 提供跨宿主共享的 shadcn/ui 组件库                                                      |
| [ADR-0004](./0004-workspace-pi-extension-control-plane.md)                  | Proposed | Workspace 作为 Pi Extension 与进程内 SDK，Host 适配层直接调用 Workspace Service                           |
| [ADR-0005](./0005-host-owned-session-runtime-processes.md)                  | Accepted | Host 按驻留 Session 编排 RPC 子进程，支持同 Workspace 多 Session 后台并行                                 |
| [ADR-0006](./0006-pi-web-semantic-parity.md)                                | Accepted | Pi Web 对齐 RPC 可表达的会话语义，以 Web 原生交互替代终端专属界面                                         |
| [ADR-0007](./0007-web-control-and-realtime-protocol.md)                     | Accepted | HTTP 承担可恢复控制面，单 WebSocket 承担多 Session 实时运行面                                             |
| [ADR-0008](./0008-immutable-runtime-session-derivation.md)                  | Accepted | 使用公开 SessionManager 离线派生新 Session，不替换或停止源 runtime                                        |
| [ADR-0009](./0009-session-channel-module-boundary.md)                       | Accepted | 使用 Session Channel 表达多 Session 双向运行通道，并分离 Controller 与 Service                            |
| [ADR-0010](./0010-workspace-web-session-catalog.md)                         | Accepted | Workspace 包含 Web Session Catalog，并显式映射 Pi Agent Session                                           |
| [ADR-0011](./0011-session-runtime-operation-leases.md)                      | Accepted | 使用操作租约、原子回收认领和有序退役消除 Session runtime generation 竞态                                  |
| [ADR-0012](./0012-server-runtime-library-boundary.md)                       | Accepted | 将 Server runtime 提取为不反向依赖业务 Module 的内部基础库                                                |
| [ADR-0013](./0013-user-skills-management.md)                                | Accepted | Server 直接管理 User 作用域 Pi Skills 文件，提供上传、编辑、删除 HTTP 能力；作用域与路由由 ADR-0014 修订  |
| [ADR-0014](./0014-dual-scope-skills.md)                                     | Accepted | Skills 拆分为全局与 Workspace 双作用域，路由继承 Workspace，运行时经扩展事件加载 Workspace Skills         |
| [ADR-0015](./0015-effective-skills-catalog.md)                              | Accepted | 分离受管 Skills 与有效目录；活跃 Runtime 为权威，未运行 Workspace 使用 Pi Loader 预解析                   |
| [ADR-0016](./0016-stable-session-runtime-slots.md)                          | Accepted | 使用稳定 Slot 消除激活空窗，由 Fastify 插件统一 Runtime 生命周期，并以 readiness 门禁 Composer            |
| [ADR-0017](./0017-fastify-database-lifecycle-plugin.md)                     | Accepted | 由 Fastify 插件统一数据库生命周期，保持业务模块显式注入，并以真实依赖探针发布 readiness                   |
| [ADR-0018](./0018-fastify-instance-service-context.md)                      | Superseded | 由 ADR-0066 的模块入口显式注入替代完整 Fastify Service 上下文 |
| [ADR-0019](./0019-pi-authoritative-thinking-controls.md)                    | Accepted | Pi runtime 权威提供 thinking 当前值与模型可用等级，Web 通过 snapshot、ACK 和事件同步                      |
| [ADR-0020](./0020-single-authority-permission-gate.md)                      | Accepted | 内置 Permission Gate 作为唯一审批权威，发布基线排除旧权限包，并以精确工具规则配置 auto                    |
| [ADR-0021](./0021-host-owned-attachment-lifecycle.md)                       | Accepted | SQLite + 本地 Blob 独立持有附件；固定格式准入、实施契约、双阶段 shadcn 回显与 Pi text/image/manifest 适配 |
| [ADR-0022](./0022-global-runtime-data-root.md)                              | Revised  | Agent 与 Server 默认物理共址但配置独立；附件物化位置由 ADR-0025 修订                                      |
| [ADR-0023](./0023-domain-organized-shared-protocol.md)                      | Accepted | Shared Protocol 按领域组织；跨边界数据以 Zod 为运行时权威，静态内部契约使用 TypeScript                    |
| [ADR-0024](./0024-optional-server-file-logging.md)                          | Accepted | stdout 保持主输出，独立部署可启用 Server 本地 JSONL 滚动文件日志                                          |
| [ADR-0025](./0025-workspace-permanent-attachment-cache.md)                  | Accepted | 将 Agent 附件工件永久物化到 Workspace temp，自忽略且不执行自动清理                                        |
| [ADR-0026](./0026-global-settings-and-pi-resource-management.md)            | Accepted | Settings 独立于 Workspace，并由全局控制面管理 Pi 资源                                                     |
| [ADR-0027](./0027-pi-model-runtime-authoritative-provider-management.md)    | Accepted | 以 Pi ModelRuntime 作为模型 Provider 有效状态权威                                                         |
| [ADR-0028](./0028-host-owned-provider-auth-sessions.md)                     | Accepted | 由 Host 管理 Provider 认证会话和秘密传输边界                                                              |
| [ADR-0029](./0029-loss-minimizing-models-json-mutations.md)                 | Accepted | 以保留未知字段的文档仓储和 staged validation 修改 models.json                                             |
| [ADR-0030](./0030-guarded-local-provider-detection.md)                      | Accepted | 本地 Provider 探测采用受保护、显式触发和有界网络访问                                                      |
| [ADR-0031](./0031-preserve-default-model-intent-across-runtime-fallback.md) | Accepted | Runtime fallback 不覆盖用户的默认模型意图                                                                 |
| [ADR-0032](./0032-use-pi-native-extension-resource-overrides.md)            | Accepted | Extension 开关使用 Pi 原生 package resource override                                                      |
| [ADR-0033](./0033-unify-settings-http-mutation-contract.md)                 | Accepted | 统一 Settings HTTP mutation、幂等、并发和部分成功契约                                                     |
| [ADR-0034](./0034-separate-typescript-check-and-emit-configurations.md)     | Accepted | 默认 TypeScript 配置只检查，构建配置唯一输出到 dist，并守卫源码目录                                       |
| [ADR-0035](./0035-streaming-docx-text-extraction.md)                        | Accepted | DOCX 使用流式 ZIP 与严格 SAX 生成有界智能体文本，并保留 Office 容器安全边界                               |
| [ADR-0036](./0036-use-pi-mcp-adapter-for-settings-config.md)                | Proposed | 以固定版本 Pi MCP Adapter 作为 Settings MCP 配置语义权威                                                  |
| [ADR-0037](./0037-structured-workspace-mention-protocol.md)                 | Accepted | `@` 文件采用纯文本与结构化相对路径双通道，由 Host 验证并投影给 Pi                                         |
| [ADR-0038](./0038-agent-owned-singleton-scheduler-daemon.md)                | Accepted | Agent 持有跨 Runtime 共享的独立单例 Scheduler；保留内置 Extension，Server 作为薄适配                      |
| [ADR-0039](./0039-scheduled-task-durable-authorization.md)                  | Accepted | Permission 持有任务级持久授权，Scheduler 引用绑定，统一门禁与撤销恢复闭环                                 |
| [ADR-0040](./0040-business-data-sse.md)                                     | Accepted | SSE 同步业务数据，WebSocket 专用于 Conversation                                                           |
| [ADR-0041](./0041-result-observation-notifications.md)                      | Accepted | 根据当前会话页面焦点决定普通回复通知，保留完成事件与去重                                                  |
| [ADR-0042](./0042-cli-managed-gateway-distribution.md)                      | Accepted | 新增 CLI 管理 Gateway 生命周期，统一发布 Server 与 Web，保留 Agent/Scheduler 边界                         |
| [ADR-0043](./0043-pnpm-workspace-release.md)                                | Accepted | 原始 workspace 元数据与完整 dist 复制，pnpm 在目标机器安装运行依赖                                        |
| [ADR-0044](./0044-cli-owned-gateway-server-lifecycle.md)                    | Accepted | CLI 持有 Gateway，Server 暴露与管理协议无关的生命周期                                                     |
| [ADR-0045](./0045-agent-knowledge-base-and-isolated-qa.md)                  | Accepted | 内置知识库共享服务、LanceDB 检索与 SQLite 控制面、双向 MCP 挂载，以及普通 Session 内的知识问答模式       |
| [ADR-0046](./0046-configured-npm-bootstrap.md)                           | Accepted | 独立配置生成 npm 引导包，运行 workspace 归档由随包 pnpm 安装到用户目录                                    |
| [ADR-0047](./0047-scoped-environment-settings.md) | Accepted | 分作用域的运行环境配置、统一 SDK 与 Settings 编辑界面 |

| [ADR-0048](./0048-shared-streaming-document-processing.md) | Implemented | 附件与知识库共用 Office 流式解析、顺序展开压缩包与有界索引写入 |

| [ADR-0049](./0049-declarative-permission-configuration.md) | Implemented | 默认权限、工具解释规则与分作用域 Settings 共用声明式配置 |

| [ADR-0050](./0050-global-agent-memory.md) | Accepted | Agent 内置全局记忆、Drizzle 事务与有界整理，TUI/RPC 共用并投影至 /memory |
| [ADR-0051](./0051-cli-environment-check.md) | Proposed | CLI 安装前分级环境检测，三平台适配，首期 Windows 本机真实验证 |
| [ADR-0052](./0052-explicit-config-change-session-restart.md) | Accepted（已实现） | 模型服务显式上报变更，内存版本派生提醒，通过 Slot 手动重启原会话 |
| [ADR-0053](./0053-server-settings-gui.md) | Proposed | Server 设置复用环境配置，宿主持有重启与故障恢复 |

| [ADR-0054](./0054-workspace-attachment-delivery-and-pdf-coverage.md) | Accepted | 原件与提取结果仅交付到工作区，明确输出目录及 PDF 扫描诊断 |

| [ADR-0055](./0055-unified-document-content-coverage.md) | Accepted | PDF 与 Office 共用覆盖诊断协议、格式规则与交付提示 |

| [ADR-0056](./0056-opaque-office-embeddings.md) | Accepted | Office 嵌入部件保留为不透明数据，外层正文继续提取 |

| [ADR-0057](./0057-scoped-subagent-child-tools.md) | Accepted | 不可变入口快照与双身份注册向原生子代理传递受限只读工具 |

| [ADR-0058](./0058-managed-background-tasks.md) | Accepted（阶段 B） | 受管后台任务工具、停止屏障与平台进程回收边界 |
| [ADR-0059](./0059-agent-owned-memory-daemon.md) | Accepted | Memory 单例后台、异步 SDK、单一写入连接与设置页服务启停 |

| [ADR-0060](./0060-shared-delegated-model-tools.md) | Accepted | 内置共享工具通过单一名单委派，接入 OCR、Embedding 与 Rerank |

| [ADR-0061](./0061-delegated-permission-snapshots.md) | Accepted | 子代理复用权限判定、启动时权限快照与只读工具诊断 |

| [ADR-0062](./0062-child-launch-admission.md) | Accepted | 固定父路径边界、统一子入口启动复核与过期拒绝 |
| [ADR-0063](./0063-explicit-knowledge-model-access.md) | Accepted | 将本地模型调用能力与知识库写权限拆分 |
| [ADR-0064](./0064-web-keyboard-shortcut-registry.md) | Implemented | Web 统一快捷键注册器、双作用域派发与本机可定制绑定 |
| [ADR-0065](./0065-draft-first-conversation-start.md) | Implemented | 草稿独立、可丢弃预热与首条消息统一提交 |
| [ADR-0066](./0066-server-module-autoload.md) | Accepted | 一级业务入口自动加载、具名共享能力、隔离路由作用域与显式资源所有权 |
| [ADR-0067](./0067-memory-run-lifecycle.md) | Accepted | 统一记忆触发、跨轮用户证据、显式请求结果与会话生命周期隔离 |
| [ADR-0068](./0068-command-completion.md) | Accepted | 指令完成独立于业务输出，通过响应后状态确认与请求/运行时隔离收尾 |
| [ADR-0069](./0069-optional-jev-evaluation.md) | Accepted | 可选 Jev SDK 判断能力，环境变量凭据与保守记忆筛选 |
| [ADR-0070](./0070-web-feature-entrypoints.md) | Accepted | 纯 feature 入口、局部 Hook/工具归属、私有工具注册与保持惰性页面加载 |
