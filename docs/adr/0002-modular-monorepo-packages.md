# ADR-0002: 采用 pnpm Monorepo 组织 Agent SDK 与多宿主

## Status

Proposed

## Context

Dr.Octopus 包含以下交付物：

- `@octopus/agent`：Agent SDK（CLI、Runtime、RPC Entry、扩展、基础设施安装）。
- `@octopus/server`：宿主后端服务。
- `@octopus/web`：Web Host 应用。
- `@octopus/desktop`（未来）：Desktop Host 应用。
- `@octopus/ui`：跨宿主共享 UI 组件。
- `@octopus/shared`：跨包共享类型与工具。

需要选择一种代码组织方式，既能保证能力复用，又能支持独立迭代与构建。

## Decision

采用 **pnpm workspace + Turborepo** 构建模块化单体 Monorepo。包结构如下：

```
packages/
  agent/      # Agent SDK，所有宿主依赖
  ui/         # 共享 UI 组件
  shared/     # 共享类型与工具
apps/
  server/     # 后端服务
  web/        # Web Host
  desktop/    # Desktop Host（未来）
```

关键规则：

1. `@octopus/agent` 是被依赖方，不得依赖 `apps/*`。
2. `@octopus/ui` 与 `@octopus/shared` 是公共基础，不得依赖 `apps/*` 或 `@octopus/agent` 中的 Node 专属能力。
3. `apps/*` 之间不直接依赖，只能通过 `@octopus/shared` 共享契约。
4. 所有构建、类型检查、测试通过 `turbo.json` 编排依赖顺序。

## Consequences

### Positive

- **能力复用**：自研扩展、infra 安装、RPC 协议实现只需写一次，CLI 与 Server 共用。
- **原子迭代**：一次 PR 可同时修改 SDK、Server 与 Host，保证契约同步。
- **依赖清晰**：pnpm workspace 与 `turbo.json` 强制构建顺序，避免循环依赖。
- **统一规范**：共享 ESLint、Prettier、TypeScript 配置，降低维护成本。

### Negative

- **仓库体积增大**：随着 Host 增多，CI 与安装时间可能变长。
- **权限与发布复杂度**：需要明确每个包的 public/private 属性与版本策略。
- **变更影响面扩大**：修改 `@octopus/agent` 可能同时影响 CLI 与 Server，需要更全面的测试。

### Neutral

- `@octopus/desktop` 尚未创建，但架构上已预留位置。
- `packages/ui` 使用 shadcn/ui 的管理方式，组件统一安装在 `packages/ui`。

## Alternatives Considered

### A1: 多仓库（Multi-repo）

- **做法**：每个包/应用独立仓库，通过 npm registry 或 git submodule 引用。
- **拒绝原因**：
  - Agent SDK 与 Server 迭代高度耦合，跨仓库同步成本高。
  - 本地开发与调试需要同时 checkout 多个仓库。
  - 共享类型与 UI 组件难以版本对齐。

### A2: 单仓库单应用（Single App）

- **做法**：所有代码放在 `src/` 下，不拆分 package。
- **拒绝原因**：
  - CLI、Server、Web 的构建目标与运行时差异大，单包会导致依赖污染（如 React 被 server 引用）。
  - 无法单独发布 `@octopus/agent` 作为 SDK。
  - 宿主代码与核心逻辑边界模糊，长期可维护性差。

### A3: Nx / Rush 替代 Turborepo

- **做法**：使用 Nx 或 Rush 管理 Monorepo。
- **拒绝原因**：
  - 项目已采用 pnpm，Turborepo 与 pnpm 集成轻量且社区成熟。
  - Nx 学习曲线与配置量更大，当前团队规模不需要其全部能力。
  - Rush 对 PNPM 与发布流程有较强侵入性。

## Trade-offs

以**单仓库的复杂性与构建协调成本**换取**跨宿主能力复用、统一规范与原子迭代**。在团队规模较小、交付物紧密耦合的情况下，Monorepo 是最优解。

## References

- [pnpm-workspace.yaml](../../pnpm-workspace.yaml)
- [turbo.json](../../turbo.json)
- [package.json](../../package.json)
- [Component Model](../architecture/component-model.md)
