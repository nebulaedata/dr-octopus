# Octopus 子代理工具继承设计

> 状态：2026-09-17 已实施并完成浏览器复测；全量回归仍有未通过项，见验收记录。
> 版本基线：pi-subagents 0.68.0、Pi 0.85.1。
> 范围：共享 Agent CLI/RPC 组合根与只读扩展，不修改 pi-subagents。

## 1. 背景与目标

前台子代理是父进程内的独立 AgentSession，后台子代理是 detached runner 内的 ChildSession。两者不继承父会话的工具注册表，Octopus 内联扩展也不是磁盘发现入口。旧权限设计第 29 节的 PI_SUBAGENT_PI_BINARY 方案不适用于 Node 原生子会话。

工具继承必须同时满足 requiredExtensions 强制加载和 agent tools 全域白名单。目标是提供前后台一致、受父会话限制的只读检索能力，不复制交互权限门或进程所有权。

明确排除 scheduler、workspace、写工具、onboarding、交互命令、MCP runtime snapshot 转发。本次不改变其他 agent 已有的 bash/edit/write 权限。

## 2. 评审修正与决定

| 原设计问题                         | 实施决定                                                              |
| ---------------------------------- | --------------------------------------------------------------------- |
| pi.events.on 不是生命周期订阅      | 使用 pi.on 的 session_start/session_shutdown                          |
| 启动事件异常不会阻止工具调用       | 委派前重新确认注册；失败返回 tool_call block                          |
| 新实例无法清理旧实例闭包           | shutdown 幂等注销，切换身份先注销旧注册                               |
| memory_list 不存在                 | 复用 memory_recall → memory_read                                      |
| knowledge_search 需要集合 ID       | 补全 knowledge_list_collections → knowledge_search → knowledge_read   |
| 端点发现不能代替访问范围           | 快照包含 workspaceId、collectionIds、父会话活动工具                   |
| 裸导入无法解析 agentDir 安装包     | 从 agentDir/npm/package.json 解析公共 export，用显式 jiti 依赖加载 TS |
| Memory 路径与 SQLite 实现描述错误  | 复用产品全局 Memory SDK，底层 better-sqlite3                          |
| 将服务错误包装成成功文本           | 工具执行抛安全领域错误，由 Pi 返回原生 tool error；模块加载不连接服务 |
| 只注册文件路径遗漏部分上游启动路径 | 同时注册会话文件路径和 UUID，统一注销和失败回滚                       |

### 2.1 身份兼容

源码与真实 E2E 共同确认：0.68.0 的 state/recovery 使用 getSessionFile() 优先，而 foreground/subagent-executor 的若干路径传入 getSessionId()；async-execution 优先读取 parentSessionId。因此仅按文件路径注册会导致前后台都出现工具缺失。

使用公共 registerRequiredChildExtensions，为文件路径与 UUID 去重后分别注册同一快照，不访问内部全局注册表。任一注册失败都回滚本实例已注册的身份。上游 sessionId 长度上限为 256 字符，超长文件路径会阻止委派，不偷偷改写查找键。

### 2.2 权限与产品行为

子代理可执行的业务工具是 CHILD_TOOLS 可委派名单与父会话 getActiveTools() 的交集。知识模式明确关闭时隐藏并拒绝知识工具；损坏的已持久化知识模式状态阻止委派。Memory 每次执行继续检查全局 off 策略，并保留调用预算。

浏览器实测发现：pi-subagents 会用 getAllTools 检查 agent 固定白名单，直接省略未授权工具的注册会连带阻止仅 Memory 子代理启动。因此 child-entry 注册名单内完整工具定义以满足存在性预检，在 session_start/before_agent_start 从活动菜单移除未授权工具，并在每个 execute 包装器中先检查宿主快照，拒绝时抛出 CHILD_TOOL_NOT_AUTHORIZED。即使其他扩展重新激活工具或模型发出陈旧调用，也不能访问未授权服务。模型自述“工具可用”不作为授权证据，验收以真实调用结果为准。

