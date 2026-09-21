# ADR-0020: 单一权威 Permission Gate

## Status

Accepted

## Context

Octopus 在开发环境中曾同时加载内置 `octopus-permission-system` 和
`@gotgenes/pi-permission-system`。两个扩展都会监听 `tool_call`，导致同一次工具调用出现两次权限审批；Web
选择的 `ask | auto | full` 只控制内置服务，无法约束旧扩展。产品尚未发布，不存在需要迁移的用户数据。

同时，`auto` 不能把所有未知扩展工具一概放行，但需要允许 `ask_user_question` 等已知低风险工具免去额外的权限确认。

## Decision

1. `octopus-permission-system` 是 Agent Runtime 中唯一可以产生权限审批的门禁。
2. 默认扩展安装列表、发布配置和开发基线均不包含 `@gotgenes/pi-permission-system`。
3. 不实现旧数据迁移；Agent 启动不为此读取、卸载 package 或改写用户 `settings.json`。
4. 不读取或改写 `pi-subagents` 配置，不修改 `PermissionSelect` 文案。
5. `auto` 规则使用精确工具名的 `allow | ask | deny` 映射。`ask_user_question`、
   `plan_mode_question`、`plan_mode_complete`、`subagent` 和 `bg_wait` 是内置默认 allow；未知工具保持 ask。
   context-mode 当前发布的 11 个 `ctx_*` 工具也按精确名称默认 allow；不得使用前缀匹配让未来工具自动继承权限。
6. 配置按 Builtin Defaults → Global Config → Trusted Project Config 合并。敏感输入、显式 deny 以及 auto
   模式下的外部路径优先于工具 allowlist。
7. Permission 模式切换复用 Pi JSONL RPC：Server 发送 `prompt` 命令
   `/permission-mode <ask|auto|full>`，由内置扩展通过 `pi.registerCommand()` 注册的 handler 更新当前
   `PermissionModeService`。`AgentRpcProcess` 继续只负责 Pi RPC 数据收发、请求关联、超时和进程生命周期，
   不增加 Permission 分支、第二套 pending map 或 Node IPC 通道。
8. Server Runtime 持有当前 process generation 的权限状态镜像。只有 slash command RPC 成功后才更新镜像；
   新进程 generation 固定把 Agent 和 Server 状态同时恢复为 `ask`。
9. 内置门禁默认开启结构化 Permission Review Log，只记录 `permission_request.*` 权限请求转换，
   不记录 Session、配置解析或其他生命周期事件。每个 Agent 进程独占
   `<octopusRoot>/permission-system/logs/permission-review.<startedAt>-<pid>-<instanceId>.<segment>.jsonl`
   分片，单段达到 5 MiB 后切换到下一编号分段；已关闭分段最多保留 4 个且总计不超过 20 MiB，
   存活进程的最新活动分段不参与历史清理。日志对敏感键递归遮罩，对每个字符串字段设置默认
   1000 字符上限，并在门禁异常时记录 `gate_error` 后强制阻断。
10. 注册模型可见的只读 `permission_audit_query` 工具，以有界结构化筛选代替任意路径读取。工具默认返回最新
    20 条、最多 100 条匹配记录，支持按请求、Session、工具、resolution、事件和时间下界查询。工具自身默认
    静态 allow 以避免递归审批，但读取行为仍写入 Review Log；显式用户策略可以覆盖为 `ask` 或 `deny`。

## Consequences

### Positive

- 每次工具调用最多产生一个权限审批。
- Web 权限模式与实际执行门禁共享同一权威状态。
- 低风险工具可以按名称扩展 auto allowlist，未知插件工具仍保持最小权限。
- 后续可以按 requestId、Session、模式、工具和 resolution 查询授权历史，不依赖前端或当前进程内存。
- 发布基线只有一套门禁，不需要长期维护两套策略实现或桥接 authorizer。
- 进程基础设施不感知 Permission 业务，所有请求共用 Pi JSONL RPC 的关联、超时和代际隔离。
- Permission 切换使用 Pi 官方扩展命令入口，不再维护 Octopus 私有子进程控制协议。

### Negative

- 开发和发布配置必须保证旧权限扩展不被安装，否则仍会形成双门禁。
- Slash command 只返回 `prompt` 命令是否被 RPC 接受，不返回结构化 Permission 状态；Server 需要维护同一
  generation 内的确定性镜像。
- Pi 会把扩展 command handler 的异常发布为 `extension_error`，但仍把该 slash command 视为已处理。本实现的
  handler 只接收 Server 已校验的闭集 mode，并执行同步内存赋值，因此当前不存在可失败的业务分支；若将来加入
  持久化或异步副作用，必须升级为能表达结构化失败的公开协议能力。
- 项目配置只有在 Pi 信任项目后才生效，未信任项目只能使用全局策略。
- Review Log 可能包含命令和工具参数摘要；敏感键遮罩不会检测嵌在普通字符串中的秘密，因此该文件仍应视为敏感审计数据。

### Neutral

- 权限模式仍属于 runtime generation，新 Agent 进程恢复为 `ask`。

## Alternatives Considered

- 启动时自动卸载旧扩展并改写 settings：拒绝，因为产品尚未发布，没有老数据迁移需求，运行时不应承担一次性开发环境清理。
- 运行时过滤旧扩展但保留 settings：拒绝，因为发布基线应直接排除旧包，不应维护无用户价值的兼容分支。
- 注册 authorizer 并继续使用旧扩展：拒绝，因为会保留外部 Runtime 依赖以及两套策略演进边界。
- 所有 custom 工具在 auto 下自动批准：拒绝，因为未知扩展工具可能访问网络、文件或外部系统。
- 在 `AgentRpcProcess` 暴露 `getPermissionState()` / `setPermissionMode()`：拒绝，因为会让进程生命周期与
  数据收发基础设施依赖具体业务能力，并把 Permission readiness 错误地并入 Pi RPC readiness。
- 使用独立 Node IPC Host Control envelope：拒绝，因为 Pi 的 `registerCommand()` 与 `prompt` RPC 已覆盖该同步、
  进程内的模式切换；第二套请求关联和 pending 生命周期没有提供额外正确性。

## References

- [Permission System 设计](../architecture/octopus-permission-system.md)
- [ADR-0004](./0004-workspace-pi-extension-control-plane.md)
- [ADR-0007](./0007-web-control-and-realtime-protocol.md)
