# background-tasks-implementation：概念验证与验收

架构设计：[原设计](../architecture/background-tasks-implementation.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

## 验收门槛

服务测试覆盖启动竞态、重复 stop、取消等待、归属隔离、日志裁剪；真实平台测试覆盖后代及根进程先退出、强制停止、归属失败；真实 Pi RPC 测试覆盖 extension command 忙碌态与 ACK/状态分离；Server 测试覆盖超时保持阻断、陈旧快照和空闲回收；Web 检查投影恢复与控件。执行仓库要求的 build/test/lint/typecheck，并记录环境或既有失败。只有实际完成的验证才标记通过。

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
