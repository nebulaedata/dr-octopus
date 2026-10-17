# Executor Computer：Windows-MCP 上游集成

当前源码通过 Utility Runtime 托管固定 Windows-MCP 0.8.8；截图、UIA 与输入调用真实上游工具。旧 product.server / desktop.py、自定义 ExecutorDesktopMeta/ExecutorCapture/ExecutorInput 和旧八工具契约已移除，不提供兼容入口或旧引擎回退。

设计与完整边界以 [Computer 实施规范](dr-octopus-windows-computer-use-mcp-architecture.md)为准。实际验证、失败与未验证项见 [验证记录](executor-validation.md)；源码接入不等于独立电脑或发行验收完成。

## 入口与职责

智能体 → Executor 认证 MCP → TaskAuthority → ComputerTools → WindowsMcpConnection → 受管 stdio / Windows Job → 私有 Python 的 windows_mcp serve。

Main 保持窗口、托盘、任务彩带及本机 Esc 停止桥接；Runtime 拥有任务、后端与结果。任务彩带只消费状态投影，不再通过跨进程绘制确认决定输入放行。上游负责桌面控制权、输入保护和实际截图/UIA/输入。Executor 不运行模型或第二套 Agent Loop。

后端固定仅 stdio，不读取用户 ~/.windows-mcp 配置。使用随包 executor.toml 和显式工具白名单；遥测关闭。启动无资源完整性扫描，构建/打包仍检查固定归档、初始化产物、清单和实际字节。

## 公开能力与权限

所有 Computer 工具均要求 computer.control，包括截图、UIA、显示器和状态。不提供 computer.observe：上游除 ControlStatus 外的工具均进入控制权流程，不能冒称不取得控制权的只读查看。

| 工具                    | 当前语义                                                                    |
| ----------------------- | --------------------------------------------------------------------------- |
| computer.screenshot     | 全桌面、指定显示器或物理区域截图；使用上游图像及坐标说明                    |
| computer.snapshot       | Windows UIA 控件树，可选图像；禁用浏览器 DOM 模式                           |
| computer.click          | 物理虚拟桌面坐标、有限按钮及单击/双击                                       |
| computer.type           | 必须给出目标物理坐标；上游文本输入，可显式 clear/pressEnter，可能使用剪贴板 |
| computer.scroll         | 指定物理坐标上的有限水平/垂直滚轮                                           |
| computer.shortcut       | 上游有限长度的按键组合                                                      |
| computer.app.switch     | 按上游名称匹配切换已有窗口，不启动任意程序                                  |
| computer.display.list   | 上游显示器信息                                                              |
| computer.control.status | 不取得控制权的状态读取，但仍要求桌面授权及活动任务                          |

旧 windowId/observationId 和十秒窗口观察协议不保留。坐标动作依赖当前桌面，不承诺窗口隔离或精确输入字符计数。动作前重新观察；图像可能缩放，按返回尺寸、原点和范围解释物理坐标。

工具注册、发现、权限提示和结果转换使用同一 Computer 定义。图像通过 MCP image content 返回，结构化元数据不重复 base64；拒绝不支持的 content 类型、非法编码和超限结果。输入与 UIA 内容不写入持久操作日志。

## 生命周期与结果

沿用全局唯一任务准入，Computer 操作串行，冲突调用明确拒绝。每个动作以及会取得控制权的观察要求幂等键；网络重试只查询既有结果，不重发输入。

上游用户接管通知关闭本次 Computer owner，后续调用不能自动重新夺取控制。实体 Esc/托盘停止与 task_stop 会阻止派发、关闭拥有的 Job 并收束在途调用。超时或已派发后不明确的结果记为 unknown，保留记录。

明确 task_stop 后，只有 Computer 已停止、无其他能力未解决阻断且所有在途执行收束，才能释放该任务占用。不得借 Computer 恢复清除文件、Shell 或 Transfer 隔离。task_end 同样关闭本次上游控制。已有授权的调用方可以显式 task_start 创建新后端世代；不复活旧任务或重放未知动作。

后端版本投影区分固定包版本 0.8.8 和 MCP 自报 serverVersion；当前自报值来自 FastMCP，不能用它认定 Windows-MCP 包版本。

## 原版 UIA 与捕获反馈

使用官方 Windows-MCP 0.8.8 原始 wheel，不应用本地 UIA 补丁、不 monkey-patch Python 方法。原版默认和实际转发参数均可完成 UIA；此前 20 秒超时不能证明上游不可用。装饰窗口过滤只是历史性能规避，已撤销，历史日志见验证记录。

