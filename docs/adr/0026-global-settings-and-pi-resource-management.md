# ADR-0026: 全局 Settings 与 Pi 资源级扩展管理

## Status

Accepted

## Context

Dr.Octopus 需要新增统一 Settings 模块。该模块首期负责模型服务、默认模型和第三方 Pi Extension 配置，其他设置条目先提供占位页面。

现有 Workbench 以 Workspace 和 Session 为导航边界，但模型凭证、默认模型和 Pi user-scope Package 配置属于全局 Agent 状态。Settings 仍需复用 Workbench 的应用外壳、主 Sidebar 和 Header；从 Workbench 打开时还应保留当前页面作为背景语境。其内部导航是 Settings feature 的二级导航，不代表 Workspace 所有权。

Pi Package 可以同时包含 Extensions、Skills、Prompt Templates 和 Themes。Pi 原生 `pi config` 以单个资源为管理单位，通过 `PackageSource` 中对应资源类型的 `+path` 和 `-path` 过滤器持久化。Package 本身没有通用 `enabled` 字段。

过滤状态、缺失 Package、批量集合防漂移、查询无副作用和 Runtime 生效语义进一步由
[ADR-0032](./0032-use-pi-native-extension-resource-overrides.md)约束。

## Decision

1. Settings 的业务所有权独立于 Workspace 和 Session，仍是全局控制面。
2. `/settings/*` 是可直接访问的 canonical Workbench 子路由，负责分享、新标签页和刷新后的确定性兜底。
3. 从 Workbench 内打开 Settings 时，使用 TanStack Router route mask：实际 location 保留背景 route 并用经过校验的 search state 驱动 Settings Dialog，地址栏投影为对应的 canonical `/settings/*`。
4. masked navigation 设置 `unmaskOnReload: true`；Dialog 内部切页和 Provider 选择使用 replace，关闭使用 history back，保证一次返回恢复打开前的 Workbench。
5. Settings Dialog 与 canonical Settings Layout 复用同一个 SettingsFrame 和业务页面，不创建第二套 UI 或第二个顶层 `SidebarProvider`。
6. 第一阶段 Settings 只管理 Pi user scope；Project scope 配置未来由 Workspace 功能负责。
7. Extension entrypoint 是扩展设置的最小管理单位。
8. Package 只作为 Extension 资源的来源、分组和批量操作边界，不增加 Octopus 私有 Package enabled 状态。
9. Extension 状态通过 Pi 原生 `PackageSource.extensions` 过滤器持久化：显式启用写入 `+path`，显式禁用写入 `-path`。
10. Extension 操作不得修改同一 Package 的 `skills`、`prompts`、`themes`、`autoload` 或其他未知字段。
11. Package 的“全部启用”和“全部禁用”必须展开为其 Extension entrypoints 的资源级 mutation。
12. 读取使用 Pi 公共 `DefaultPackageManager.resolve(missing => 'skip')`，确保只读查询不安装缺失 Package；写入使用公共 `SettingsManager`。不得导入 Pi 内部 ConfigSelector。
13. 第一阶段不热重载当前 Agent Runtime。Extension 变更明确标记为 reload 或 restart 后生效。
14. 遵循 ADR-0022 的配置所有权：Server 组合根注入 `config.agentDir`，Settings 业务层不得调用 `getAgentDir()` 或从 Server 数据根推导 Agent 路径。
15. 遵循 ADR-0023 的领域协议边界：Settings HTTP Schema 位于 `@octopus/shared/protocol/settings`，不在 Web 与 Server 重复声明 transport DTO。

## Consequences

### Positive

- Web Settings 与 Pi `pi config` 使用同一配置模型，可以双向读取和修改。
- 一个 Package 中的多个 Extension 可以独立启停。
- Extension 开关不会意外关闭同包 Skills、Prompts 或 Themes。
- 不需要第二份数据库、迁移逻辑或配置双写。
- Settings 的全局所有权与 Pi user-scope 配置一致。
- Workbench 的主导航、主题入口和移动端交互保持连续，不出现第二个顶层应用壳。
- 从 Workspace 或 Session 打开 Settings 时，背景页面不卸载，关闭后可精确恢复上下文。
- canonical URL 与 route mask 分工明确，模态体验不牺牲分享、刷新和直接访问。

### Negative

- Extension UI 需要 Package 分组和 entrypoint 列表，比单一 Package Switch 更复杂。
- Pi 当前没有公开的单资源 toggle 方法，Octopus 需要基于公开 Settings 契约实现同等合并算法。
- Pi 升级时必须重新验证过滤、scope、deduplication 和 resolve 语义。
- Project scope 的三态 `inherit | load | unload` 不能在全局 Settings 中直接管理。

### Neutral

- Package 安装、更新和卸载仍由已有 Package 生命周期能力负责，不进入首期 Settings。
- 已运行的 Session 和 Runtime 保持稳定，不会因 Settings mutation 中途改变工具集合。

## Alternatives Considered

- **为 Package 增加统一 `enabled` 字段**：拒绝。Pi 不识别该字段，也无法表达同包多个 entrypoint 的不同状态。
- **关闭 Package 时写入 `extensions: []`**：不作为规范操作。它能表达全部关闭，但不能保留或展示原生的资源级显式状态。
- **关闭整个 Package**：拒绝。会连带影响同包 Skills、Prompts 和 Themes。
- **直接导入 Pi 内部 ConfigSelector**：拒绝。该实现不是公开 API，会把 Dr.Octopus 绑定到 Pi 内部文件结构。
- **通过子进程启动交互式 `pi config`**：拒绝。TUI 交互不适合作为 Web 后端 API，也不能提供稳定结构化结果。
- **在全局 Settings 同时管理 project scope**：拒绝。复用 Workbench 外壳不改变 Settings 的 user-scope 业务所有权，当前页面仍缺少显式的项目配置上下文和信任边界。

## Verification Requirements

1. Web 禁用单个 Extension 后，Pi `resolve()` 必须报告该资源为 disabled。
2. Web 重新启用后，Pi `resolve()` 必须报告该资源为 enabled。
3. `skills`、`prompts`、`themes`、`autoload` 和未知 PackageSource 字段保持不变。
4. Package string form 转 object form 后，source identity 保持不变。
5. 混合启停 Package 能正确报告 enabled count 和每个 entrypoint 状态。
6. Package 批量操作的最终结果等价于逐项执行资源 mutation。
7. `pi config` 产生的配置能够被 Web 正确读取，Web 产生的配置能够被 Pi 正确解析。
8. 测试使用临时 agentDir，不读写用户真实 Pi/Dr.Octopus 设置。

## References

- [Settings 模块架构设计](../architecture/settings-module.md)
- [Settings Extension 资源管理详细设计](../architecture/settings-extensions.md)
- [ADR-0022](./0022-global-runtime-data-root.md)
- [ADR-0023](./0023-domain-organized-shared-protocol.md)
- [ADR-0032](./0032-use-pi-native-extension-resource-overrides.md)
- [外部 Pi Package 安装与配置生命周期](../architecture/pi-package-lifecycle.md)
- [Pi Packages](https://pi.dev/docs/latest/packages)
- [Pi Extensions](https://pi.dev/docs/latest/extensions)
