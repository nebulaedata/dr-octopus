# ADR-0052: 按配置路由显式上报变更并手动重启会话

## Status

Accepted — 已实现（2026-09-15）。自动化验证通过，浏览器人工验收受工具认证故障影响尚未完成；验证范围见主设计第 9 节。

## Context

Settings 保存模型服务等配置后，已驻留的 Pi RPC 进程仍可能保留旧状态。进程内热更新需要刷新协议、模型重新绑定和运行时安全边界，当前采用用户主动重启即可满足应用新配置的需求。

用户要求轻量检测：只处理接口写入流程，集中按配置路由控制模块是否参与提醒。会话顶部展示配置变化并提供重启按钮，左侧 Session item 菜单也允许主动重启。

## Decision

1. Server 持有 RuntimeConfigChanges，以稳定配置路由作为模块标识，首期名单仅保留 `/settings/model-providers`；不做实际请求 URL 自动匹配。
2. 模型业务流程确认提交后调用 `ModelConfigChanges.recordCommitted()`，由模型薄适配封装路由并委托通用模块的 `record(route)`。Service 不写路由字符串、不操作名单、版本或 SSE。普通模型配置 unchanged、查询、测试、未提交失败及幂等重放不触发；Pi 确认的凭据重新写入允许保守提醒，不为消除此提醒比较密钥。异步 OAuth 共用模型入口，由唯一所有者上报，提交后同步失败或交互取消不撤销提交事实。
3. Fastify 插件只管理实例、注入和订阅生命周期，不按 HTTP method/status 推断变化。装配层向业务流程提供模型窄接口，并连接通用通知与 runtime。模型适配层不持有会话状态，通用模块不引用模型业务及 Coordinator；提交判断仍归业务边界，不封装保存、刷新与通知的通用 mutation 包装器。
4. 使用内存 revision 和各路由最后变更版本；进程记录启动基线，提醒由版本派生，覆盖本 Server 所有已有受管会话。不引入配置通知 scope 参数或 Workspace 版本表，不监听文件、不轮询、不保存事件历史或数据库版本表。会话访问与重启仍校验 Workspace 权限。
5. 权限、环境变量、扩展、MCP 等其他模块均不参与通知、不接入上报，业务功能及原有配置生效规则保留，菜单主动重启仍可使用。全局默认模型和会话权限模式操作不触发提醒。未来扩展名单须先确认旧进程配置滞留问题及提醒收益。
6. 业务 SSE 只提示 Session 查询失效，HTTP 提供权威状态；Conversation 沿用现有 WebSocket 和 runtime registry。不开辟新推送通道。
7. 两个 Web 入口共用重启操作。Coordinator 经 Slot 完整编排停止和从原会话文件恢复；运行中须确认中断，保持代际隔离、幂等与生命周期互斥，不自动重放任务。
8. 新进程读取当前配置和环境，前端展示实际恢复状态。进程内临时状态不保证保留，停止/启动失败保留历史并可重试。

详细接口、触发矩阵、职责和验收见[配置变更提醒与手动重启会话](../architecture/session-config-restart.md)。

现有 void 保存接口、Channel 旧 binding 缓存和底层停止等待均有实施缺口。精确 DTO、错误、Host 超时封锁以及显式重新订阅见[实施契约及审查记录](../architecture/session-config-restart-contracts.md)；不得将文档目标误认为现成可调用能力。

## Alternatives

- 进程内模型热刷新：协议和一致性成本较高，当前不采用。
- 文件监听或轮询：超出用户要求的接口检测范围，不采用。
- HTTP onResponse 自动检测：成功响应不能区分实际变更，且无法准确覆盖异步认证提交，不采用。
- 每个 Controller 自行通知会话：重复过滤、版本和广播逻辑，增加模块耦合，不采用。
- Service 直接使用路由字符串上报：使业务调用点了解通知标识，通过模型专用薄适配集中封装。
- 通用保存/刷新/通知包装器或模块适配基类：隐藏不同提交语义，并为未接入模块增加抽象成本，不采用。

## Consequences

- 名单与版本逻辑集中，已有模块检测开关只需改名单；新模块通过薄适配和实际提交边界接入，不改模型业务及通用算法。
- 模型业务只依赖 `recordCommitted()` 窄接口，便于独立测试提交时点；接受一个小适配模块的成本以集中路由映射，不增加其内部状态。
- 状态有界且无新持久化设施，通知中不携带配置值或凭据。
- 直接编辑文件不会自动提醒；仍可通过菜单手动重启。
- 配置过期只提示，用户可选择继续当前任务；重启会中断未完成工作并结束进程临时状态。
- 当前只覆盖本 Server 的受管会话，不承诺跨 Host 或多 Server 实例同步。
- 预计只修改 Server、Web 和共享协议；Agent 核心变更仍须按仓库规则单独确认。

## References

- [ADR-0016: Stable Session Runtime Slots](./0016-stable-session-runtime-slots.md)
- [ADR-0033: Settings HTTP Mutation 契约](./0033-unify-settings-http-mutation-contract.md)
- [ADR-0040: 业务数据 SSE](./0040-business-data-sse.md)
- [ADR-0047: 分作用域环境配置](./0047-scoped-environment-settings.md)
