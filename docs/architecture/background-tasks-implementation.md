# 受管后台任务实施契约（阶段 B）

> 2026-09-17；阶段 B 已落地，验证记录见末尾。以本文件细化并修订 background-tasks.md 中尚未验证的候选方案。

## 归属与范围

CLI/RPC 共用 `packages/agent/src/cli/run-cli.ts`，本次用户确认实施内置工具后，在 `packages/agent/src/extensions/background-task/` 实现宿主无关的进程管理能力，并由该组合根装配。Server 只做协议校验和停止协调，Web 只做投影。Scheduled task 和 subagent 进程不装配；现有只读子代理 bridge 不扩展。

目录：`definitions/port.ts` 定义受管进程接口；`services/task-manager.ts` 管理状态与屏障；`lib/process.ts`、`lib/windows-job.ts`、`lib/runner.ts` 实现平台所有权；`extension/` 注册工具、命令、事件；`sdk/` 装配服务。

## 控制协议

命令 `/octopus-background begin <stopId>` 原子封闭启动，异步停止全部活动任务；`finish <stopId>` 仅在清理完成时解封；`status` 重新发布快照；`stop <taskId>` 停止单任务；`logs <taskId>` 发布最近 16 KiB 日志。命令只有用户/Host 使用，模型使用工具。

快照通过 RPC `setStatus` 的 `octopus-background` 键传递 JSON。schemaVersion=1，包含 generation（扩展实例 UUID）、revision、accepting、stopId、activeCount、tasks 和可选 error/logs。完整活动任务上限为 8，快照保留最多 100 个终态；无分页省略的停止证据。Host 的 runtimeId/epoch 继续由现有事件信封提供，generation 为扩展实例附加防陈旧身份。未知版本/无效快照使停止失败。

已检查安装版本 Pi 0.85.1：AgentSession.prompt 优先执行扩展命令，即使正在 streaming；扩展命令异常被捕获后仍算 handled。因此 Server 必须以同 generation、stopId、accepting=false、activeCount=0 的快照确认 begin 完成，以 accepting=true 确认 finish，不能只看 RPC ACK。

Server 停止期间拒绝同 generation 新 prompt/steer/follow_up，失败保留阻断，重试 abort 可恢复；Extension input 在屏障期间拦截直接输入，start 自身也检查屏障。主循环 abort 和后台 begin 都不依赖模型。总截止时间沿用 15 秒。

后台控制初始化与子代理取消并行推进：后台快照无效、控制不可用或握手尚未完成，都不能阻止已知子代理收到停止请求。最后汇总失败；任何部分未确认时仍保留停止屏障，不报告整体成功。

## 平台与启动

使用可信 Node runner，初始只等待 IPC，不执行任何用户命令。Windows 父管理器创建 KILL_ON_JOB_CLOSE Job Object、OpenProcess/AssignProcessToJobObject 将 runner 纳入后，才通过 IPC 下发 shell/args/command/cwd；分配失败终止 runner 并拒绝启动。无 breakaway 标志，后代继承 Job；QueryInformationJobObject 活动数为零才确认结束。Windows 首期直接 TerminateJobObject，不承诺通用温和终止。

POSIX runner 使用独立进程组；TERM 后 3 秒仍存活则 KILL，按组检查存在性。组内未回收僵尸可能导致保守的停止超时，不能因此报告虚假成功。主动 setsid 逃逸和管理器 SIGKILL 清理不在本阶段保证内。

Shell 使用 Pi 公开 getShellConfig，第一版固定 bash 语义，不提供任意 shell/cwd 参数：cwd 固定当前 ctx.cwd，以准确复用现有 bash 权限上下文。不继承 NODE_OPTIONS 等会在 runner 握手前执行用户代码的注入变量。配置 shellPath/commandPrefix 暂不自动继承，工具描述明确执行语义。

## 权限、预算与数据

background_task.start 按 bash 的配置规则、command 和 cwd 归一化审批；其余操作只访问本实例任务，按现有 read 权限归一化。额外背景工具的显式策略仍需检查，不能用别名绕过 deny。工具菜单隐藏不等于授权，执行时检查活动工具。Knowledge 模式现有 tool_call gate 保留；Plan 模式禁止 start，即便该模式仍保留只读 bash。适配仓库锁定的 plan-mode-state.enabled 契约，损坏状态拒绝执行。