**现有产品限制保留**：普通 RPC 模式关闭知识库工具，知识问答模式又禁止 subagent。当前标准模式可获得 Memory 与独立模型工具继承；知识检索通道供同时授权 knowledge 和 subagent 的宿主/模式使用，并由真实 Pi 集成测试验证。若产品需要知识问答委派，须另行调整模式权限和 UX，不能通过 bridge 绕过。

活动工具不等于通用权限系统的完整策略。本次不声称继承交互 ask、文件沙箱或第三方权限门。只读也不等于无需授权，所以工作区和集合范围必须保留。

## 3. 上下文快照

不把会话级 workspaceId 或集合范围写进全局 process.env，避免同进程前台会话互相覆盖。

宿主生成内容寻址的默认入口：

`<agentDir>/octopus-child-entries/<sha256>.mjs`

入口仅包含子模块 file URL、agentDir、workspaceId、collectionIds、工具名称及组合代码。不包含 token、模型凭证、会话正文或数据库内容。Windows Node ESM 和 jiti 都使用 file URL；源码开发选择 .ts 模块，构建产物选择 .js。

同内容复用路径，范围变化生成新文件。requiredExtensions 将该绝对路径传给前台和后台，并由上游传递给后代。后台任务采用启动时快照。父会话 shutdown 不删除入口，以免仍在运行的 detached child 加载失败。

代价：范围变化会积累小型缓存文件，当前不自动 GC。仅在确认没有运行中子代理时可离线清理；不承诺任务跨构建升级加载兼容。这比环境变量多少量磁盘资源，但避免了跨会话串扰，也无需上游私有 API。

## 4. 组件与生命周期

```text
Octopus CLI/RPC 组合根
  └─ octopus-subagent-bridge（父 Pi 进程）
       ├─ session_start：加载 API、ensure agent、生成入口、注册双身份
       ├─ tool_call(subagent)：更新范围；注册失败阻断
       └─ session_shutdown：等待注册队列，注销所有身份
             │ requiredExtensions 快照
             ├─ 前台 AgentSession
             └─ detached runner ChildSession
                    └─ 无参 default entry
                         ├─ Knowledge 只读工厂 → loopback HTTP
                         └─ Memory 只读工厂 → 全局 SQLite
```

并发刷新串行化，相同身份和范围不重复注册。启动错误由 Pi 报告，委派前重试失败则 block。reload 新实例不依赖旧闭包。scheduled-task、task-tool-inspection 和旧式 subagent 进程角色不装配 bridge。

