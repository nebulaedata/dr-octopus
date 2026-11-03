# octopus-subagent-child-tools：概念验证与验收

架构设计：[原设计](../architecture/octopus-subagent-child-tools.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

## 6. 测试与验收

默认回归：`packages/agent/test/subagent-child-tools.test.mjs`。

- 双身份注册、并发刷新、重复启动、切换和重复 shutdown。
- 安装失败和损坏范围时阻止委派。
- 真实 Pi ResourceLoader 加载入口，验证菜单和无 commands。
- 入口不可变、agent 定义升级覆盖。
- 知识集合越界及服务缺失不启动 daemon。
- 真实 Memory SQLite 读取、off 策略、缺失存储不初始化。

显式端到端测试：

```shell
node --test packages/agent/test/e2e/subagent-child-tools.test.mjs
```

要求安装 pi-subagents 0.68.0，可用 PI_SUBAGENTS_TEST_PATH 指定其 index.ts。测试使用隔离 agentDir、模型配置、知识服务端点和会话。本地 mock 模型驱动真实父 Pi 委派，覆盖前台和 detached runner，验证工具调用、workspaceId、集合范围、globalWrite 和返回证据。不使用真实模型服务，不修改用户正常配置。

focused 检查后执行相关 test、lint、typecheck、build；既有 apps/server/test/e2e/stop-session-real.test.mjs 作为取消行为回归。

### 首轮验收记录（2026-09-17，浏览器复测前）

- 新增 7 项默认回归通过，覆盖真实 Pi 资源加载、双身份注册、部分注册失败回滚、shutdown 竞态、并发资源生成与业务只读约束。
- 真实 Pi E2E 覆盖四种组合：知识库/仅 Memory 授权 × 前台/detached runner。覆盖工作流与直接 agent 委派；Memory 组合还强制尝试隐藏的 knowledge_search，要求原生工具不存在或 CHILD_TOOL_NOT_AUTHORIZED，且知识服务收到零请求。使用本地 mock 模型、隔离 HOME/USERPROFILE 和知识服务。
- 原有 stop-session-real 取消回归单独运行通过。
- pnpm build、pnpm lint、pnpm typecheck 通过。
- Agent 完整测试 305 项：304 通过、1 项真实模型集成测试按原配置跳过。Server 304 通过、1 跳过；Web 146 通过。
- 全仓 pnpm test 和串行 `pnpm exec turbo run test --concurrency=1` 均未全绿：CLI 原有 `apps/cli/test/runtimes.test.mjs:166` 的不可验证 knowledge-use 锁保留用例在套件中得到 removed、预期 unverified。该用例独立运行通过；本次未修改 apps/cli 的实现或测试，保留此失败记录。

### 浏览器复测后的修正

- 普通模式的直接前台委派复现了缺失知识工具导致整个子代理失败的问题，已改为稳定注册、活动菜单收窄、执行包装器拒绝的三层适配。
- 保留原子发布 agent 定义；Windows 并发读写目标时的 EPERM/EACCES/EBUSY 使用有界重试，若另一个父会话已发布相同内容则直接复用。
- 内置浏览器验证前台和后台的 Memory 实际调用、空召回和缺失引用结果、后台原生通知、未授权 knowledge_search 的真实拒绝、知识模式限制以及刷新后的状态恢复；没有借测试放宽知识模式权限。
- 修正后的 7 项定向回归、4 种真实 Pi E2E 组合，以及 Agent build/lint/typecheck 通过。知识库正向链路使用隔离 Pi 与本地 mock 服务验证。
- 最新 Agent 全量运行中，Scheduler 授权检查超时，生命周期用例长时间无输出后终止；这两个文件隔离串行复跑共 8 项全部通过。保留全量运行未完成/未通过的事实，不将隔离通过等同于全量稳定。