Snapshot 和可能在冷态内部触发 get_state 的 App switch 共用 60 秒 UIA 上限；其余工具上限 10 秒。Computer 先从客户端授权等待预算和任务剩余时间中预留 10 秒收束，再限制为工具上限。预检与实际调用共享一个绝对截止时间，进度通知不延长它。UIA 工具至少需 30 秒可执行预算，否则派发前拒绝；这只是最低准入条件，不保证调用一定完成。建议客户端超时与授权等待预算至少覆盖完整执行和收束时间（如 70 秒以上），未知第三方 Host 自设的更短期限无法由 Executor 强制改变。

观察超时/断连表示结果未完成及控制流程需收束，返回 COMPUTER_OBSERVATION_INTERRUPTED，不冒称发生未知文字输入；输入动作超时/断连返回 COMPUTER_RESULT_UNKNOWN。明确上游失败与传输不确定性分开处理。两种不确定情况都关闭拥有的后端并保留原操作，不自动重试。用户明确 task_stop 后按当前清理证据释放 Computer 自身阻断，不能解除其他能力隔离。上游成功消息只证明工具报告完成，不证明业务目标完成。

私有 sitecustomize.py 仅规范化已存在的私有搜索路径并使用 comtypes 支持的内存类型包装器生成配置；不改上游或 comtypes 源文件。资源清单从官方归档、私有配置与固定初始化产物派生，不再有补丁后摘要/字节差特判。构建及显式资源装配通过原版 comtypes 正常导入，提前生成其 56 字节 comtypes/gen/**init**.py 包标记，并按固定摘要纳入清单；不手写或替换第三方源码。运行期类型包装器仍在内存生成，后端启动/关闭后完整清单必须保持一致。

Executor 任务彩带允许入镜，不增加跨进程隐藏/恢复协议；上游自己的提示与截图协调继续使用其实现。无彩带图像不作为验收门槛。

## 数据与交付

未发布的旧 Computer API 和日志格式无需兼容；共享任务日志、设备凭据、非 Computer 结果不能自动清空。开发验收使用独立数据目录。旧格式加载失败时保留原件，按新规范的离线处置边界处理，不自动重放。

新资源清单包含真实上游入口、executor.toml 和私有路径初始化文件；不再发布旧 product 目录。Python/wheel 版本、来源、摘要和许可证随包固定，普通启动不下载。PowerShell/搜索使用的 process-supervisor 不属于旧 Computer 清理范围。

原版 UIA 及本机专属窗口成功不替代多屏/混合 DPI、锁屏/UAC、真实部分输入、独立电脑和最终发行验收；原失败日志继续保留。

首页分别显示“支持 N 项”和真实后端状态。数量来自公开产品定义，不随失联伪装为零；就绪状态来自 Runtime，客户端发现仍按实际授权和后端状态过滤。

## 会话恢复、结果契约与维护约束

Computer 工具在创建 MCP 会话时按客户端授权注册，不因当时后端离线而永久缺项。tools/list 按当前授权和后端可用性实时过滤；显式任务启动/结束/停止后发送工具列表变化通知。已有会话可在 task_start 恢复后重新发现工具，真实调用仍检查任务、权限和连接。未授权或撤销不会因稳定注册而取得能力。

computer-results.ts 统一状态、完成结果与保留摘要的契约；ComputerTools 返回明确类型，MCP 输出边界用同一运行时 Schema 校验，不强制断言图像类型。内容容量、图像签名和编码检查继续执行。内部已删除未使用的 owner 参数，身份与任务归属仍由唯一 TaskAuthority 检查。

computer-diagnostics.ts 仅记录失败阶段、固定工具名、错误码、耗时和清理确认状态；不记录参数、输入全文、窗口内容、地址或原始异常字符串。清理失败保持隔离，日志写入失败不能改变原执行结果。启动失败、预检/执行错误和异步退休失败都有对应诊断。

私有 Python 配置由 computer-configuration.mjs 统一产生 ._pth、executor.toml、.executor-asset.json 和 sitecustomize.py 字节，资源装配与清单复用同一来源。资源 pin 经过 Schema 校验并与编译出的上游契约版本比较；升级不一致时构建拒绝。保留固定资源摘要和官方原始源码，不增加通用插件/Provider 框架。
