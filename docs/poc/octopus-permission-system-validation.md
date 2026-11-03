# octopus-permission-system：概念验证与验收

架构设计：[原设计](../architecture/octopus-permission-system.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

# 50. 开发验收标准

实现完成后必须满足：

- [ ] Permission System 已内置到 `packages/agent/src/extensions/permission-system`
- [ ] 不再依赖 `@gotgenes/pi-permission-system` Runtime Package
- [ ] PermissionMode 统一为 `ask | auto | full`
- [ ] PermissionMode 为 Process Global
- [ ] PermissionMode 不落盘
- [ ] `/reload` 后 PermissionMode 保留
- [ ] 新请求立即读取最新 PermissionMode
- [ ] 已弹出的旧请求不重新计算
- [ ] `auto` 只自动批准普通编辑操作
- [ ] `full` 仅将 `ask` 提升为 `allow`
- [ ] `deny` 永远无法被 PermissionMode 提升
- [ ] Global Config 使用 `<agentDir>/permission-system.json`
- [ ] Project Config 使用 `<cwd>/<configDir>/permission-system.json`
- [ ] Permission System 内部不写死 `.pi` / `.dr-octopus`
- [ ] Dr.Octopus Agent 使用 `permissionPolicy:`
- [ ] 禁止使用 pi-subagents native `permission:` / `permissions:`
- [ ] Root bootstrap 自动 ensure 关闭 `permissions.rules`
- [ ] Ensure 幂等、原子写、支持 backup、失败 fail-fast
- [ ] Child Process 不执行 ensure
- [ ] nicobailon 子进程启动 Dr.Octopus Binary
- [ ] Child `ask` 能通过 ParentAuthorizer 转发到 Parent
- [ ] Parent 当前 PermissionMode 能即时决定 Child 后续请求
- [ ] Web `ask` 使用 Pi RPC 原生 `extension_ui_request/response`
- [ ] Bash / MCP / Path / External Directory 权限保持 upstream 安全能力
- [ ] upstream MIT License 已保留
- [ ] Unit / Runtime / Integration Tests 全部通过
