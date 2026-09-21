# ADR-0029: 对 models.json 使用最小 JSONC 编辑和 staged Pi 验证

## Status

Accepted

## Context

Settings 需要创建自定义 Provider、配置 built-in/Extension Provider overlay，并管理模型定义与模型 override。`models.json` 是用户拥有的 Pi 配置文件，可能包含 Settings 第一阶段不公开的 compat、headers、samplingParams、cost、命令型 API Key、未来字段、行注释、尾逗号和个性化格式。

Pi 0.84.3 内部使用不可变 `ModelConfig` 快照，但该类型没有从 package root 公开导出，Octopus 不能依赖它。`ModelRuntime` 不监听文件变化；公开 `refresh()` 会重新读取 models.json，但对运行中 Agent Session 调用它会形成不符合第一阶段承诺的热变更。仅依赖 TypeScript DTO 校验也不够，因为部分错误只会在 built-in、models.json 和 Extension Provider composition 时出现。

现有 Onboarding repository 使用 `JSON.parse → JSON.stringify` 整体重写，只提供进程内模块级 queue。继续扩展该路径会丢失注释与格式，也不能可靠发现并发外部修改。

## Decision

1. `models.json` 继续作为唯一配置事实来源，不创建数据库镜像。
2. 所有 Settings 和 Onboarding mutation 统一通过 Agent SDK 的共享 `PiModelConfigDocumentRepository`。
3. Repository 使用 JSONC syntax-tree path edit，只修改目标字段或数组元素，保留未修改 bytes、未知字段、注释、属性顺序、BOM、EOL 和缩进。
4. 所有 mutation 必须提供基于 raw bytes SHA-256 的 ETag/`If-Match`；冲突不自动 merge。
5. 使用进程内 queue、Octopus 进程间 advisory lock、锁内 re-read 和 commit 前二次 revision 检查。
6. 候选内容先写入同目录 staged file，通过 package root 公开的无网络 candidate `ModelRuntime.create()`、Provider registration replay 和 `getError()` 验证后才 atomic replace；禁止 deep import `ModelConfig`。
7. commit 后从 canonical path 重建 Settings 控制面 Runtime，并以 snapshot swap 替换；不热修改运行中的 Agent Session。
8. 文件已提交但控制面 Runtime 重建失败时返回 committed-but-unsynced 部分成功，不自动回滚、不建议盲目重试。
9. `apiKey`、headers、compat 等未公开字段只保留，不回传、不通过通用 patch 写入；credential 继续由 Auth Session/Pi CredentialStore 管理。
10. 第一阶段 mutation API 使用严格 typed DTO，不提供 raw JSON editor。
11. 当前实施以仓库锁定的 Pi 0.84.3 公开导出和行为为权威；Pi `main` 只用于升级差异检查。不得将 `main` 中尚未进入锁定版本的字段或 API 混入当前契约。

## Consequences

### Positive

- 用户手工配置、未来字段、注释和格式不会因普通表单保存而被整体重写。
- Settings 与 Onboarding 不再有相互覆盖的独立写路径。
- ETag 可以在提交前发现大多数编辑器、CLI 和多窗口冲突。
- Pi schema 与实际 Provider composition 都在 commit 前验证。
- 控制面查询可以更新，同时保持“现有 Session 不热变更”的产品承诺。
- credential 和潜在敏感 header 不会进入 Web DTO。

### Negative

- JSONC syntax-tree edit、文件锁、staging 和 Runtime swap 比普通 JSON 写入复杂。
- 需要新的直接依赖和故障注入测试，不能借用 Pi 私有 parser/writer。
- 非协作外部 writer 不遵守 advisory lock，最后一次 revision 检查与 rename 之间仍有极小竞争窗口。
- post-commit Runtime rebuild 需要部分成功状态，调用方不能只处理成功/失败二分法。

### Neutral

- 新 Agent Session 继续从 canonical Pi 文件创建 Runtime。
- 高级配置仍可由用户手工维护；Settings 第一阶段只展示其存在状态。
- Provider/model ID rename 不作为原子 mutation，需由未来默认模型编排显式迁移。

## Alternatives Considered

- **`JSON.parse → merge → JSON.stringify`**：拒绝。会丢失注释、尾逗号、格式和局部文本稳定性，并扩大无关 diff。
- **只保存 Settings 已知 DTO**：拒绝。会删除高级、未来和第三方字段。
- **将模型配置迁移到数据库再生成 models.json**：拒绝。创建第二事实来源，增加 CLI/Web 漂移和恢复复杂度。
- **对运行中 Agent Session 调用 `ModelRuntime.refresh()`**：拒绝。虽然是公开 API，但会把全局配置热应用到现有 Session，违反第一阶段生效边界。
- **写后再验证，失败时回滚**：拒绝。无效文件会短暂暴露给新 Session；回滚还可能覆盖外部并发写入。
- **Server 自动三方 merge stale patch**：拒绝。Provider/model 数组、删除和 overlay 语义无法安全无提示合并。
- **只使用 advisory lock，不使用 revision**：拒绝。编辑器和 Pi CLI 未必遵守 Octopus lock。
- **每次 mutation 重启 Agent 服务**：拒绝。操作成本过高；控制面 Runtime snapshot swap 足以更新 Settings 查询，新 Session 自然读取新配置。

## Verification Requirements

1. Golden-file 测试证明目标编辑不改变无关 bytes、注释、未知字段和 EOL。
2. literal/env/command `apiKey` 与 header values 不进入 DTO、日志或错误。
3. Settings 与 Onboarding 使用同一 Repository、queue 和 revision 协议。
4. stale `If-Match` 在写入前返回 412，原文件不变。
5. staged candidate 分别通过 Pi schema 和 built-in/Extension composition 验证。
6. 所有 commit 前故障保持 canonical file 不变且清理临时文件。
7. commit 后 Runtime swap 成功时查询读取新快照，现有 Agent Session 保持旧状态。
8. post-commit rebuild 失败返回 committed-but-unsynced，客户端先 refetch 而非盲目重试。
9. 新 Agent Session 从 canonical path 读取新配置。
10. 非协作 writer 的剩余竞争窗口在实现说明与升级审查中持续保留。
11. Pi 版本升级前比较 `model-config`、`provider-composer` 和 `ModelRuntime` 的公开契约，更新 fixture 后才可改变 authoring 子集或 composition 语义。

## References

- [Settings models.json Mutation 详细设计](../architecture/settings-model-config-mutations.md)
- [Settings 模型服务详细设计](../architecture/settings-model-providers.md)
- [ADR-0027](./0027-pi-model-runtime-authoritative-provider-management.md)
- [ADR-0028](./0028-host-owned-provider-auth-sessions.md)
- [Pi `packages/ai` main](https://github.com/earendil-works/pi/tree/main/packages/ai)
- [Pi `packages/coding-agent` main](https://github.com/earendil-works/pi/tree/main/packages/coding-agent)
- [Pi v0.84.3 Model Config](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/src/core/model-config.ts)
