# ADR-0012: 提取 Server Runtime 内部基础库

## Status

Accepted

## Context

`apps/server/src/modules/sessions` 原先同时包含 HTTP 业务用例、Web Session Catalog、Pi Session JSONL 访问、RPC 命令、事件投影和多进程 runtime 生命周期。这使 Sessions Module 同时承担业务接口与底层运行时基础设施职责，并让 runtime 文件反向引用具体的 `SessionsRepository` 和模块类型。

runtime 能力仍然是 Server Host 的内部实现，不计划发布为跨 package SDK，但其进程、Lease、Pi 持久化和事件状态不应由业务 Module 物理拥有。提取时必须继续保持 ADR-0005、ADR-0008、ADR-0010 和 ADR-0011 的身份、离线派生及操作租约不变量。

## Decision

1. 将 Server Host 的 runtime 基础设施放在 `apps/server/src/lib/runtime`，文件统一使用简洁的 kebab-case，不使用 Modules 的点后缀角色命名。
2. `lib/runtime` 拥有 Pi Session 持久化、RPC response 解析、命令执行、事件投影、进程编排、Lease、Admission、Registry、Retirement 和 runtime 契约，并通过 `index.ts` 提供唯一公共导出面。
3. `lib/runtime` 不得导入 `apps/server/src/modules`。需要更新 Web Session Catalog 时，通过构造参数回调报告命令成功、命令完成和消息活动。
4. 离线派生只由 runtime 返回 Pi Session 身份、路径和可选 prefill；Web Session ID、Workspace 归属、标题和 Catalog 写入仍由 Sessions Module 决定。
5. `apps/server/src/modules/sessions` 仅保留 controller、DTO、业务 service、Catalog repository、业务组合类型和 DTO 映射。
6. 本决策只修订 ADR-0005 第 6 条的物理所有权；每个驻留 Session 一个 RPC 子进程、不可变 binding、单写 Lease 和 operation lease 等行为不变。
7. runtime 内部实现继续从具体文件导入；只有 `lib/runtime` 外部消费者通过 `index.ts` 导入，避免 barrel 参与内部依赖环。
8. `types.ts` 只保留共享数据契约；runtime 行为由 `SessionRuntimeCoordinator` 和持有 operation lease 的 `SessionRuntimeOperation` 具体类表达，不再维护平行的行为接口。

## Consequences

### Positive

- runtime 基础设施不再反向依赖 Sessions Module，依赖方向保持单向。
- Pi Session 文件操作和进程生命周期可以脱离 HTTP/Catalog 业务独立测试。
- Sessions Module 的职责收缩为业务权限、Catalog 和对外用例编排。

### Negative

- command 和 event projection 需要显式回调端口，组合根接线比直接调用 repository 多一层。
- 原有测试和架构文档必须随文件路径迁移。

### Neutral

- runtime 仍位于 `apps/server`，不会成为公共 package，也不承诺跨宿主稳定 API。
- Pi RPC 线协议和 `@octopus/agent/rpc` 进程管理 API 不变。

## Alternatives Considered

### 仅移动文件并保留对 SessionsRepository 的引用

拒绝。这样会形成 `lib/runtime -> modules/sessions` 的上层反向依赖，只改变目录而没有建立基础库边界。

### 将 runtime 提取到新的 workspace package

暂不采用。当前只有 Server Host 使用这些 Catalog 绑定与进程策略，创建公共 package 会过早扩大兼容性和发布成本。

### 将命令和事件投影继续留在 Sessions Module

未采用。它们的 runtime 状态机和 RPC 语义属于同一基础能力；Catalog 副作用已经通过回调留在业务层。

## References

- [ADR-0005: 由 Host 按驻留 Session 编排 RPC 子进程](./0005-host-owned-session-runtime-processes.md)
- [ADR-0008: 在不可变 runtime 外离线派生 Session](./0008-immutable-runtime-session-derivation.md)
- [ADR-0010: Workspace Web Session Catalog](./0010-workspace-web-session-catalog.md)
- [ADR-0011: Session runtime operation leases](./0011-session-runtime-operation-leases.md)
