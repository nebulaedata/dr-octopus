# ADR-0032: 使用 Pi 原生 Extension 资源 override 作为唯一开关状态

## Status

Accepted

## Context

Pi Package 可以同时包含 Extensions、Skills、Prompt Templates 和 Themes。Package 本身没有通用 enabled 字段；Pi 使用 `PackageSource.extensions` 的普通 include、`!pattern`、精确 `+path` 和精确 `-path` 计算 Extension 是否加载。

Settings 需要提供常见的开关和 Package 批量操作，但必须与 `pi config` 双向兼容，不能关闭同 Package 的其他资源。还需要处理用户手写复杂 filter、缺失 Package、当前 Runtime 已加载 Extension、第三方代码安全和默认模型由 Extension Provider 提供的依赖。

Pi v0.84.3 提供 `DefaultPackageManager.resolve()` 和 `SettingsManager`，但没有公开的单资源 toggle 或 Package filter CAS API。`resolve()` 未提供 missing callback 时可能安装缺失 Package，因此不能直接用于只读 Web 查询。

## Decision

1. Extension entrypoint 是唯一持久开关单位；Package 只负责来源、分组和批量操作。
2. `PackageSource.extensions` 是唯一持久真相，不增加数据库或 `package.enabled` 字段。
3. 单项启用/禁用复现 Pi v0.84.3 `pi config` 的精确 `+path/-path` mutation；每次只修改目标 Package 的 `extensions`。
4. DTO 同时返回 `configuredEnabled` 与 `configuration=default|enabled|disabled`；`default` 表示没有精确 override，不保证有效状态为 enabled。
5. “恢复遵循包筛选”只删除目标精确 `+/-` override，保留普通 include、`!pattern` 和显式空数组。
6. Package 批量启用/禁用展开为当前已发现 entrypoints 的一次候选 mutation，并要求客户端提交完整 resource ID 集合防止 package update 漂移。
7. GET 调用 `DefaultPackageManager.resolve(async () => 'skip')`，缺失 Package 只展示，不自动安装、更新或执行代码。
8. 只管理 user-scope `origin=package` 的 Extension；project、temporary、top-level 和 built-in InlineExtension 排除。
9. Mutation 使用 SettingsManager 字段合并、进程内串行和写后 resolve；跨进程 last-writer-wins，不声明公共 API 无法保证的 CAS。
10. 当前 Runtime 不热卸载。响应描述 current runtimes unchanged、restart Agent required，不用全局 boolean 冒充 active state。
11. 禁用唯一提供当前默认 Provider 的 entrypoint 时，通过 extensionPath provenance 返回 `DEFAULT_MODEL_DEPENDENCY`；无法证明时只警告，不猜测。
12. Package 安装、更新、卸载及“一键清空全部 Extension filter”延期。

## Consequences

### Positive

- Web 与 `pi config` 共享同一原生持久格式。
- 一个 Package 的多个 Extension 可以独立管理。
- Skills、Prompts、Themes、autoload 和未知字段不会被开关误改。
- 复杂 filter 的有效状态和精确 override 状态不会混淆。
- GET 不产生意外安装、网络写入或第三方代码执行。
- 批量操作对 package update 漂移和默认模型依赖有明确保护。

### Negative

- UI 不能只使用简单 Package switch，需要展示 mixed 和资源明细。
- `default` 资源可能仍被 structural filter 禁用，产品文案必须解释“遵循包筛选”。
- Pi 没有公开 CAS，Web 与 CLI 同时修改 packages 时仍是 last-writer-wins。
- 禁用后的 Extension 在当前 Runtime 中继续运行直到重启。
- provenance 缺失时无法确定所有 Provider 依赖，只能警告。

### Neutral

- 缺失 Package 保留在列表中但不可切换。
- local package source 仍是受支持的 user Package 类型。
- 首期不管理其他 Pi resource type。

## Alternatives Considered

- **Package 级 enabled 字段**：拒绝。Pi 不识别，且不能表达同包 entrypoint 混合状态。
- **批量禁用写 `extensions:[]`**：拒绝作为规范开关。会抹平资源级意图和用户现有 filter。
- **禁用时移除整个 PackageSource**：拒绝。会影响 Skills、Prompts、Themes，并混入卸载语义。
- **调用交互式 `pi config` 子进程**：拒绝。TUI 不是稳定结构化 Web API。
- **import Pi 私有 ConfigSelector**：拒绝。私有 UI 实现不是公共 API。
- **GET 直接调用无 callback 的 resolve()**：拒绝。缺失 npm/git Package 可能被自动安装。
- **执行 Extension 获取名称和能力**：拒绝。列表查询不应运行任意第三方代码。
- **所有 configuration=default 都显示 enabled**：拒绝。普通 include、`!` 和 `[]` 可以使它有效禁用。
- **热卸载当前 Runtime**：延期。Extension 可能拥有工具、事件、Provider 和长生命周期资源，需要完整 shutdown/reload 协议。
- **严格 ETag/CAS**：拒绝。Pi 公共 SettingsManager 没有 packages compare-and-set，不能承诺虚假原子性。

## Verification Requirements

1. Pi filter 的 omit、empty、include、exclude、force include/exclude 和 autoload fixture 全覆盖。
2. Web mutation 与 Pi v0.84.3 `pi config` 双向兼容。
3. 单项、reset 和批量只改变目标 `extensions`，其他字段全部保留。
4. GET 缺失 Package 时不会安装、更新或访问网络。
5. batch resource set 漂移返回 409，不触发部分写入。
6. SettingsManager errors 和 post-resolve mismatch 不报告成功。
7. current Runtime 保持不变，响应和 UI 明确 restart required。
8. 默认模型 dependency、多来源 Provider 和 unknown provenance 均有测试。
9. 所有路径都进行 package-root containment 和跨平台规范化校验。
10. 测试只使用临时 agentDir，不修改用户真实 Settings。

## References

- [Settings Extension 资源管理详细设计](../architecture/settings-extensions.md)
- [Settings 模块架构设计](../architecture/settings-module.md)
- [ADR-0026](./0026-global-settings-and-pi-resource-management.md)
- [Pi Packages](https://pi.dev/docs/latest/packages)
- [Pi v0.84.3 Package Manager](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/src/core/package-manager.ts)
- [Pi v0.84.3 Config Selector](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/src/modes/interactive/components/config-selector.ts)
