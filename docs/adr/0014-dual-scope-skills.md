# ADR-0014: 双作用域 Skills 与 Workspace 路由继承

## Status

Accepted（有效目录与受管目录的边界、Runtime 权威查询和未运行预解析由 [ADR-0015](./0015-effective-skills-catalog.md) 修订）

## Context

ADR-0013 交付了 User（全局）作用域的 Skills 管理：Server 直接读写 `<agentDir>/skills`，Web 页面挂在应用级 `/skills` 路由。产品需求演进为：

1. 技能页面路由必须继承 Workspace 路由（`/workspaces/:workspaceId/skills`），技能管理发生在明确的 Workspace 上下文中。
2. Skills 按 `workspace.cwd` 区分两个作用域：全局 Skills（对所有 Workspace 生效）与 Workspace Skills（仅对当前 Workspace 生效），两个作用域都需要完整的上传、编辑与删除能力。

在实施前调研了 `packages/agent` 当前锁定的 `@earendil-works/pi-coding-agent@0.84.1` 的 Skills 机制是否满足该需求，结论如下：

- **双目录机制原生存在。** Pi 在 Session 启动时同时发现 User 作用域（`<agentDir>/skills`）与 Project 作用域（`<cwd>/.dr-octopus/skills`）的 Skills，后者正好落在每个 Workspace 的工作目录内。
- **Project 作用域受 Project Trust 门禁约束。** 当 `<cwd>/.dr-octopus/` 下存在 settings.json、extensions、skills 等任一资源时，Pi 要求该目录被信任才会加载这些资源。交互式 CLI 会向用户询问；而 Octopus 的 RPC 子进程没有 UI，`resolveProjectTrusted()` 默认返回 `false`，Workspace Skills 会被静默跳过。
- **Trust 是目录级的全量授权。** 通过 `ProjectTrustStore`（`trust.json`）或 `--approve` 预先信任 Workspace，不仅放行 Skills，还会放行 Project 级 extensions（可执行代码）、settings 与 prompts。Agent 本身对工作目录拥有写权限，预先信任会把「提示注入诱导 Agent 写入恶意扩展」升级为「下一次会话启动即执行任意代码」，属于不可接受的安全降级。
- **`resources_discover` 扩展事件提供了外科手术式的替代通道。** Pi 在 Session 启动与 reload 时向 InlineExtension 派发 `resources_discover` 事件，扩展可返回 `skillPaths` 追加 Skill 目录；该通道不受 Project Trust 门禁约束，且只追加资源路径、不引入任何代码执行面。扩展路径在 User 路径之后合并，同名 Skill 以先加载的 User（全局）为准；按真实路径去重，未来用户交互式信任同一 Workspace 时不会重复加载。
- **Octopus Workspace 扩展已经存在于每个会话。** CLI 与 RPC 子进程都经由 `runOctopusCli` 装配 `octopus-workspace` 扩展（见 ADR-0004），在其上注册 `resources_discover` 处理器即可覆盖所有会话入口，无需改动 Pi 源码或新增包。

因此 Pi 的 Skills 机制满足需求，只需一处小型扩展集成。

## Decision

1. **双作用域模型。** 全局 Skills 继续存放于 `<agentDir>/skills`；Workspace Skills 存放于 `<workspace.cwd>/.dr-octopus/skills`（`CONFIG_DIR_NAME` 公开导出，与运行时目录常量保持一致）。文件系统仍是唯一事实源，不引入数据库 Catalog，运行中的 Session 不做热更新。
2. **Server API 按路由继承拆分作用域。** 全局路由（`/api/skills`、`/api/skills/:name`、`/api/skills/upload`）保持 ADR-0013 的契约不变；新增 Workspace 路由 `/api/workspaces/:workspaceId/skills`、`/api/workspaces/:workspaceId/skills/:name`、`/api/workspaces/:workspaceId/skills/upload`，语义、校验、限额与错误码与全局路由完全对齐；两个作用域的列表响应都附带 `root`（该作用域的绝对 Skills 目录），供页面展示真实文件位置。`SkillsService` 注入 `WorkspacesService`（与 `SessionsService` 相同的兄弟 Service 依赖先例），由 `resolve(workspaceId)` 得到 `cwd` 后推导 Skills 根目录；DTO 不携带 scope 字段，作用域由路由位置表达。
3. **运行时加载走扩展事件，不预授权 Trust。** `octopus-workspace` 扩展新增 `extension/events.ts`，注册 `resources_discover` 处理器：当 `<event.cwd>/.dr-octopus/skills` 目录存在时返回其作为 `skillPaths`，不存在时返回空结果以避免诊断噪音。不写 `trust.json`、不追加 `--approve`，代码执行面保持为零。该 ADR 原先约定的同名冲突展示已由 ADR-0015 修订：Web 不再自行推断优先级，以 Pi 有效目录为准。
4. **Web 路由继承 Workspace。** 移除应用级 `/skills` 路由（该路由与本次改动同属一个未发布的功能周期，不保留重定向），新增 `workspaces/$workspaceId/skills` 作为 Workbench 布局的子路由，与 Session 路由（`workspaces/$workspaceId/sessions/$sessionId`）保持相同的兄弟路由模式；同时提供 `workspaces/$workspaceId/sessions/$sessionId/skills` 变体，从 Session 上下文进入时把 Session 保留在 URL 中，使侧边栏选中态与「聊天」返回入口不丢失。Header「技能」菜单按当前上下文导航到对应变体，无 Workspace 时禁用。
5. **页面按作用域双分区。** 技能页自上而下分为「工作区技能」（主区，仅当前 Workspace 生效）与「全局技能」（次区，所有 Workspace 生效）两个 Section；单一搜索框同时过滤两个分区。新建与上传对话框携带作用域选择（默认当前工作区），详情、编辑、删除按卡片所属作用域调用对应路由的 API。TanStack Query 缓存键按作用域分层（`['skills','global']` 与 `['skills','workspace',workspaceId]`），mutation 只失效对应作用域前缀。
6. **扩展实现遵循 Inline Extension 开发指南。** `events.ts` 只做 Pi 事件到路径计算的适配，目录存在性检查为轻量基础设施逻辑；默认导出与命名工厂都注册事件；按指南补齐 ExtensionAPI stub 的注册契约测试与行为测试。

