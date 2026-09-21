# ADR-0003: 通过 packages/ui 提供跨宿主共享 UI 组件

## Status

Proposed

## Context

Dr.Octopus 需要同时支持 Web Host 与 Desktop Host。两者在视觉与交互上应保持一致，但构建目标不同：

- Web Host：React + Vite，运行在浏览器中。
- Desktop Host：React + Electron，运行在桌面窗口中。

如果每个宿主独立维护组件，会导致视觉风格、交互逻辑、可访问性实现分叉，长期维护成本极高。

## Decision

在 `packages/ui` 中统一维护基于 **shadcn/ui** 的通用组件库，供 `apps/web` 与 `apps/desktop` 共享。

规则：

1. 所有 shadcn/ui 组件必须通过官方 CLI 安装到 `packages/ui`：
   ```bash
   pnpm dlx shadcn@latest add <component> -c packages/ui
   ```
2. 禁止在 `apps/*` 中手写与 `packages/ui` 重复的原子/分子组件。
3. `packages/ui` 只包含通用组件、样式、工具与 Hooks；宿主专属业务组件留在 `apps/*` 中。
4. 组件必须同时支持 light 与 dark 主题。

## Consequences

### Positive

- **视觉一致性**：Web 与 Desktop 使用同一套设计系统。
- **维护效率**：组件 Bug 修复与样式更新只需修改一处。
- **官方兼容**：shadcn/ui 基于 Radix UI，可访问性与键盘交互有保障。
- **易于扩展**：新增 Host（如移动端 PWA）可直接复用组件库。

### Negative

- **包依赖复杂度**：`apps/web` 与 `apps/desktop` 都需要正确配置 `tailwind.config` 与 CSS 变量以消费 `packages/ui`。
- **版本耦合**：shadcn/ui 升级或主题变更会同时影响多个 Host，需要统一回归。
- **构建配置要求**：需要确保 Vite/Electron 能正确解析 `packages/ui` 的 import 路径与样式。

### Neutral

- `packages/ui` 目前处于早期，组件数量较少，需要随业务迭代逐步补充。
- Desktop Host 尚未创建，但组件库已为其预留。

## Alternatives Considered

### A1: 每个宿主独立维护组件

- **做法**：`apps/web` 与 `apps/desktop` 各自安装 shadcn/ui。
- **拒绝原因**：
  - 重复组件导致样式与行为分叉。
  - 一个组件的修复需要在多个应用间同步。
  - 无法保证跨宿主一致性。

### A2: 使用第三方完整设计系统（如 Material UI、Ant Design）

- **做法**：放弃 shadcn/ui，采用成熟组件库。
- **拒绝原因**：
  - shadcn/ui 提供可定制、无运行时依赖（按组件）的优势，更适合本地优先工具类产品。
  - Pi TUI 已经具有鲜明风格，shadcn/ui 更容易与之保持一致的简洁美学。
  - 第三方库的样式覆盖与打包体积控制更复杂。

### A3: 将 UI 组件放在 packages/agent 中

- **做法**：Agent SDK 同时导出 UI 组件。
- **拒绝原因**：
  - `@octopus/agent` 是 Node 运行时 SDK，不应依赖 React 或浏览器能力。
  - 违反包职责边界，造成循环依赖风险。

## Trade-offs

以**构建配置与版本协调成本**换取**跨宿主一致性与长期维护效率**。对于需要同时支持 Web 与 Desktop 的产品，共享组件库是标准做法。

## References

- [packages/ui/package.json](../../packages/ui/package.json)
- [packages/ui/components.json](../../packages/ui/components.json)
- [AGENTS.md](../../AGENTS.md)
- [Component Model](../architecture/component-model.md)
