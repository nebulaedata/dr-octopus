# ADR-0034: 分离 TypeScript 类型检查与构建输出配置

## Status

Accepted

## Context

Server 与 Shared 的默认 `tsconfig.json` 继承根配置中的 declaration、declarationMap 和 sourceMap，但没有声明 noEmit 或 outDir。包脚本虽然使用安全的 `tsconfig.build.json`，直接对包目录运行 `tsc -b` 仍会选中默认配置，并把 JavaScript、声明及 Source Map 输出到源文件旁边。

构建入口不应依赖调用者记住配置文件名；编辑器和类型检查配置也不应具备写入源码树的能力。

## Decision

1. `apps/server` 与 `packages/shared` 的默认 `tsconfig.json` 固定启用 `noEmit`，只承担编辑器分析与类型检查。
2. 默认配置启用 incremental，并把 typecheck build info 写入包内 `node_modules/.tmp`。
3. `tsconfig.build.json` 继承默认配置，只在自身显式关闭 noEmit，并固定 rootDir、outDir 与独立 build info 路径。
4. 包级 typecheck 脚本使用默认配置；build 脚本继续只使用 build 配置。
5. 根构建完成后扫描 Server 与 Shared 源码树；发现与 TypeScript 实现文件同名的 `.js`、`.js.map`、`.d.ts` 或 `.d.ts.map` 即失败。
6. 不忽略源码旁编译产物，确保误生成文件在本地状态与 CI 中保持可见。

## Consequences

### Positive

- 直接运行 `tsc -b apps/server packages/shared` 不再污染源码目录。
- build 和 typecheck 的写入契约可以从配置本身验证，而非只依赖 package script。
- build 配置继承默认配置，减少 types、lib 与 include 漂移。
- CI 能阻止旁路编译产物被打包或提交。

### Negative

- 两种配置分别维护 build info 文件。
- 新增受保护 TypeScript 包时，需要同步加入源码产物守卫。

### Neutral

- 正常构建仍输出到 dist，包的 exports 与运行方式不变。
- build info 位于 node_modules，不属于版本控制或发布产物。

## Alternatives Considered

- **只约束开发者使用 package script**：拒绝。无法防止编辑器、脚本或人工命令误用默认配置。
- **将源码旁产物加入 `.gitignore`**：拒绝。只会隐藏污染，不能阻止运行时错误或发布混入。
- **合并为单一可输出配置并由 typecheck 传入 `--noEmit`**：可行，但默认配置仍具备写入能力，安全边界较弱。
- **关闭根配置的 declaration 和 sourceMap**：拒绝。会改变所有包的构建能力，影响范围超过本决策。

## Verification Requirements

1. Server 与 Shared 的默认配置解析结果必须为 noEmit。
2. 两个 build 配置解析后的 outDir 必须分别指向包内 dist。
3. 对两个包目录执行 `tsc -b` 后，源码产物守卫必须通过。
4. 包级 build、typecheck、lint 与测试必须继续通过。
