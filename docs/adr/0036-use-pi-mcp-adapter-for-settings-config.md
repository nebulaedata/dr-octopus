# ADR-0036: 以固定版本 Pi MCP Adapter 作为 Settings MCP 配置语义权威

## Status

Accepted

## Context

Dr.Octopus 已通过 `extensions-install.ts` 固定安装 `pi-mcp-adapter@2.31.0`，但 Settings 的 MCP 页面仍是占位页。adapter 自身定义了多层配置发现、优先级、Server 合并、disabled 覆盖、Agent Plugin 和 Host import 语义。若 Server/Web 重新解析这些文件，会产生与 Agent Runtime 不一致的第二套规则。

Settings 又是 user-scope 控制面，不能隐式编辑当前 Workspace 的项目文件。adapter 的 Session 状态事件只描述具体运行实例，不能直接代表 Settings 所在 Server Host 的连通性。

## Decision

1. `pi-mcp-adapter@2.31.0` 的公共 `config` export 是 MCP 配置读取、合并和 provenance 的语义权威。
2. `apps/server` 直接依赖固定版本的 `pi-mcp-adapter@2.31.0`，并静态导入其公开的 `pi-mcp-adapter/config` 子路径；不查找 Agent 用户扩展目录，也不修改 `packages/agent`。
3. 调用 adapter 同步 config API 时，把 Server 显式 `agentDir` 通过短生命周期环境桥传给 adapter 并立即恢复；环境覆盖不得跨越异步边界。
4. Settings 首版只管理 user scope，并只写 Pi global `<agentDir>/mcp.json`；共享全局和 imported 来源只读或通过最小 `disabled` override 控制。
5. Dr.Octopus 为 Pi global 文件提供保留未知字段的原子 mutation，因为 adapter 2.31.0 没有公开完整 CRUD Repository。
6. 配置 DTO 是 secret-free Host projection，不向 Web 返回 raw `McpConfig` 或 `ServerEntry`。
7. Settings 配置状态与 Session 运行状态分离。组件加载后调用独立 POST，由 Server Host 使用同一份有效配置建立短生命周期 MCP Client 连接并调用 `tools/list`，投影 `connected/failed/needs_auth/disabled`；该结果不代表 Agent Runtime。
8. mutation 使用 idempotency、revision precondition、进程内串行队列、原子 rename 和写后重读；跨进程仍明确为 last-writer-wins，不声明虚假 CAS。
9. mutation 只影响新建 Agent Runtime，响应固定返回 agent restart effect。
10. 探测采用 Server + revision 粒度的 single-flight、短缓存、并发和超时上限，且不返回原始远端错误或 secret；首次加载全量探测，单项 mutation 后只重测目标 Server。

## Consequences

### Positive

- Settings 与 Agent Runtime 使用同一套 adapter 配置语义。
- 不复制配置 precedence、import 和 provenance 规则。
- Settings GET 保持本地、只读、无外部进程和网络副作用；主动探测由 POST 明确隔离。
- Web 不接触 MCP secret 或第三方原始配置结构。
- adapter 升级影响由固定版本和 contract tests 暴露。

### Negative

- Agent Runtime 和 Server 各自安装同一固定版本的 adapter；升级时必须同步更新两个版本声明。
- adapter 未公开 delete/CAS，Dr.Octopus 仍需维护很小的 Pi global 文档 mutation。
- 独立探测会短暂启动 stdio Server 或建立远程连接，并可能与 Agent Runtime 的实际状态不同。
- 外部 Host 与 Server 同时写文件时只能检测部分冲突，无法提供跨进程强 CAS。

### Neutral

- `packages/agent` 继续只负责扩展安装与 Agent Runtime，不拥有 Settings 配置适配。
- Project scope MCP 管理留给未来 Workspace 功能。
- Runtime status 将来可以从带 runtime identity 的 Session 投影独立增加。
- Server 名称不做原地 rename，以保持 adapter credential 绑定语义明确。

## Alternatives Considered

**Server 自行解析所有 MCP 文件**

- 拒绝：会复制且漂移 adapter 的 precedence、merge、import 和 provenance 规则。

**复用 Agent 用户扩展目录中的 `pi-mcp-adapter`**

- 拒绝：Server 需要借助 Pi SettingsManager 和 PackageManager 查找用户安装目录，增加 Settings Host 对 Agent 扩展安装状态和目录布局的运行时耦合。

**通过 TUI `/mcp` 命令驱动 Settings**

- 拒绝：命令面向交互式 Session，不是稳定的 Host 配置 API。

**Settings 同时编辑 user 与 project scope**

- 拒绝：违反已接受的全局 Settings 边界，并缺少显式 Workspace identity。

**GET 时连接所有 Server 得到实时状态**

- 拒绝：读取操作会产生子进程、网络、OAuth 和凭证副作用。

**直接复用 Agent Runtime 状态**

- 拒绝：Runtime 可能未启动、使用旧 revision 或属于不同 Session，不能回答当前 Server Host 是否可连接。

## Verification Requirements

1. Server 可从自身依赖树静态加载 `pi-mcp-adapter/config`，且 Server 与 Agent 扩展声明固定为同一版本。
2. 配置 fixture 与 adapter 2.31.0 的有效合并结果一致。
3. GET 路径不连接 Server；POST probe 对 disabled Server 跳过，并保证连接关闭、并发和超时有界。
4. secret 永不进入 DTO、日志、错误或 Web Query cache。
5. mutation 保留未知字段并验证 stale revision、idempotency 和写后状态。
6. source capability 决定 edit/remove/toggle，不由 Web 猜测。
7. probe 按 Server + revision 合并并短期复用；单项 mutation 不重新探测或遮蔽其他 Server 的结果。

## References

- [Settings MCP 服务器配置设计](../architecture/settings-mcp-servers.md)
- [外部 Pi Package 安装与配置生命周期](../architecture/pi-package-lifecycle.md)
- [ADR-0026](./0026-global-settings-and-pi-resource-management.md)
- [ADR-0033](./0033-unify-settings-http-mutation-contract.md)
