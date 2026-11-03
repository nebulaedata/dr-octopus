# technology-risks-roadmap：概念验证与验收

架构设计：[原设计](../architecture/technology-risks-roadmap.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

## 6. 验收标准

| 阶段    | 关键验收标准                                                                                                            |
| ------- | ----------------------------------------------------------------------------------------------------------------------- |
| Phase 1 | `pnpm dev:agent` 可启动 TUI；`pnpm --filter @octopus/server dev` 可创建 workspace 并通过 RPC 与 Agent 通信。            |
| Phase 2 | Web Host 可在同一 Workspace 打开两个 Session runtime；切换页面不终止后台任务，并完成 prompt → 流式输出 → 工具调用闭环。 |
| Phase 3 | Server 可恢复单个崩溃 Session；Session Lease、容量限制和 idle 回收测试覆盖核心生命周期。                                |
| Phase 4 | Desktop Host 与 Web Host 在 UI 与行为上保持一致，可离线运行。                                                           |
