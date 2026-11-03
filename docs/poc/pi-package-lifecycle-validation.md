# pi-package-lifecycle：概念验证与验收

架构设计：[原设计](../architecture/pi-package-lifecycle.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

## 7. 验证要求

修改默认 source、状态分类、入口策略或配套配置时，至少验证：

1. 精确版本与 source 错位会触发重装；
2. 已安装项不会访问 Registry；
3. Server 只安装缺失项并逐项持久化；
4. npm 静默环境在成功和失败后都能恢复；
5. 网络失败不会阻止后续项；
6. MCP 合并保留其他 server 和自定义 `context-mode`；
7. `agentDir` 注入会同时影响 `mcp.json` 与 context-mode 数据路径，且 MCP 环境会在 Pi Runtime 加载前进入 Agent 进程；
8. TUI、非 TUI、离线和 Registry 不可用路径符合第 3 节矩阵；
9. 执行 `pnpm --filter @octopus/agent typecheck`、`lint`、`build` 和 `test`。

测试不得写入用户真实 Pi/Dr.Octopus 目录，应使用临时 `agentDir` 和可注入的 Package/Settings manager。
