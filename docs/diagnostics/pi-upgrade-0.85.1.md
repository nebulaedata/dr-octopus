# Pi 0.85.1 升级记录

日期：2026-09-15。

## 最终版本与范围

- Server/Agent 的 `pi-coding-agent`：0.84.3 → 0.85.1。
- Agent 的 `pi-tui`：0.84.3 → 0.85.1。
- Server/Agent 显式声明 `pi-ai@0.85.1`，为 MCP 适配器提供匹配的 peer，避免另装 Pi AI 0.84.x。
- `pi-agent-core`、`pi-ai`、`pi-tui` 的最终运行依赖均解析为 0.85.1。
- MCP 适配器、受管扩展来源和设置协议的版本声明同步为 2.34.0。

原计划选择最早声明支持 Pi 0.85 的 MCP 适配器 2.33.0，但该版本依赖 `pkg.pr.new` 的 MCP SDK 预览包，被 pnpm 的 `blockExoticSubdeps` 限制拒绝。2.34.0 已恢复正式 npm 的 MCP SDK 2.0.0，所以最终采用 2.34.0，没有关闭这一限制。pnpm 为刚发布的精确版本自动添加了 `minimumReleaseAgeExclude: [pi-mcp-adapter@2.34.0]`；未全局放宽发布时间限制。

## 品牌补丁与数据兼容

补丁迁移为 `patches/@earendil-works__pi-coding-agent@0.85.1.patch`，更新 `patchedDependencies` 与锁文件，移除旧版本补丁文件。补丁内容与旧版一致，仅设置：

```json
{ "name": "Dr_Octopus", "configDir": ".dr-octopus" }
```

没有添加模型刷新、RPC 或其他第三方逻辑补丁。已验证默认目录仍为 `~/.dr-octopus/agent`，原有 `DR_OCTOPUS_CODING_AGENT_DIR` 覆盖继续有效。Session 文件格式仍为 v3；升级不执行用户 Session、Workspace 或凭据迁移。

## MCP 配置适配

新版 MCP 适配器允许 `directTools: "search"`。共享读取/写入协议已接受该值。设置页沿用原有开关：编辑其他字段时保留既有 search 或工具允许列表，显式关闭时写回 false；search 配置显示对应的提示说明。不会把 search 误判为 false 并在保存时丢失。

## 验证方法

使用完整构建、lint、类型检查、单包与整仓测试验证。新增回归覆盖品牌目录约定、通过 Pi 公开资源加载器加载实际安装的 MCP 扩展，以及 search 模式经过表单转换和协议验证后不丢失。现有回归继续覆盖 Session 恢复/派生、RPC、权限、MCP 设置、凭据配置和清除。

最初并行构建期间，Agent 的一个 Scheduler 启动测试超过了 15 秒就绪期限；后续整仓测试按包串行执行，避免把构建资源竞争误判为依赖不兼容。真实 OAuth 浏览器登录和用户自定义远程 MCP 服务不由本地回归自动覆盖。

最终结果：

- `pnpm build`、`pnpm lint`、`pnpm typecheck`、`pnpm install --frozen-lockfile` 均通过。
- 整仓按包串行测试：Shared 2、Environment Loader 6、Document Processing 28、Web 131、Agent 257、Server 256、CLI 44 项通过；Agent 另有 1 项需要本地模型的测试跳过。
- CLI 另有 3 项 runtime prune 测试失败，独立重跑仍失败。未改动的 `runtime-processes.ts` 在 Windows 无法读取某个 Node 进程命令行时返回 `unverified`，而测试期望 `would-remove`/`in-use`。没有绕过清理保护，也没有将整仓测试报告为全绿。
- 通过正式 CLI 入口做真实 RPC 检查，新建、停止后恢复、热加载均成功（单次分别约 7.45 秒、6.33 秒、10.6 毫秒）。使用临时 catalog 和临时 Session 文件，不发送模型任务；这些数值只用于成功性检查，不作为升级性能收益结论。

本次升级不是第 5 点模型刷新去重的修复；Pi 0.85.1 的该调用链仍然存在。已经运行的进程需要重启才能使用新依赖；受管 MCP 扩展由正常启动检查按新的版本声明更新。

参考：[Pi 0.85.1 发布说明](https://github.com/earendil-works/pi/releases/tag/v0.85.1)、[MCP 适配器](https://www.npmjs.com/package/pi-mcp-adapter/v/2.34.0)。
