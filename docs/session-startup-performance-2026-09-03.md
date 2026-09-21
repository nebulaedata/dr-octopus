# Session 创建性能诊断（2026-09-03）

作者：Codex

## 结论

本机复现的新建 Session 延迟主要来自每次独立启动 Node/Pi 的模块加载、扩展初始化，以及问答扩展在 RPC 模式下仍执行的终端 UI 预加载。1 GiB 老生代上限不是这次约 6 秒延迟的主要原因。并发请求还会受到全局串行激活队列的放大。

初始诊断阶段只新增本报告。随后按用户选定范围实现的缓存、交互 CLI 导入拆分与首页预热，见 [智能体首页与 Session 预热](session-home-prewarming.md)。诊断中的扩展对照实验未应用于生产代码。

## 测试环境与方法

- Windows，Node v24.20.0，Pi 0.84.3，当前已安装的七个外部扩展。
- 使用运行中的本地 Server `http://127.0.0.1:3000` 与 General workspace。
- HTTP 测试创建三个带诊断标题的空 Session，测试后均通过 DELETE 接口连同 Session 文件清理。
- 子进程测试运行现有 `packages/agent/dist/bin/octopus.js --mode rpc --workspace general --session <临时文件>`，使用真实 Agent 配置与扩展，Session 文件单独存于临时目录。只发送 `get_state`，不发送模型请求。
- 每次新建独立进程。计时从父进程 spawn 调用开始，到收到成功的 `get_state` 响应结束；不是机器重启后清空文件缓存的冷盘测试。
- 使用 `PI_TIMING=1`、临时 preload 中的 PerformanceObserver GC 统计与 25 ms 内存采样。详细探针通过 Node 加载钩子在内存中注入，不修改依赖文件。CPU 采样单独执行，未混入常规内存上限对照组。
- 1 GiB / 4 GiB 交错测试，后两轮反转顺序。所有子进程测试顺序执行，避免相互争抢 CPU。样本量用于定位本机瓶颈，不代表跨机器统计结论。
- JS 堆峰值是采样值，不是严格的分配峰值；GC 统计来自启动期间已交付的 observer 事件。RSS、JS heap、old-space 上限是不同指标。

## 对照结果

| 场景 | 次数 | 耗时中位数 | 各次耗时（秒） |
| --- | ---: | ---: | --- |
| 全部扩展，old-space 1024 MiB | 5 | 6.165 秒 | 6.462 / 6.156 / 6.791 / 5.961 / 6.165 |
| 全部扩展，old-space 4096 MiB | 5 | 6.064 秒 | 6.064 / 6.165 / 6.162 / 5.951 / 6.006 |
| 仅移除 pi-subagents，保留其余六个外部扩展 | 3 | 3.885 秒 | 3.878 / 3.885 / 4.014 |
| `--no-extensions`，不加载自动发现的外部扩展 | 3 | 2.526 秒 | 2.505 / 2.726 / 2.526 |
| 全部扩展，仅推迟问答 TUI 预加载 | 3 | 5.194 秒 | 5.343 / 5.104 / 5.194 |

`--no-extensions` 场景仍经过同一 Octopus CLI 和显式提供的内置工厂；不能将它理解为没有任何扩展代码。仅移除 pi-subagents 的实验通过 `--no-extensions` 加六个显式 `-e` 路径实现，不修改持久配置。推迟预加载实验只在测试子进程中把特定的 2000 ms 定时回调延后到 60000 ms，收到 readiness 后结束进程；这是因果验证，不是建议生产实现。该组第三次带详细探针。

内存对照中，1 GiB 组最高采样 JS 堆约 121.8 MiB，GC 总耗时为 62.6–77.1 ms；4 GiB 组分别约 121.5 MiB、52.9–59.7 ms。两组中位数只差 101 ms（约 1.6%），远小于需要解释的数秒延迟。V8 报告的总 heap limit 包含其他堆空间，因此不等于 old-space 参数本身。

## HTTP 复现与队列验证

