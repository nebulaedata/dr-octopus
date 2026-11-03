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

本节已迁至 [概念验证与验收记录](../poc/background-tasks-implementation-validation.md#验收门槛)。

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

本节已迁至 [概念验证与验收记录](../poc/background-tasks-implementation-validation.md#已验证与未覆盖边界)。

## 验证记录（2026-09-17）

本节已迁至 [概念验证与验收记录](../poc/background-tasks-implementation-validation.md#验证记录2026-09-17)。
