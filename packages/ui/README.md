# @octopus/ui

Octopus 的共享 React UI 包，提供 shadcn/ui 基础组件、通用 Hooks、样式工具和主题样式。目前由 `apps/web` 消费，通过 pnpm workspace 引用，不单独发布到 npm。

## 目录与导出

包入口由 [package.json](./package.json) 的 `exports` 定义，直接指向源码：

| 导入路径                   | 对应文件                 | 用途                               |
| -------------------------- | ------------------------ | ---------------------------------- |
| `@octopus/ui/components/*` | `src/components/*.tsx`   | shadcn/ui 基础组件                 |
| `@octopus/ui/hooks/*`      | `src/hooks/*.ts`         | 通用 React Hooks                   |
| `@octopus/ui/lib/*`        | `src/lib/*.ts`           | 工具函数，例如合并样式类的 `cn`    |
| `@octopus/ui/globals.css`  | `src/styles/globals.css` | Tailwind、字体、主题变量及基础样式 |

没有定义包根入口，请按子路径导入，不要使用 `import { Button } from '@octopus/ui'`。

## 使用方式

消费方在 `package.json` 中声明 workspace 依赖，并在仓库根目录执行 `pnpm install`：

```json
{
  "dependencies": {
    "@octopus/ui": "workspace:*"
  }
}
```

按需导入组件和工具：

```tsx
import { Button } from '@octopus/ui/components/button';
import { cn } from '@octopus/ui/lib/utils';
```

在应用的全局 CSS 入口引入共享样式：

```css
@import '@octopus/ui/globals.css';
```

现有接入可参考 [Web 样式入口](../../apps/web/src/index.css) 和 [Vite 配置](../../apps/web/vite.config.ts)。消费方需要支持 TS/TSX 转换、React 和 Tailwind CSS 处理；新增应用时也需要确认 Tailwind 的源码扫描覆盖应用及本包组件。

## 为什么不生成 dist

`exports` 只负责声明导入路径对应哪个文件，不负责编译，也不要求目标必须位于 `dist`。

例如，`@octopus/ui/components/button` 会解析到 `src/components/button.tsx`。随后由消费方 `apps/web` 的 Vite 转换 TypeScript 和 JSX：开发时按需转换，生产构建时将使用到的 UI 代码打包进 `apps/web/dist`。

因此，本包把编译工作交给消费方，不需要单独生成 `packages/ui/dist`，也没有 `build` 脚本。TypeScript 直接从源码获取类型；本包的 `typecheck` 使用 `tsc --noEmit`，只检查类型，不生成文件。

### 与 @octopus/shared 的区别

| 对比     | `@octopus/ui`       | `@octopus/shared`         |
| -------- | ------------------- | ------------------------- |
| 消费方   | 当前为 Web 应用     | Web、Server、Agent 和 CLI |
| 导出内容 | TS/TSX 源码和 CSS   | `dist` 中的 JS 和类型声明 |
| 编译责任 | 由 Web 的 Vite 处理 | 包自身通过 `tsc` 编译     |
| 独立构建 | 不需要              | 当前配置下需要            |

当前 Server 和 Agent 使用 `tsc` 编译，再由 Node 运行生成的 JS。`tsc` 不会像 bundler 一样把依赖包合并进产物，因此 `shared` 预先输出 JS 和 `.d.ts`，符合现有构建、运行及发布流程。

这里的“编译”是将 TypeScript 转成 JavaScript；“打包”是将入口和依赖组织成 bundle。`dist` 只是惯用的输出目录名，并不代表其中的文件一定经过打包。

**当前约定：UI 保持源码导出，shared 保持 dist 导出，无需统一两者的 exports。** Node 消费的包也可以采用源码导出，但前提是消费方构建时包含这些源码，或运行时配置相应的 TypeScript 加载支持。

## 组件维护

遵循本目录的 [AGENTS.md](./AGENTS.md)：

- `src/components/` 是通过 shadcn/ui CLI 安装的共享基础组件，不直接手改，也不手动复制上游组件源码。
- 优先使用组件已有的 props 和 variants；通过 `className` 调整布局，通过应用或功能层包装组件实现业务定制。
- 业务状态、请求和流程放在消费方，避免基础组件与应用业务耦合。
- 共享主题修改会影响所有消费方，需要在实际应用中检查效果。

从仓库根目录安装官方组件，例如：

```bash
pnpm dlx shadcn@latest add button -c packages/ui
```

CLI 配置见 [components.json](./components.json)，当前使用 `base-nova` 风格和 Lucide 图标。更新已有组件时先查看差异，避免直接覆盖本地内容。

## 开发与验证

以下命令均在仓库根目录执行：

```bash
pnpm --filter @octopus/web dev
pnpm --filter @octopus/ui lint
pnpm --filter @octopus/ui typecheck
```

Web 开发服务可用于查看组件效果；首次启动前需准备好其他依赖包的构建产物，例如 `@octopus/shared`。本包无需单独启动编译监听。

本包当前没有独立的 `test` 脚本。修改共享 UI 后，除静态检查外，还应在消费方验证受影响的页面和交互。