每个扩展实例 8 个活动任务，单任务合并日志 1 MiB，默认读取 16 KiB、最多 64 KiB；日志游标为字节偏移，裁剪提供 truncated。保留 100 个终态及相应幂等键，过期历史重试不保证去重。首期不宣称跨 RPC 进程共享 64 任务硬上限；Host resident runtime 上限与每实例限额共同界定总资源。

终态按实际完成顺序淘汰，使用单调序号避免同毫秒时间戳或系统时钟调整影响顺序。已开始的 wait 持有自己的任务引用，后续历史淘汰不会使其变成 TASK_NOT_FOUND；公开快照仍遵守原有记录上限。

不持久化 PID/日志，无重启自动接管。unknown/stopping 算活动，不允许空闲回收。平台句柄与监控在终态释放。RPC 正常关闭必须在杀 Pi 前显式执行后台停止并验证；无法确认时报告错误。

## UI 与故障恢复

共享协议定义任务快照和解析器。Server 缓存最新有效快照用于 bootstrap/reconnect，原始状态事件附带已验证 backgroundTasks 字段；managed runtime 同步禁止含活动任务或未释放停止屏障的实例被空闲回收。Web 在 Composer 上方保留一行任务摘要，点击打开桌面侧栏或移动端全宽面板。任务按运行中/最近结束分组；日志在所属任务下按需展开，支持刷新与复制。停止操作等待权威状态确认并禁止重复提交；主模型空闲也可操作。面板关闭后不影响后台任务，Esc 关闭恢复摘要入口焦点。

错误显示停止未确认；同 generation 可重试 abort，成功后解封。进程丢失/重启清空旧投影，旧 PID 不恢复。格式非法的快照不可回退使用旧的空快照作为停止成功证据。

控制命令成功后清除过期的全局命令错误，后续失败仍重新上报。清除错误不修改任务状态或 accepting，也不能绕过 finish 的停止证据检查。

## 验收门槛

服务测试覆盖启动竞态、重复 stop、取消等待、归属隔离、日志裁剪；真实平台测试覆盖后代及根进程先退出、强制停止、归属失败；真实 Pi RPC 测试覆盖 extension command 忙碌态与 ACK/状态分离；Server 测试覆盖超时保持阻断、陈旧快照和空闲回收；Web 检查投影恢复与控件。执行仓库要求的 build/test/lint/typecheck，并记录环境或既有失败。只有实际完成的验证才标记通过。

## 最终接口与示例

入口为 `background_task`，对模型服务发布的参数 schema 顶层必须是 `type: "object"`，不能使用顶层 `Type.Union` / `anyOf`。action 使用枚举，其余字段为可选；工具执行前再按 action 严格检查必填字段、无关字段和取值范围。返回 `{ content: [text], details: { schemaVersion: 1, result } }`。失败抛出 Error，由 Pi 转为工具错误，不返回伪成功。

| action | 字段及默认值                                                                                  | result                                               |
| ------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| start  | command 必填，最长 32768 字符；label 默认 Background task，最长 160；requestId 可选，最长 128 | task                                                 |
| list   | 无其他字段                                                                                    | 完整 snapshot（最多 108 个记录）                     |
| status | taskId 必填 UUID                                                                              | task                                                 |
| logs   | taskId；cursor 非负整数；limitBytes 默认 16384，范围 1–65536                                  | taskId、text、nextCursor、truncated                  |
| wait   | taskId；timeoutMs 默认 10000，范围 1–30000                                                    | 当前 task；超时仍为活动态，调用取消抛 AbortError     |
| stop   | taskId                                                                                        | 确认后的 task；最多等待 10 秒，未确认抛 STOP_TIMEOUT |

task 字段为 taskId、label、state、createdAt（Unix 毫秒），可选 endedAt、exitCode（整数或 null）、error（稳定诊断）。不对外承诺 startedAt/updatedAt/signal，合并日志不标注 stdout/stderr 来源，也不保证字节截断点的 Unicode 字符完整性。state 完整枚举见共享协议 `background-tasks.ts`，所有任务读写都限制在当前扩展实例内。

