# dr-octopus-windows-computer-use-mcp-architecture：概念验证与验收

架构设计：[原设计](../architecture/dr-octopus-windows-computer-use-mcp-architecture.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

## 15. 验证矩阵

| 层次         | 必须覆盖                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| 单元/契约    | 参数与结果转换、能力缺失、Schema 不兼容、图像/UIA 限额、权限撤销、引用失效、超时与取消阶段                        |
| 协议故障     | initialize/listTools 失败、半途断连、响应丢失、迟到回复、同键不同输入、退出未确认；断言不重复输入、不释放未知屏障 |
| 真实上游     | 固定入口、真实工具发现、图像内容、Snapshot 元素、有限键鼠及窗口切换；证明未进入旧 product.server                  |
| 控制闭环     | 用户接管、本机停止、选用 Esc 时的注入区别、连续截图、截图中停止、必要提示协调、上游附图路径                       |
| Windows 硬件 | 多屏负原点、混合 DPI、焦点竞争、锁屏/UAC、输入中进程退出、用户按键状态、真实部分输入                              |
| 非桌面回归   | Basic、Browser、外部 HTTP/stdio、设备与授权、Agent 本地工具文件流、设置持久化及重启                               |
| 交付         | 固定依赖和许可证、无系统 Python/Node/Git 的断网首启、升级/卸载、最终安装包与恢复                                  |

测试只使用拥有的专属窗口和数据，GUI 与加载原生组件的构建按项目要求串行。替身通过不代表真实输入或硬件验收通过。保留首次失败和原条件复验；环境缺失明确写未验证，不放宽断言或时限掩盖失败。

代码阶段按变更范围完成构建、test、lint、typecheck；文档阶段只检查格式、链接和决定一致性。独立电脑与正式发行门禁遵循现有交付规范，不以新后端握手成功替代。


## 17. 固定上游实验记录（2026-10-16）

阶段 B 进行中，尚未修改产品入口、资源清单或公开 Computer 工具。实验使用 build/upstream-computer-0.8.8 下的独立私有 Python 环境，不覆盖 dist/resources/computer。

| 项目      | 实际证据                                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 候选包    | windows-mcp 0.8.8；官方标签提交 b74c507d9e709223a0904cf08019edf55f2a75bb                                                                    |
| Wheel     | windows_mcp-0.8.8-py3-none-any.whl；SHA-256 597ef720e1902ba76510a4d2b946949f8a48f281dd210c183de5ded60ea3b873                                |
| Python    | 3.14.0 私有解释器；候选包要求 >=3.14                                                                                                        |
| 依赖      | 使用现有固定依赖归档重新装配，仅候选 windows-mcp wheel 替换为 0.8.8；完整依赖和行为兼容尚待进一步验证                                       |
| 启动      | 原版 windows_mcp serve --transport stdio，显式独立空 TOML、关闭遥测、固定工具白名单，使用现有 Job supervisor                                |
| 握手/发现 | 沙箱外同一 45 秒期限内约 5852 ms 完成；发现 ControlStatus、App、DisplayInventory、Snapshot、Screenshot、Click、Type、Scroll、Move、Shortcut |
| 控制状态  | ControlStatus 实际返回 state=ready、generation=1、wait_seconds=0                                                                            |
| 关闭      | 实验 client 和受管 transport 正常关闭，探针退出码 0；只涉及自有实验后端                                                                     |
| 版本陷阱  | initialize serverInfo 为 windows-mcp / 4.0.5，对应所装 FastMCP 版本，不能作为 Windows-MCP 包版本；产品应区分固定包版本和协议自报版本        |

首次受限环境 initialize 超过 45 秒，随后带 stderr 的同预算复验亦超时。诊断栈停在 Python asyncio selector 的 socket._fallback_socketpair/accept；经允许在沙箱外按原预算复验成功。原始失败保留，不将其抹为首次通过。日志和完整实际 Schema 位于本地忽略目录 build/upstream-computer-0.8.8 的 probe.log、diagnostic.log、stack.log、unrestricted-probe.log 和 discovery.json。首次源码抓取中的 control_policy.py 在此标签不存在（404）；实际控制门控文件为 tools/control_notifications.py。

### 17.1 公开授权决定（已确认）

v0.8.8 的 ControlToolGate 仅对 ControlStatus 免除控制权获取，其余所有工具（包括 Screenshot、Snapshot、DisplayInventory）调用 begin_call，进入 AI 控制状态及提示/输入保护流程。该事实来自固定 wheel 源码；本轮未执行截图或键鼠调用，尚未把实际 UI 行为记为通过。

用户已选择统一 computer.control，不提供独立只读截图授权；现已据此更新公开工具及界面。

后续还需验证专属窗口输入、截图/图像返回、用户接管与停止、包内路径及依赖兼容。此次握手成功不代表这些验证完成，也不代表最终发行通过。

### 17.2 UIA 恢复为首期目标与根因验证

用户明确 UIA 是采用 Windows-MCP 的核心价值，已撤销临时纯视觉降级，Snapshot 继续作为首期必要能力。

原版私有环境和官方标准 Python 3.14.3 虚拟环境均在 20 秒内 Snapshot 超时。按 HWND/进程的诊断确认开销集中在上游自身控制提示窗口；无提示的独立上游窗口枚举约 0.24 秒完成。仅在 UIA 前排除本进程专属装饰窗口后，同预算实验 Snapshot 约 3.87 秒完成。

补丁已按精确源/目标摘要装配；不改截图引擎、不关闭提示、不排除其他应用。测试验证外部同名前缀和本进程普通窗口仍被保留。专属 Electron 窗口显式开启系统无障碍后，真实 Snapshot 包含输入框名称，截图、中文坐标输入及快捷键均通过。早期测试插入错误、未启用无障碍时控件断言失败和原版超时均保留，不能用最终成功抹去。

该本地补丁已于 2026-10-17 撤销；原失败和归因修正保留在验证记录中。本地日志为 uia-private-mcp.log、uia-standard-mcp.log、uia-private-filtered.log 和 uia-fixed-accessibility.log；完整回归及发行范围见 executor-validation.md。
