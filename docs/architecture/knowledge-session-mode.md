# 普通 Session 中的知识问答模式

2026-09-11 更新。此方案替代独立知识问答 Session，用户已授权实施。

## 1. 所有权与边界

知识问答是现有 Pi Session 的工作模式，沿用会话身份、历史、附件、取消、重试、草稿预热、RPC Process 和通知。不存在新的 Session kind、SDK 实例池、QA WebSocket 协议或问答数据库。

`packages/agent/src/extensions/knowledge` 拥有模式切换、集合配置、工具激活、提示词和 Skill；工具只连接既有共享知识后台。Server 的普通 runtime command 层转发命令，并把 Agent 状态投影给 Web。LanceDB、元数据 SQLite、解析任务、MCP 和 Settings 模型配置保持原所有权。

同一会话仍加载其他扩展。知识模式通过工具允许列表、tool_call 拦截和每轮提示词约束模型行为，并不提供进程/资源隔离；用户安装的可信扩展仍有原有宿主能力。若以后需要处理不可信扩展，应另行设计隔离，不能把本模式宣称为沙箱。

## 2. 控制与状态

知识库与 Scheduler 使用一致的服务命令层级：系统终端分别执行 `octopus knowledge service start|stop|restart|status` 和 `octopus scheduler service start|stop|restart|status`；TUI 分别执行 `/knowledge service start|stop|restart|status` 和 `/scheduler service start|stop|restart|status`。Scheduler 原有任务管理与授权命令保留，生命周期控制不注册为模型工具。知识库旧的省略 `service` 写法作为兼容别名保留。

以下完整问答控制由 RPC 提供给 Web 等应用端。交互式 TUI 仅管理知识库服务，不注册知识库工具、不加载问答模式或恢复其历史状态。TUI 仅支持 `/knowledge service start|stop|restart|status`，移除问答 `on/off/config` 和顶层 `status`。命令按需调用同一 Agent profile 的服务生命周期 SDK：`start` 显式启动，`stop` 停止并抑制自动启动，`restart` 重启，`status` 查询状态与本地健康检查（不启动服务、不请求模型）。命令注册本身不加载生命周期实现或启动服务；模型配置和知识问答请到其他应用端使用。

| 控制                                     | 行为                                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| `/knowledge on`                          | 空闲且无排队消息时进入；与 Plan 使用 `workflow:mutex:v1` / `agent-workflow` 互斥 |
| `/knowledge off`                         | 恢复进入前工具；保留当前会话模型，不改权限模式                                   |
| `/knowledge status`                      | 投影当前 Agent 状态，无模型调用                                                  |
| `/knowledge config {"collectionIds":[]}` | 校验并更新来源配置；空集合表示自动匹配                                           |

使用版本化 custom entry `octopus-knowledge-mode` 保存当前分支状态，以及内部工具恢复快照。公开投影仅包含 version、enabled、collectionIds，不包含内部恢复工具。历史条目中的 model、effectiveModel、restoreModel 字段在解析时忽略，不触发模型切换。

Pi 在首次 assistant 消息之前可能尚未刷写 JSONL，因此 RPC 通过 `setStatus` 同时发布当前状态，Server 不能仅凭磁盘旧条目判定刚完成的切换。初次 bootstrap 若尚未捕获通知，依据命令目录主动发送一次 status 读取。运行时重建后由 Agent 从当前分支恢复并重新发布；Server 清理旧 generation 的缓存。Web 的 pending 状态保留到对应控制请求 ack，不能被中间 off/config 通知清除。未发布首页草稿仍遵守普通 Session 的生命周期，不另设持久化机制。

Web 沿用 `agent.set-work-mode`，可携带 `knowledge` 配置；Server 将互斥模式切换拆为当前模式退出、配置、目标模式进入，再读回 Agent 投影。任一步失败不宣称目标已生效。Plan 已完成待确认时保留原退出确认。知识扩展还通过互斥协议防止 CLI `/plan start` 绕过页面控制。

切换期间不接收新的模式修改；执行或队列未清空时 Agent 拒绝。恢复时发现互斥冲突，必须阻止继续回答并提示用户修复或退出。

## 3. 模型与作用域

回答始终使用当前 Session 模型，通过已有会话模型选择器修改。知识模式不保存模型覆盖、不监听模型选择事件，也不在来源配置、进入、退出或分支恢复时切换模型。模型选择和恢复由普通 Session 统一管理；Server 和 Web 使用普通会话模型状态。

OCR、Embedding、Reranker 仍只在 Settings → 知识库配置，使用后台配置与索引快照。回答模型不复用 Embedding/OCR 的 endpoint，也不由 Server 构造第二个模型运行时。

集合为空时，智能体先读取当前 workspace 与全局可见集合，根据名称、描述和问题选择；明显匹配直接检索，确有歧义时用普通回复反问。集合非空时，工具客户端限制列出、检索、读取和导入范围，不能靠提示词约定越界。远程集合使用统一列表中的挂载 ID。租户/workspace 权限仍由后台验证。

## 4. Tools 与 Skill

进入时激活 8 个知识工具：list_collections、search、read、create_collection、add_text、import、import_attachment、job_status（均以 knowledge_ 为前缀）。正常问答只用前三个；写入工具仅在用户明确要求保存资料时使用，并继续经过现有权限系统。普通 Agent 模式不激活这些工具。所选集合非空时禁止创建新集合绕过范围。

内置 `skills/knowledge/SKILL.md` 维护集合选择、证据检索、有限补检索、引用、无证据回答和附件入库指引。模式直接注入 Skill 正文，无需开放文件读取工具让模型发现 Skill。工具和领域校验负责硬约束，Skill 负责使用策略。

每轮系统提示明确知识问答、仅用知识工具、旧历史仅作背景、结论来自本轮证据。文档内容视为不可信资料。检索失败与无命中分别呈现；不添加第二次模型调用修复引用。

## 5. 普通会话前端

同一 Composer 提供 Agent / Plan / 知识问答切换。知识模式显示来源 Badge、来源设置入口和已有模型选择器。Dialog + ToggleGroup 切换自动/指定，Tabs 区分工作区/全局，Command 筛选本页，分页保留跨页选择。草稿不因模式切换丢失。

检索工具卡从 `details.hits` 展示文档标题、位置和有界证据片段，Dialog 展示引用 ID。历史引用展示的是检索时快照，不声称源文档仍可访问；实时读取使用 knowledge_read 再次校验。错误和未知结果保留普通 ToolContent 回退。

附件继续经普通 Session 上传、Host 引用和知识导入工具处理；后台保存独立原文所有权，删除会话附件不删除知识文档。

## 6. 删除与历史

删除原 `modules/knowledge-qa`、`features/knowledge-qa`、专用 HTTP/WS 客户端、Qa 协议类型、独立首页与路由以及隔离运行时测试。历史 JSONL 不删除。先前实验版本 SQLite 表和 kind 列只作为历史归档保留，不进入新问答协议、不新增 QA 记录，也不再参与会话路由；避免用代码清理隐式删除用户数据。

## 7. 验证重点

验证同一 Session 身份和历史、普通模式工具不激活、Plan 双向互斥、idle/队列限制、来源修改和模式切换保留当前会话模型、退出恢复工具、刷新和 branch 恢复忽略历史模型覆盖、选定范围强制校验、远程引用、附件入库、普通会话与 Scheduler 回归。浏览器检查桌面/窄屏、键盘、错误状态、来源选择与引用展开。