示例调用：

```json
{ "action": "start", "command": "pnpm dev", "label": "开发服务", "requestId": "preview-1" }
```

后续用返回的 taskId 调用 logs/status/stop。start 只保证归属登记，不代替服务健康检查。requestId 不携带 owner，不能访问其他会话；幂等覆盖当前保留窗口。

同键重入返回已有任务的当前状态；若原调用尚未完成创建，可能返回 starting，应继续 status/wait。它不会再创建一个进程，也不将 starting 声称为服务就绪。

命令参数限 ASCII 字母、数字、下划线和短横线，最长 80；未知 action/多余参数报错。begin/status/finish 不等待模型；stop 命令等待有界清理。命令报错除 Pi error 外还发布 snapshot.error，以应对上游 ACK 无法表达 handler 失败的问题。

## 已验证与未覆盖边界

- Windows x64：真实普通进程、退出码与日志、根进程结束后仍活跃的 detached 后代、Job 统一停止均通过。平台归属失败通过注入故障验证 fail-closed，未伪称实际构造了所有 Windows Job 限制环境。
- 真实 Pi RPC + 本地模拟模型：busy streaming 期间调用日志与主会话停止，确认真实 PID 消失、任务进入 stopped、启动屏障解除。测试位于 `apps/server/test/e2e/background-task-real.test.mjs`，独立运行避免与大量 worker 测试争抢资源。
- 浏览器：Browser plugin 不可用，采用仓库 Playwright 与已安装 Chrome。真实前端 + HTTP/WebSocket fixture，验证 idle 页面日志、刷新恢复、停止全部；桌面 1280×900 和移动 390×844 截图位于 `apps/web/.playwright-artifacts/background-{desktop,mobile}.png`。控制放在列表左侧，避免浮动记忆助手遮挡操作。
- Windows arm64、Linux/macOS 的实进程验证尚未执行。POSIX 适配器已实现，不将 Windows 通过等同于这些平台通过；生产跨平台发布前必须补跑对应 fixture。
- 不保证任意脚本、MCP/context-mode 执行器或子代理自行启动的脱管进程被接管；bash/powershell 的直接脱管写法只作防误用拦截。
- Web 停止按钮执行完整停止协议；TUI 提供同一工具和控制命令及退出清理，原生 Esc 只取消当前 Agent loop，尚未承诺与 Web 停止全部等价。
- 停止超时保留闭合屏障；原生归属查询失败进入 unknown，不按旧 PID 猜测清理。正常 RPC 退役清理失败保留 supervisor 记录并报告错误；Host 原有 unsafe retirement 策略仍可要求人工处理，不静默重启覆盖证据。

Windows 适配依据：[Job Objects](https://learn.microsoft.com/zh-cn/windows/win32/procthread/job-objects)、[活动进程计数结构](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_accounting_information)。

## 验证记录（2026-09-17）

| 验证                                                          | 结果                                             |
| ------------------------------------------------------------- | ------------------------------------------------ |
| 根目录 pnpm build / pnpm typecheck / pnpm lint                | 通过；最终小幅变更再次完成相关包类型检查与 lint  |
| Server 全套，node --test --test-concurrency=2 test/*.test.mjs | 309 通过、1 跳过                                 |
| Agent 全套，同样限制并发为 2                                  | 313 通过、1 跳过                                 |
| Web pnpm test                                                 | 152 通过                                         |
| Shared pnpm test                                              | 5 通过                                           |
| CLI pnpm test                                                 | 47 通过                                          |
| document-processing pnpm test                                 | 37 通过                                          |
| 新能力相关聚焦测试，含真实 Pi RPC 与进程管理器重试            | 31 通过                                          |
| Playwright background 场景                                    | 3 通过；正常后台控制、无效状态重试、停止失败可见 |

首次默认并行 pnpm test 在多套构建/浏览器验证同时运行时出现 worker 心跳、启动和 RPC 超时；没有将这次全量运行记作通过。随后逐包并限制 Agent/Server 并发复测，结果如上。原有外部真实模型测试保留跳过状态。Playwright 未下载新浏览器，使用已安装 Chrome；HTTP/WebSocket fixture 与真实 Pi RPC 验证分别覆盖 UI 和运行时边界。
