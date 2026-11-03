# octopus-workspace：概念验证与验收

架构设计：[原设计](../architecture/octopus-workspace.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

## 11. 测试策略

### Workspace Service

- General 始终存在且不依赖 Registry record。
- create 后可以通过 id 和 slug resolve。
- 重复 slug 返回 `WORKSPACE_ALREADY_EXISTS`。
- 非法 selector 和路径安全失败返回稳定错误码。
- Registry 损坏时拒绝 mutation，原文件保持不变。
- 目录已发布但 Registry 未提交时能够安全恢复。

### CLI Bootstrap

- 未传 `--workspace` 时在 General cwd 启动 Pi。
- 指定 Project 时先 `chdir`，再调用 Pi `main()`。
- Workspace 参数不会透传给 Pi。
- Workspace 不存在或目录非法时不启动 Pi。
- Pi 启动后没有任何代码再次调用 `process.chdir()`。

### Extension（如果保留）

- 注册 current/list/create，其中 create 不改变当前进程 cwd。
- 不暴露 mutation 工具或命令。
- 返回的 cwd 与进程启动时选择的 Workspace 一致。