## Consequences

### Positive

- Workspace Skills 经由公开扩展事件加载，不触碰 Project Trust，不扩大任何代码执行面，安全姿态与现状一致。
- 管理面（Server API）与运行面（Pi 加载）读写同一目录，页面展示与 Agent 实际可用能力一致；坏 Skill 的诊断同样来自 Pi Loader。
- 全局与 Workspace 两个作用域共享同一套 Service、校验与上传管线，行为完全对称，认知与维护成本低。
- 交互式 CLI 与 RPC 会话获得一致的 Workspace Skills 语义；未来用户在 CLI 中信任某 Workspace 后，真实路径去重保证不会重复加载。
- 路由继承让技能页天然携带 Workspace 上下文，Header 菜单、侧边栏与文件浏览器的状态保持连贯。

### Negative

- 同名冲突时全局 Skill 覆盖 Workspace Skill（Pi 合并顺序决定），用户需要页面提示才能理解生效结果。
- Workspace Skills 目录位于用户项目内，Server 的写入与项目内其他工具（版本控制、格式化器）共享同一目录，需维持既有的路径与 zip 校验纪律。
- 已运行的 Session 仍不感知 Skills 变更，页面提示文案需要覆盖两个作用域。

### Neutral

- Workspace 被删除或其 `cwd` 不可达时，对应作用域返回空列表并附带诊断，不影响全局作用域。
- ADR-0013 的 User 作用域实现（Store、上传管线、校验工具）原样复用，仅 Service 入口增加作用域解析；ADR-0013 的状态更新为被本 ADR 部分修订。

## Alternatives Considered

### 预写 `trust.json` 授权 Workspace（ProjectTrustStore）

拒绝。Trust 是目录级全量授权，会同时放行 Project 级 extensions（可执行代码）与 settings；Agent 对工作目录有写权限，预先信任把提示注入升级为会话启动即执行任意代码。为「加载 Skills」付出「全量信任」的代价不成比例。

### 启动 RPC 子进程时追加 `--approve`

拒绝。与预写 trust.json 等效的安全问题，且授权发生在进程参数层，缺少持久化审计痕迹，撤销与排障都更困难。

### 通过 `--skills` CLI 参数注入 Workspace Skills 目录

未采用。该通道同样绕过 Trust，但要求 Server 在每次拉起子进程时计算并传递目录参数，把 Workspace 布局知识从 `packages/agent` 泄漏到 `apps/server` 的进程编排层，且交互式 CLI 入口无法覆盖；扩展事件方案在两个入口语义一致，知识内聚。

### 维持仅全局作用域，Workspace Skills 由文件浏览器维护

拒绝。产品需求明确要求双作用域的引导式管理；文件浏览器不具备 Skill 校验、frontmatter 编辑与上传解包能力，体验与全局管理面不对称。

## References

- [ADR-0004: Workspace 作为 Pi Extension 与进程内 SDK](./0004-workspace-pi-extension-control-plane.md)
- [ADR-0013: Server 托管的 User Skill 管理](./0013-user-skills-management.md)
- [Agent Inline Extension 开发指南](../../packages/agent/src/extensions/README.md)
- Pi 公开类型：`ResourcesDiscoverEvent` / `ResourcesDiscoverResult`（`@earendil-works/pi-coding-agent` 扩展类型导出）
