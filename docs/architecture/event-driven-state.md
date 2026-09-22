# 业务状态事件同步

业务状态不使用周期性 HTTP/RPC 查询。HTTP 保留为权威快照和命令入口，SSE/WS 负责告知何时同步。

## 职责边界

| 状态 | 变更拥有者 | 通知路径 |
| --- | --- | --- |
| 模型、凭据、默认选择 | ModelConfigMonitor，提交回调与原生目录监听 | model-config SSE；实例过期另发 sessions |
| 首条消息提交 | ConversationStartService 的统一 transition | conversation-starts SSE，按 Workspace 同步 |
| 认证交互 | ProviderAuthSession 的 revision 更新 | provider-auth SSE，不携带答案或凭据 |
| 附件进度 | AttachmentsService 的提交与任务完成 | attachments SSE |
| Memory | daemon 的数据库提交边界 | SDK 变更订阅 → memory SSE |
| 知识库 | daemon 的业务写入及 indexing runner | SDK 变更订阅 → knowledge SSE |
| 服务重启 | 跨 HTTP 实例存活的 Host | server-lifecycle SSE |
| 会话执行与统计 | 当前代际 Agent 事件 | 原有 WebSocket；统计在消息完成时失效 |
| 延后实例更新 | Runtime Coordinator | 安全条件改变时唤醒 DeferredRestarts |

所有浏览器失效规则集中在 `apps/web/src/queries/data-events-sync.ts`。页面只声明查询，不自行建立重复连接或刷新定时器。资源名定义在共享协议中；SSE 入口使用同一资源名单验证事件。ESLint 禁止业务代码重新引入 `refetchInterval`。

## 一致性与恢复

- 通知只带资源与作用域，不复制完整业务状态，也不传递密钥、认证答案或消息正文。
- 先订阅再发送 ready；每次连接/重连收到 ready 后同步一次当前活跃查询，补偿断线期间的变化。
- 连接失败可以退避重连，但不能在每次失败重连时重新拉取业务快照；仅成功 ready 和首次断开触发状态补偿。
- 变更到达时取消可能过期的读取并重新取快照；同步进行中收到变更，会保留一次后续同步，不能丢弃。
- 设置保存与外部原子文件替换使用同一个配置协调器；事件到达正在刷新时保留 dirty 标记。开始执行前仍按需复核配置。
- Memory/Knowledge 的 SDK 使用身份绑定的本地事件流。目录监听只观察服务发现和生命周期元数据，不监听 SQLite 文件推断业务写入，也不隐式启动服务。
- 延后重启不检查时钟：任务、交互与操作租约释放后，由运行时安全通知触发；仍使用原 runtimeId/epoch fence，不能误停新实例。
- 首条消息和重启状态的持久化/幂等边界保持不变，通知失败不能回滚已提交的数据。

## 允许的定时机制

连接心跳与失联看门狗、固定操作超时、已知到期时间的认证过期/任务重试，以及日志/上传清理和备份属于各自的生命周期职责。它们不得周期性拉取业务状态。Windows 文件共享锁与 SQLite 写入冲突可在 I/O 边界有限重试，失败仍须上报，不能借此实现业务状态查询循环。

附件队列在入队或任务结束时推进；遇到未来可运行时间，只安排该期限的一次唤醒。知识库在真实任务或模型配置变化后唤醒工作器；原有维护周期只清理资源。服务启动和停止等待原生元数据事件，并保持有界超时与 OS 锁的所有权检查。

## 新增业务的接入规则

1. 在拥有状态的业务模块提交后发出变更提示，异步任务也必须覆盖成功、失败和取消出口。
2. 在共享协议添加资源名，在组合根把业务通知接入现有通道。
3. 在统一 Query 同步入口指定作用域；页面不写订阅和轮询胶水。
4. 验证首次读取、写入通知、断线重连、同步期间再次变化、取消订阅及空闲时零业务请求。

升级后需重启已存活的 Memory/Knowledge daemon，使它们加载新增的 events 接口；SDK 不会为了建立观察订阅强制终止业务服务。