- 单次 HTTP 创建：6109 ms。
- 同时发出两个创建请求：5971 ms、12139 ms；两个响应均为 201，清理均为 204。
- `SessionsService.createSession()` 等待 `activateNew()` 才写入目录记录并响应。
- `SessionRuntimeCoordinator.#startNewRuntime()` 将 bootstrap、子进程启动和 readiness 全部放入同一个 `SessionRuntimeAdmission.run()` 临界区。
- admission 使用 `#tail` 等待前一个操作完成，再执行下一个操作。此次第二个请求等待了约一个完整启动周期。单请求测试没有这个并发排队因素。

代码位置：

- `apps/server/src/modules/sessions/sessions.service.ts:145`
- `apps/server/src/lib/runtime/coordinator.ts:346`
- `apps/server/src/lib/runtime/admission.ts:53`
- `apps/server/src/lib/runtime/activation.ts:35`
- `packages/agent/src/rpc/rpc-process.ts:127`

## 根因一：每次都重新加载较大的 CLI 与依赖图

第一份详细探针中，preload 到进入 `runOctopusCli()` 约 2291 ms。这段发生在 CLI 函数体开始前，属于模块导入、解析与执行；不是 workspace 解析或 session 文件写入。

同一次测量中，workspace resolve 约 3 ms、离线资源完整性检查约 15 ms、context-mode 环境准备约 1 ms、初始 ModelRuntime 创建约 29 ms、package resolve 约 39 ms。它们不是此次主要瓶颈。

独立 CPU profile 的主要热点包含模块路径 stat/open/read、ESM 编译和 Jiti 加载/解析。不能据此直接断言是 Defender、磁盘硬件或物理内存换页；本次没有对这些因素做因果对照。

`run-cli.ts` 从 Pi 根入口导入 `main`，并静态导入终端 UI、安装工具等模块；Pi main 本身也静态导入 interactive modes。RPC 每创建一个独立进程，都重新支付这部分加载成本。

## 根因二：外部扩展串行加载，pi-subagents 有导入期同步 PowerShell 调用

第一份详细探针中，外部扩展模块导入约为：

| 扩展 | 模块导入耗时 |
| --- | ---: |
| pi-subagents | 1715 ms |
| pi-mcp-adapter | 493 ms |
| pi-web-access | 376 ms |
| rpiv-ask-user-question | 329 ms |
| pi-plan-mode / pi-goal / context-mode | 各约 19–24 ms |

这些模块在 Pi `loadExtensionsInternal()` 的 for/await 循环里串行加载。工厂本身通常很快；context-mode 工厂约 98 ms。

CPU profile 进一步定位：

```text
pi-subagents/src/missions/workflow-state.ts:75
  const CURRENT_PROCESS_KEY = processStartKey(process.pid)
    → windowsProcessStartKey()
    → execFileSync("powershell.exe", ... Get-CimInstance Win32_Process ...)
```

该同步子进程在独立 CPU profile 中占约 718 ms 的阻塞采样时间。它用于工作流状态锁的进程身份校验，却在扩展模块导入时执行，即使空 Session 不使用工作流状态锁也要等待。context-mode 的同步 Git 调用另占约 95 ms，优先级低于上述问题。

移除 pi-subagents 的整组改善约 2.28 秒，不能全部归因于 PowerShell：还包括它的模块依赖加载，以及启动缩短后不再撞上下一项 2 秒预加载定时器的影响。

## 根因三：问答扩展的后台终端 UI 预加载阻塞 readiness

`@juicesharp/rpiv-ask-user-question@2.7.1/ask-user-question.ts` 中：

- 第 105 行定义 `PREWARM_DELAY_MS = 2000`。
- 第 257 行 `prewarmSessionGraph()` 安排动态导入 `state/questionnaire-session.js`。
- 第 405 行在工具注册后无条件调用该预加载函数。

该导入进一步加载问答状态、预览面板等 TUI 模块，经 Jiti 同步解析大量文件。即使定时器使用 unref，已经执行的模块加载仍会占用事件循环。

