# ADR-0031: 在 Runtime 临时降级时保留全局默认模型意图

## Status

Accepted

## Context

Pi 把 user-scope 默认 Provider 和 Model 成对保存在 `settings.json`。新 Session 会优先解析这组配置；如果模型不存在或 Provider 未配置认证，Pi Runtime 可以临时选择其他可用模型。恢复 Session 则优先使用 Session 自己记录的模型。

Settings 需要处理认证移除、本地服务离线、动态 catalog 暂时缺失、Provider/Model 删除和 Extension 禁用。若把每次 Runtime fallback 自动保存为全局默认，暂时故障会永久覆盖用户选择；若允许确定性删除当前默认资源，又会制造长期悬空引用。

Pi v0.84.3 的 `findInitialModel` 和内置 Provider 推荐顺序不是 root package 的完整公共策略契约。Octopus 不应复制或 deep import 该算法来预测具体 fallback 目标。

## Decision

1. 全局默认模型的唯一持久真相是 Pi user-scope `settings.json` 的 `defaultProvider/defaultModel` pair。
2. Settings 通过 `SettingsManager.create(..., { projectTrusted:false })` 读取和写入，避免 Workspace/project 配置影响全局控制面。
3. 保存前只接受 Pi `ModelRuntime` 当前能精确解析、认证已配置且在本地 availability snapshot 中可用的模型。
4. 当前 Session 不因 Settings 保存而切换；新 Session 使用全局默认；恢复 Session 优先自己的模型。
5. 默认项暂时不可用时，Pi 可以在 Session 创建时临时 fallback，但 Settings 不持久化 fallback，也不预测具体 fallback 目标。
6. 认证或 Runtime 恢复后，原默认项自动恢复为后续新 Session 的首选。
7. 确定性移除默认 Provider/Model 的 mutation 必须被 `DEFAULT_MODEL_DEPENDENCY` 阻止，要求用户先显式选择 replacement。
8. logout、endpoint 变更或网络离线属于可逆不可用，允许操作并警告影响，不清空默认配置。
9. replacement 与删除不伪装成跨 `settings.json/models.json/package settings` 的原子事务；顺序为先保存 replacement，再重试删除。
10. PUT 使用 Pi `SettingsManager` 的字段合并和锁，采用显式 last-writer-wins 与写后确认，不承诺 Pi 公共 API 无法原子保证的 CAS。

## Consequences

### Positive

- 临时认证、网络和 catalog 故障不会永久改变用户意图。
- 恢复服务后无需再次设置默认模型。
- 当前、新建和恢复 Session 的模型语义与 Pi 原生生命周期一致。
- 删除 Provider、Model 和 Extension 使用同一依赖策略，避免悬空引用。
- 不依赖 Pi 内部 fallback 排序，升级耦合更低。
- 删除流程的部分成功方向安全：可能多保留资源，不会先破坏默认引用。

### Negative

- 默认项不可用时，Settings 不能承诺新 Session 将 fallback 到哪个模型。
- 用户删除默认资源前必须多完成一次显式 replacement 操作。
- 跨进程同时修改默认 pair 时采用 last-writer-wins，不能提供严格 CAS。
- credential logout 后页面会保留一个 `auth_required` 默认项，需要用户理解“配置”和“当前可用”不同。

### Neutral

- 首次安装仍允许没有默认模型；首期 UI 不提供清空已设置默认项。
- Settings PUT 不执行网络 verify 或 completion。
- Session 内模型切换仍由 Session 自己拥有。

## Alternatives Considered

- **自动把 Runtime fallback 保存为新默认**：拒绝。短暂离线或认证过期会永久覆盖用户选择，并把 Pi 临时策略变成 Settings mutation。
- **维护显式备用模型列表**：延期。Pi 当前没有对应 user Settings 契约，会引入 Octopus 自有路由层和更多故障语义。
- **复制或 deep import `findInitialModel`**：拒绝。该内部排序不是首期公共稳定契约，升级时容易漂移。
- **删除默认资源时自动选择第一个可用模型**：拒绝。选择不可预测，也没有用户授权。
- **把 replacement 与删除做补偿事务**：拒绝。涉及多个文件和 Runtime，无法可靠回滚；先 replacement 后删除已有安全单向性。
- **认证移除时阻止 logout**：拒绝。用户必须能撤销 credential，且认证不可用通常可恢复。
- **为 PUT 声明 ETag 强 CAS**：拒绝。Pi 公共 `SettingsManager` 没有原子 compare-and-set，不能提供虚假保证。

## Verification Requirements

1. global default 不受 project scope 覆盖。
2. ready 和各不可用状态按统一 policy 判定。
3. 新 Session fallback 不修改 settings.json，恢复后重新使用原默认项。
4. 当前和恢复 Session 不被 Settings 保存强制切换。
5. Provider、Model、overlay 和 Extension 删除依赖均有阻断测试。
6. logout/endpoint 变更允许但返回影响提示。
7. replacement 失败不删除；replacement 成功后删除失败不回滚。
8. SettingsManager flush error 和写后不一致不能报告成功。
9. 不导入 Pi 私有源码或复制默认模型排序表。

## References

- [Settings 默认模型详细设计](../architecture/settings-default-model.md)
- [Settings 模块架构设计](../architecture/settings-module.md)
- [Pi v0.84.3 SettingsManager](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/src/core/settings-manager.ts)
- [Pi v0.84.3 Model Resolver](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/src/core/model-resolver.ts)
- [Pi v0.84.3 SDK Session Creation](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/src/core/sdk.ts)
