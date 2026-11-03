# settings-mcp-servers：概念验证与验收

架构设计：[原设计](../architecture/settings-mcp-servers.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

## 10. 验证

1. 相同 fixture 经 adapter 和 Settings 投影得到相同有效 Server、disabled 与 provenance。
2. GET 不连接 Server；只有 POST connectivity probe 可以产生受限子进程或网络副作用。
3. 所有 secret fixture 值均不出现在 DTO、日志、错误、Query cache snapshot 和测试输出。
4. mutation 保留未知根字段、adapter settings/imports、非目标 Server 与换行结尾。
5. stale revision、same-key replay、same-key conflict 和 commit 后断连有回归测试。
6. shared-global Server 的 activation 只产生最小 Pi global override。
7. owned Server 删除后，下层同名 Server 若存在则重新显现。
8. canonical route 与 route-masked Dialog 均可完成 catalog/detail/create/edit/activation/delete。
9. 运行 focused test/lint/typecheck，最后运行仓库级 `pnpm test`、`pnpm lint`、`pnpm typecheck`。


## 2. 已验证的上游能力

Agent 的 `extensions-install.ts` 与 `apps/server` 项目依赖均固定为 `pi-mcp-adapter@2.34.0`。该版本公开：

- `pi-mcp-adapter/config`：`loadMcpConfig()`、`getServerProvenance()`、`getMcpDiscoverySummary()`、路径与写入辅助函数；
- `ServerEntry` / `McpConfig`：stdio、HTTP、Unix socket、认证、生命周期、工具过滤等配置；
- `MCP_STATUS_EVENT`：Session 内只读运行状态事件；
- 文件优先级：共享 global → Pi global → shared project → Pi project。

adapter 没有公开完整 CRUD Repository，也没有跨进程 CAS。Dr.Octopus 因此复用 adapter 的解析、合并、来源和校验语义，同时只为自己拥有的 Pi global 文件补充最小的保留字段 mutation。

### 12.4 验证与完成标准

- Schema：非法传输组合、重复 header、CR/LF、空新绑定、无效数值、未知字段与命令表达式均拒绝。
- Store：创建/替换/保留/清除秘密，切换认证来源、切换 URL/command、保留 OAuth 扩展与未知配置，旧 revision 不写入；所有返回 JSON 无测试秘密。
- 探测：手动 Bearer/header 可连接；inheritEnv=false 不继承 Host 私有环境；涉及 OS store/OAuth/命令/TLS 的独立探测返回 `unsupported`，页面提示需在智能体中验证，不冒充完成授权。
- Web：四种 directTools 无损往返；数字/映射输入校验；成功清空秘密、失败保留草稿、背景刷新不丢草稿；桌面与窄屏可操作。
- 聚焦验证后执行 shared/server/web 的相关 test、lint、typecheck，并记录未验证范围。