一个容易误判的现象：详细探针看到 `modelRuntime.refresh({ allowNetwork: false })` 窗口约 934 ms，但该窗口的 CPU 栈主要是问答扩展的后台 Jiti 导入，而不是模型网络请求。只推迟此预加载后，模型刷新窗口降至约 43 ms，完整启动中位数降至 5.194 秒，保留全部扩展。

因此不应仅凭 await 前后耗时将这约 0.9 秒归咎于模型刷新。

## 优化建议与优先级

### 1. 先处理 RPC 下不需要的问答 TUI 预加载

仅在真实交互终端模式或首次需要 TUI 时加载问答终端组件；RPC 路径保留工具注册、事件、问答协议和 Web 问答能力。可提交上游修复或使用版本固定的正式依赖补丁。

本机实验支持约 1 秒启动改善，属于最明确、范围较小的优化。不要简单把定时器改成更长的固定延时作为最终方案。

注意：Pi RPC 也提供 UI context，`ctx.hasUI` 可能为 true，不能单凭它判断是否为终端 TUI。应使用明确的运行模式或终端组件能力。

### 2. 将 pi-subagents 进程身份查询延迟到首次工作流状态锁操作

为当前进程的创建标识提供一次求值缓存，在实际需要状态锁身份时再查询；保留原有 PID 复用防护、错误处理和锁所有权语义。不要为了启动快直接删掉身份检查。

本机 profile 显示它有约 0.72 秒可移出启动关键路径。未来的锁操作仍需支付首次查询成本。还应将仅服务 TUI/Fleet 的模块改为按需导入，并评估把扩展 TS 预编译为 JS 以减少 Jiti 路径解析。后两项尚未做优化实现的性能验证。

### 3. 为 RPC 准备较小的启动入口

评估使用 Pi 公共 RPC/Session API 构建专用入口，按需加载 Logo、交互安装、TUI 和非 RPC 功能；保留资源加载、权限扩展、workspace、会话身份、协议与生命周期契约。也可评估官方支持的打包分发形式或编译缓存。

当前约 2.1–2.6 秒 CLI 导入阶段是优化空间，不等于都能消除。仅在 Octopus 一层改为 dynamic import，而 Pi 入口仍导入整个交互模块图，不会自动消除成本。

### 4. 缩小 admission 临界区，允许有限并行冷启动

在短临界区内预留全局/workspace 容量与 runtime 身份，在锁外执行耗时启动，再受控提交或失败释放。为 starting 状态计数，保留 epoch、重复激活合并、取消、失败回滚和容量约束。

本机已证实当前队列让第二个并发请求从约 6 秒增至约 12 秒。不能直接移除锁或无限并发；这台机器启动多个重型进程仍会竞争 CPU 和内存，需要有界并发。

### 5. 后续再评估预热或异步创建体验

可预热有限数量的运行时，或先创建 Session 元数据并返回明确的 starting 状态，再异步完成激活。前者增加常驻资源和重置隔离复杂度，后者减少界面等待但不减少后台启动成本。都需要保持资源、会话、权限及工作区隔离。

### 不优先提高内存上限

保留现有 1024 MiB 默认值，先落地已定位的启动优化。只有实际长会话出现近上限 GC 或内存不足证据后，再单独调整该资源策略。

## 原始诊断材料

本机临时目录：`<TEMP>/octopus-session-profile-20260903/`。

- `benchmark.mjs`：子进程对照脚本；模式为 profile / matrix / followup / defer-prewarm / cpu。
- `preload.mjs`：GC、内存、内存加载探针与特定预加载实验开关。
- `http-benchmark.mjs`：两个并发 HTTP 请求及其清理。
- `summary.json`、各组 JSON 与 stderr 文件：原始时序及测量结果。
- `startup.cpuprofile`：可在 DevTools CPU profiler 中打开的启动采样。

这些脚本固定了本次机器路径和 workspace，用于复核本次诊断，不是生产代码或通用性能测试套件。临时文件可能被操作系统清理；关键数值与结论已保存在本报告中。

本次没有修改应用源码，因此没有执行全仓构建、lint 或业务测试；验证使用实际 HTTP/RPC 创建路径和控制变量实验。