只使用 pi-subagents/required-child-extensions 公共 export，不导入 src/** 或操作上游 Symbol 注册表。jiti@2.7.0 为显式 runtime 依赖，加载安装包公开的 TypeScript 入口。

## 5. 只读入口与 agent 定义

### Knowledge

knowledge/extension/child-entry.ts 提供 createKnowledgeChildExtension，由生成的无参默认工厂组合。

- 复用 registerSharedKnowledgeTools，主会话与子会话使用相同的知识读取和 OCR、Embedding、Rerank 定义，保留 schema、输出和取消信号。
- createKnowledgeClient 明确 `autostart: false`、`globalWrite: false`、`modelAccess: invoke`。子代理可调用独立模型，但不能管理模型设置或取得全局知识写权限。
- workspaceId 来自宿主；scopeKnowledgeClient 限制集合列表、检索和引用读取。
- 工厂不读端点或连接服务；服务缺失、元数据损坏、连接失败只影响具体工具执行。
- 不注册写工具、模型管理工具或命令。

### Memory

memory/extension/child-entry.ts 同时提供独立默认入口和可注入 dataRoot 的测试工厂。

- createMemoryService({ readOnly: true })，目录由现有 resolveMemoryPaths 决定，与 agentDir 无关。
- 复用 memory_recall/memory_read，保留策略、引用验证和输出预算。
- agent_start 重置预算，session_shutdown 幂等 dispose。
- 不加载 command、curation、diagnostics 或自动初始化事件。
- 读取使用 openMemoryDatabase(directory, false)，即 readonly、fileMustExist、50ms busy timeout；Repository 按既有规则重试并关闭连接。
- 数据库缺失时返回现有空召回语义，不创建目录、数据库或迁移锁。
- 父会话同时允许 recall/read 时才允许执行完整 Memory 链路；未授权定义仅用于满足存在性预检。

### octopus-explorer

宿主管理 `<agentDir>/agents/octopus-explorer.md`，相同内容不重写，升级覆盖此保留名称。用户定制使用其他名称。

```yaml
name: octopus-explorer
description: Octopus 只读知识库与记忆检索；能力受父会话权限限制
systemPromptMode: append
inheritProjectContext: true
tools: read, grep, find, ls, knowledge_list_collections, knowledge_search, knowledge_read, memory_recall, memory_read
inheritSkills: false
```

requiredExtensions 不能被 agent 参数移除，但不会强行启用白名单外的工具。现有 delegate 不会自动获得新工具；模型须选择 explorer 或另一份显式列出工具名称的 agent，实际业务工具仍受父会话快照限制。

## 6. 测试与验收

默认回归：`packages/agent/test/subagent-child-tools.test.mjs`。

- 双身份注册、并发刷新、重复启动、切换和重复 shutdown。
- 安装失败和损坏范围时阻止委派。
- 真实 Pi ResourceLoader 加载入口，验证菜单和无 commands。
- 入口不可变、agent 定义升级覆盖。
- 知识集合越界及服务缺失不启动 daemon。
- 真实 Memory SQLite 读取、off 策略、缺失存储不初始化。

显式端到端测试：

```shell
node --test packages/agent/test/e2e/subagent-child-tools.test.mjs
```

要求安装 pi-subagents 0.68.0，可用 PI_SUBAGENTS_TEST_PATH 指定其 index.ts。测试使用隔离 agentDir、模型配置、知识服务端点和会话。本地 mock 模型驱动真实父 Pi 委派，覆盖前台和 detached runner，验证工具调用、workspaceId、集合范围、globalWrite 和返回证据。不使用真实模型服务，不修改用户正常配置。

focused 检查后执行相关 test、lint、typecheck、build；既有 apps/server/test/e2e/stop-session-real.test.mjs 作为取消行为回归。

### 首轮验收记录（2026-09-17，浏览器复测前）

- 新增 7 项默认回归通过，覆盖真实 Pi 资源加载、双身份注册、部分注册失败回滚、shutdown 竞态、并发资源生成与业务只读约束。
- 真实 Pi E2E 覆盖四种组合：知识库/仅 Memory 授权 × 前台/detached runner。覆盖工作流与直接 agent 委派；Memory 组合还强制尝试隐藏的 knowledge_search，要求原生工具不存在或 CHILD_TOOL_NOT_AUTHORIZED，且知识服务收到零请求。使用本地 mock 模型、隔离 HOME/USERPROFILE 和知识服务。
- 原有 stop-session-real 取消回归单独运行通过。
- pnpm build、pnpm lint、pnpm typecheck 通过。
- Agent 完整测试 305 项：304 通过、1 项真实模型集成测试按原配置跳过。Server 304 通过、1 跳过；Web 146 通过。
- 全仓 pnpm test 和串行 `pnpm exec turbo run test --concurrency=1` 均未全绿：CLI 原有 `apps/cli/test/runtimes.test.mjs:166` 的不可验证 knowledge-use 锁保留用例在套件中得到 removed、预期 unverified。该用例独立运行通过；本次未修改 apps/cli 的实现或测试，保留此失败记录。

### 浏览器复测后的修正

- 普通模式的直接前台委派复现了缺失知识工具导致整个子代理失败的问题，已改为稳定注册、活动菜单收窄、执行包装器拒绝的三层适配。
- 保留原子发布 agent 定义；Windows 并发读写目标时的 EPERM/EACCES/EBUSY 使用有界重试，若另一个父会话已发布相同内容则直接复用。
- 内置浏览器验证前台和后台的 Memory 实际调用、空召回和缺失引用结果、后台原生通知、未授权 knowledge_search 的真实拒绝、知识模式限制以及刷新后的状态恢复；没有借测试放宽知识模式权限。
- 修正后的 7 项定向回归、4 种真实 Pi E2E 组合，以及 Agent build/lint/typecheck 通过。知识库正向链路使用隔离 Pi 与本地 mock 服务验证。
- 最新 Agent 全量运行中，Scheduler 授权检查超时，生命周期用例长时间无输出后终止；这两个文件隔离串行复跑共 8 项全部通过。保留全量运行未完成/未通过的事实，不将隔离通过等同于全量稳定。

## 7. 参考

- [Pi Extensions](https://pi.dev/docs/latest/extensions)：生命周期、tool error 和 session replacement。
- [Pi Packages](https://pi.dev/docs/latest/packages)：扩展资源加载。
- pi-subagents 0.68.0 public required-child-extensions API，以及 child-launch、subagent-executor、async-execution 的身份传递链；内部源码仅核对，不用于生产导入。
- packages/agent/src/extensions/subagent-bridge/：注册与生成资源。
- packages/agent/src/extensions/knowledge/services/mode-policy.ts：集合范围约束。
- packages/agent/src/extensions/memory/lib/database.ts：实际只读数据库契约。

## 名称配置与共享入口

按 ADR-0060，已注册于共享入口的工具，在 subagent-bridge/contracts.ts 的 CHILD_TOOLS 中添加名称即可开放委派。该名单驱动父能力筛选、子工具注册和内置 octopus-explorer 工具列表，不再另写子执行实现。自定义 agent 的 tools 白名单仍需自行调整。

新增模块首先提供一次无交互的子入口，复用模块的共享工具注册函数并接收不可变上下文。不要自动装配父扩展的 command 或会话控制生命周期。独立模型工具不依赖知识模式或集合选择；子客户端不自动启动服务，服务未运行时返回 KNOWLEDGE_UNAVAILABLE。OCR 的原有本地文件读取与输入校验规则保持不变。

## 委派权限与诊断（ADR-0061）

父组合根与 bridge 共享 PermissionModeService。新子入口携带权限模式与有效配置快照，不携带临时人工批准。工具级 deny/ask 会被排除，每次执行还会复用父权限归一化和判定函数检查实际参数。ask 返回 CHILD_PERMISSION_REQUIRED，deny 返回 CHILD_PERMISSION_DENIED；未进入父快照的工具仍返回 CHILD_TOOL_NOT_AUTHORIZED。父权限变更仅影响之后的委派，不会撤销运行中快照。

使用 `/subagent-tools` 查看内置工具准入；`/subagent-tools ocr_image` 查看指定工具。eligible 仍需通过参数级校验，命令不检测特定子代理白名单或服务状态。权限配置损坏时直接报告错误。注册完整性检查会在子入口加载时报告缺失或重复定义。

## 启动复核与路径边界（ADR-0062）

权限快照 version=2 固定父 cwd；子相对路径先按子 cwd 解析，再按父边界判断外部访问。所有生成入口在注册工具前使用短期本机能力复核快照摘要，不能仅依赖 subagent 的 tool_call。过期入口被拒绝，父注册表同时刷新，重新委派使用新入口。父关闭后不能启动新的子任务或后代；已准入任务继续使用原快照。入口目录需保持私有，文件含本机启动能力令牌，不应公开或上传。该机制替代前文关于入口完全不含令牌、父退出后仍能启动新后代的描述。
