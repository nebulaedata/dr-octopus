# Executor 验证状态与已知限制

更新日期：2026-10-19。本文汇总已完成开发、实际检查与尚未完成的交付条件，替代按日期累计的阶段报告。接口见 [架构入口](executor.md)，发布门禁见 [交付](executor-delivery.md#发布门禁)。

## 当前状态

### 启动故障的独立恢复入口

2026-10-19 新增独立维护恢复模块与状态页 Alert/actions。当前仅对 `CONTROL_STORE_INVALID` 开放用户确认后的授权/连接配置/任务历史重置；其他错误保留详情与启动重试。隔离测试验证旧 `computer.observe` 数据逐字节备份、原目录保留、无旧授权/任务重放、设置与设备身份保留，以及备份失败、部分重置失败、并发和退出等待。

实际检查：`pnpm --filter @octopus/executor build`、lint、typecheck 通过；完整 `test` 263/263 通过，新增维护 IPC 边界测试另行 1/1 通过。真实 Electron 恢复流程 1/1、三页导航回归 1/1 通过；发行包隔离副本在限制 PATH 下完成旧数据失败、确认/取消、备份、重置和服务就绪验证 1/1，1040×760 与 720×560 截图已检查，无相关页面异常。发行副本只启用测试所需 inspector，并将 Host 注册脚本替换为无副作用夹具，不改变原发行包或日常注册。构建输出的 Main/Preload/Renderer/Runtime 共 19 个文件与该包逐字节一致。

首次构建因其他测试进程占用原生文件而失败，释放后按原命令通过。首轮维护测试暴露私有目录命名不符合原生约束，修正为既有 recovery 前缀后通过。集成夹具的异步等待、toast/dialog 定位、Preload 严格拒绝额外字段的断言和新增 API 清单分别保留首次输出后修正；未放宽业务校验或扩大重置范围。原始本地集成日志、截图与产物一致性结果位于项目约定的 `build/validation-evidence/runtime-recovery` 批次目录。本次未重置正式用户数据，未执行完整安装/卸载、签名发行或独立电脑验收；生成的包为 unsigned 验证产物。

### Browser 现场断线诊断

2026-10-15 实际 Web 会话中，关闭截图的 browser_snapshot 两次在约 25ms 内返回 OUTCOME_UNKNOWN，随后 browser_tabs 返回 BROWSER_OFFLINE。旧快照参数严格 Schema 不接受新增 screenshot 字段，但协议号仍为 2，版本仍为 0.1.3；离线对照复现“列表/开页通过、快照被拒绝”。这证明存在兼容性缺陷，尚不能证明现场 Worker 实际使用的字节就是旧版本。当前产物在独立 Chrome/Edge Profile 的真实往返和原生彩带回归 3/3 通过，原始日志 apps/executor/build/browser-root-cause-isolated.log。不把标签页数量或截图尺寸当成已确认原因。

扩展 0.1.4 新增本地 bridgeLastFailure，保留有限时间、错误码、工具名和 Native Host 原因分类，连接恢复/Worker 重启后仍在 popup 展示，不改变线上桥接协议或彩带生命周期。19 项测试与两个真实隔离浏览器 popup 验证通过，lint/typecheck 通过，Chrome/Edge 双目标及许可证构建完成。首次测试与构建产物清理重叠导致 manifest 缺失，构建完成后原条件复验 19/19；不归因于产品运行时。该轮交付后用户截图确认已加载 0.1.4，并提供单次快照成功、连接存活的报告；现场原失败根因仍待失败瞬间记录确认。未重放原百度点击或处理其活动任务。

### PageController 原生反馈收敛

2026-10-15 按用户要求发布本地扩展产物 0.1.5：页面状态和元素索引直接使用 PageController 1.12.4；移除适配层的快照前 hideMask、逐动作 dispose、透明高亮覆盖、DOM MutationObserver 与额外输入拦截。原生彩屏、箭头和默认高亮跨观察/思考/动作保留；Runtime 在任务结束/停止后发送带 taskId、connectionId 的内部 release，扩展在暂停/断线/上下文失效时释放本连接的原生资源。协议升至 3，旧扩展在握手阶段明确拒绝。未修改 Agent Core 或上游依赖。

同文档的动态内容使用上游已索引的真实元素引用，不再承诺任意 DOM 变化使整份快照失效；导航、任务、连接、文档/Controller、过期及分页身份检查继续生效。敏感字段投影、截图遮蔽与图像字节限制仍由传输层负责；截图保留上游原生视觉反馈。

实测：shared、Executor、Chrome/Edge 双目标及许可证构建通过；shared 7/7、扩展 20/20、Browser 原生授权/桥接 8/8 与新增 release 关联断言通过；Chrome 155.0.8059.41、Edge 155.0.4283.45 隔离 ISOLATED world 原生反馈 2/2，通过快照/等待/点击/输入/选择/滚动、旧任务与旧连接清理拒绝、在途动作收束后清理与异步初始化失效。完整 Electron → MCP → Native Host → Chrome/Edge 扩展往返 1/1（约 79 秒），包括 task_end 后原生遮罩移除。对应 lint/typecheck 通过。

首次反馈回归的夹具失败包括 CDP replMode 表达式未显式 await 导致 Promise 投影为 {}，以及滚动后仍查找视口外按钮；改为显式 await、回到测试页顶部后重新观察，未扩大提取范围或放宽断言。首次完整往返停在旧的 sr-only 状态文本 visible 定位器，改为核对界面实际可见的“MCP 服务已启动”标题，保持原 20 秒期限后通过。完整往返首次失败与复验日志分开保留，未宣称产品启动故障。原始本地构建及端到端输出位于 apps/executor/build/browser-native-_.log，Chrome/Edge 原生彩屏与箭头截图为同目录 browser-native-feedback-_.png。现场旧版断线原因仍不据此追溯定案，当前用户浏览器需重新加载 0.1.5；以上不是正式商店、所有网站或独立电脑验收。

进一步审查将构造配置收敛为 new PageController({ enableMask: true })，删除重复属性列表及 viewportExpansion: 0 覆盖，使用上游默认的完整页面提取；合并文档范围校验、移除重复 showMask 和快照过期定时器，过期在读取/动作/捕获入口按 expiresAt 拒绝，原生 Controller 生命周期仍归任务管理。适配文件从 479 行减到 450 行。更新后的双目标构建、扩展 20/20、真实 Chrome/Edge 原生反馈 2/2（包括视口外按钮已进入原生索引断言）、完整 MCP/Native Host/两渠道扩展往返 1/1（约 75 秒）以及 lint/typecheck 均通过。新增本地日志为 apps/executor/build/browser-simplified-feedback.log、browser-simplified-e2e.log；Executor dev 服务持续运行，无需因这次兼容的扩展精简再次重启。

| 范围       | 实现与实测                                                                  | 未证明的部分                                 |
| ---------- | --------------------------------------------------------------------------- | -------------------------------------------- |
| 应用/IPC   | Main、沙箱 Preload/Renderer、唯一 Utility Runtime、具名控制与窗口重建已接通 | 任意 Windows 环境与签名发行                  |
| 授权/任务  | 设备能力授权、私有配置、HTTP/stdio、全局任务与持久结果已接通                | 任意客户端或跨用户凭据迁移                   |
| Basic      | 七工具、NTFS 发布/恢复、Job Bash、输出历史和搜索已实现                      | 对恶意同用户程序的 OS 沙箱、外部原子版本比较 |
| Browser    | 十一工具、真实 Chrome/Edge、有限页面结构、反馈、连接恢复已接通              | 所有网站、企业策略、商店和跨版本稳定性       |
| Computer   | 固定私有后端、八工具适配、实际 Utility 握手、防护与彩屏已实现               | 独立电脑输入/捕获矩阵与正式发行验收          |
| Web 客户端 | HTTP/stdio Basic、Browser、长调用与限定停止/恢复已有实际链路证据            | 所有模型/客户端和网络环境                    |
| 内网/VPN   | 本机私有网卡上的显式监听、鉴权、会话隔离已测                                | 实际另一台电脑/VPN/防火墙可达性              |
| 打包       | 未签名 NSIS/ZIP、完整清单、许可、私有资源与验收工具已生成                   | 干净机器安装/卸载、签名与正式发布            |

源码变化不会更新旧安装包。每次包测试以 acceptance-artifacts.json 的 productBuildId、文件摘要和实际扩展版本确定身份，不能把较早包的通过结果迁移给新包。

## Computer 本机停止与绘制确认（2026-10-14）

新增活动期间的本机实体 Esc 监听及托盘停止入口，按 activityId 和 Utility PID 拒绝旧通知；停止取消桌面任务、关闭拥有的后端并等待在途调用收束，保留 unknown 操作记录和隔离。停止后桌面后端需完整重启才能重新启用。固定原生组件进入构建和最终包。

输入前确认保持原期限和防护，非聚焦反馈窗口关闭后台节流，等待真实绘制后复核当前布局/DPI/窗口身份，并验证四条边的 alpha；透明角不再作为完整彩带的唯一判断。拒绝日志只记录修订和有限阶段，不记录桌面内容。

- 最终全量基础与原生测试 215/215、零跳过，包括固定私有 Node 的 50 次原生监听启动/停止竞态及环境退出清理，以及停止期间任务先释放、后台确认延迟和关闭失败的回归。前一阶段 212 项全量与单项原生检查保留为原始记录。
- 最终构建、包级 lint/typecheck、本次文件格式与 diff 检查通过。
- 实际 Electron 集成 3/4：真实 Utility 握手、实际桌面 Runtime 停止及彩带绘制回归通过；注入 Escape 输入场景仍因 Win32 `FOCUS_DENIED` 失败，未跳过或放宽该断言。人工激活尝试被 computer-use 自动审批拒绝，原始失败保留；实体键盘和 RDP 转发不据此声明通过。
- 绘制回归保留透明中心、四边渐变、动画、非聚焦/穿透、多屏覆盖和未知状态，并新增透明角正常确认、只有文字但无彩带拒绝、旧修订拒绝。
- 最终未签名 NSIS/ZIP 位于 `D:/tmp/octopus-computer-stop-20261014/0.0.1-unsigned-72d67c33-3295-43cd-9e4c-22be57963f7e`，productBuildId 为 `78f44c40fcb69333fc43972dbdb3260fda72964597f0d0515f23a2abc7631f2f`。完整包清单与最终 ASAR/Fuse/资源两项验收通过；未执行正式签名、安装/卸载和硬件矩阵。较早 6644ab3b 包（43d3ac148fd53bac1fd5da309298858a00312e019badd4ebca5599614a3f7d9e）也经过同范围两项核验，但尚未包含后续停止反馈修正。

LAPTOP-LH 原授权的单次旧包复验聚焦自有 Executor 窗口返回 applied/OK，说明用户报告的 Chrome 场景尚未稳定重现，不能把角像素或节流直接认定为其唯一根因。远程磁盘重定向不可达；第一份完整 ZIP 已由用户手动处理 Chrome 下载拦截并完整解压。之后两个新增回归明确发现任务释放可早于后台确认，当前实现增加独立关闭反馈，确认失败持续 unknown，失败状态再次 Esc 采用有界完整退出。

为此次验收生成一次性 13 文件覆盖包：先对前后两个完整产品清单做实际验证，拒绝删除路径，逐字节核对全部差异文件，未改产品更新架构或用户数据。用户手动处理补包下载拦截后，通过远程 Explorer 将 13 个差异文件及最终清单覆盖至完整产品目录，界面确认 14 个同名文件全部替换，没有复制用户数据。最终程序已从该目录启动，管理界面显示 MCP 服务启动和桌面工具就绪；新路径触发 Windows 防火墙提示，按项目规则交由用户手动处理。提示处理前一次原授权只读接入返回 fetch failed，原失败保留。

用户确认处理防火墙后，原授权成功接入同一 LAPTOP-LH 实例。最终版 `computer_focus` 及 `computer_key(Escape)` 均返回 applied/OK，调用后任务仍 active、桌面能力仍可用，彩屏保持显示，证明该远程场景中程序注入 Escape 没有误触本机紧急停止。用户明确报告在目标电脑实体键盘按 Esc 后彩屏消失；专用任务 `567766ad-bb7a-46e4-b271-de32fabc7a5b` 的 MCP 核验为 cancelled、先前 Escape 操作 completed、computer.available=false、桌面工具数 0。实际管理界面确认“已停止”和需重启提示，彩屏消失，基础工具仍可用、浏览器桥接仍连接。

完整退出并重新启动同一最终目录后，桌面能力再次就绪。Chrome 下载记录窗口首次聚焦明确返回 not_applied/FOCUS_DENIED，已通过绘制确认，原失败保留；通过普通 UI 激活该窗口后，新任务 `9e1ca544-48ce-44fd-b74c-00bd25b373b2` 的聚焦和下载记录标题区域点击均返回 applied/OK，没有出现 COMPUTER_INDICATOR_UNAVAILABLE。该用例证明新版本在已激活 Chrome 的当前环境中可完成绘制确认及输入，不证明 Windows 前台限制已消除，也不替代 Gmail 页面或所有环境的原问题重现。该任务随后按既有五分钟闲置规则取消，桌面后端保持可用，不能将这次闲置取消当作紧急停止。

另建观察任务 `ee8f3584-042a-40e7-95f5-33c0a529638b`，通过实际托盘“停止桌面控制 (Esc)”收束。MCP 核验为 cancelled、computer.available=false、桌面工具数 0，彩屏清理，最终桌面能力保持停止。当前包在本次环境中的实体 Esc、程序注入 Escape 排除、完整重启恢复及托盘停止均有实际证据；修饰键、输入中强中断、断开的 RDP 会话、混合 DPI 和正式发行矩阵仍未提升。

首次窗口定位把资源管理器标题也算作 Executor，随后精确标题遗漏 v0.0.1，分别造成 4/0 个匹配；两次均在输入前拒绝并结束专属任务，最终采用实际产品完整标题，未修改输入防护。使用托盘时图标位置变化曾打开另一应用的窗口，未修改其网络或其他设置，返回 Executor 后依据新截图选择自身图标。

旧进程已从其托盘正常退出。RDP 隐藏期间图像曾停留在旧帧，重新激活连接后解压结果可见，不使用旧图像继续输入。远程覆盖来自经过核验的两个包及实际 GUI 复制完成证据，未在远程重新计算完整目录摘要，不能把本地清单核验提升为远程完整性验收。

本地原始材料保存在被 Git 忽略的 `apps/executor/build/validation-evidence/computer-stop-2026-10-14`。首次测试装配、CSP、原生 Electron delay-load、设置子目录、lint 和前台拒绝等失败分别保留，不以有限后续通过抹除。

## 设备身份验证（2026-10-14）

[ADR-0080](../adr/0080-executor-device-identity.md) 的持久实例 UUID、设备名称、Main 初始化标记、Runtime 快照、MCP 初始化与发现描述、结构化状态和稳定配置键已实现。

- 完整 Executor 单元及原生测试：202 项通过。最终初始化标记和连接键调整后，设备、设置、导出、Runtime 生命周期及接入的相关回归 21 项全部通过（20 项原范围通过，加修正导航与主题断言后的单项 GUI 复验）。
- 最终构建、typecheck 和本轮变更范围 lint 通过；包级 lint 最初被 `test/integration/browser-feedback.test.mjs:240` 的 curly 错误阻挡；2026-10-14 按用户要求补齐该条件语句花括号后，`pnpm --filter @octopus/executor lint` 与该文件格式检查均通过。
- 双实例实际 adapter 测试通过：两个独立临时数据目录拥有相同名称、不同 ID 和连接键，模型可见元数据保留目标身份；默认、short、mcp、none 命名合法，最长当前工具在有设备前缀时不超过 63 字符。
- 既有窗口、端口、HTTP、stdio 与内网 GUI 接入回归通过。名称保存前后保持当前 Runtime 身份，完整重启后名称变化且 ID 保持；界面截图证据在未跟踪的 `apps/executor/build/device-identity-*.png`。
- 原始失败：构建原生模块 EBUSY；聚焦测试中的多余 saved 参数和动态键断言；首次 GUI 集成因测试端口 0 被标记初始化错误保存而 7 项启动超时。修正后原期限复验通过。另有截图测试刷新页面后未重新选择设置页，导致定位超时，修正测试导航后单独复验。

运行只使用临时数据和授权，用户授权关闭当时运行的开发版以释放构建文件。两个隔离 Runtime 是同机实例，不代表两台物理机器或真实模型行为已验收；旧安装包未重新打包，Computer 生产门禁不变。

### 真实开发版与既有 Web 会话验收

2026-10-14 用户要求启动 `pnpm dev:executor`、使用 computer-use，并继续会话 `ec983dee-977e-42b0-a3c3-0d39adf0d6a2`。实际通过 Windows 原生窗口执行名称修改、保存及配置预览检查；Web 会话使用真实模型和已有 `dr-octopus-executor` Browser 授权，没有新增授权或扩大能力。

- 初始名称 `ZGL`，实例 ID `2ea054ac-b7ba-4ffd-b90e-7bc0d4f465ea`。保存“Executor 设备身份验收”后当前名称保持 `ZGL`，显示待重启名称；完整重启后新名称生效，ID 不变。
- 同一会话首次读取发现文本时仍是重启前的 `ZGL`，实时 `runtime_status` 已返回新名称。按已确认契约执行 `mcp({connect:"dr-octopus-executor"})` 重新发现后，初始化说明、tool description 和实时状态的名称及 ID 全部一致，真实模型给出一致性报告。
- 原生 HTTP 配置预览的键为 `octo2ea054acb7ba4ffdb90e7bc0d4f465ea`；Authorization 只展示占位符。没有复制、导出或修改凭据，旧连接名 `dr-octopus-executor` 继续可用。
- 原始失败：旧隔离连接 `executor-screenshot-qa` 的状态查询和显式连接均返回 `fetch failed`；回退到既有开发版连接后成功。首次原生点击保存按钮因在视口外被拒绝，滚动后保存成功；批准 radio 控件在提交后消失，check 操作报告验证失败，重新观察确认只读批准已生效；同名 mcp 工具卡选择器曾有歧义，改用实际观察到的元素定位。没有重放任何设备业务动作。
- 首次启动时桌面后端显示启动失败；完整重启后显示已就绪，且实时状态 `computer.available:true`。首次失败仍保留，根因未定位，不能用后续成功宣布 Computer 的启动稳定性或发布验收通过。本次没有使用 Executor 桌面权限，原生操作由外部 computer-use 技能完成。
- 证据为 `apps/executor/build/device-identity-computer-use-renamed.png`、`device-identity-computer-use-config.png`、`device-identity-real-session.png`（均未跟踪）。测试结束恢复原名称 `ZGL` 并保持开发版运行；改名后的客户端需重新发现元数据。

### 按设备名称选择 MCP 的真实模型验收（2026-10-14）

用户要求验证仅凭设备名称调用工具。新建 Web 会话 `013f2edf-dee4-42c1-a56f-1dd862f395fe`，首条请求仅提供 `LAPTOP-LH` 和只读查询要求，没有提供 MCP 别名、IP 或设备 ID，并要求依据本轮发现和实时状态核对操作对象。

- 真实 DeepSeek V4 Flash 读取 MCP 发现信息和 instructions，选择 `executor-laptop-lh-desktop-qa`；实际 `runtime_status` 返回名称 `LAPTOP-LH`、完整 ID `1ea7ef6a-c490-4815-8987-27abfaf784d1`，与远程设置页一致。
- 确认身份后创建 `computer.observe` 任务 `8536499b-3536-4f08-860f-0e335a86ca0d`，`computer_displays` 实际返回一个 1920×1080 显示器，随后 `task_end` 返回 completed；没有键鼠输入、截屏或文件修改。
- 为核对另一设备，模型调用 `dr-octopus-executor_runtime_status` 得到 `fetch failed`。该设备的发现名称不同，但实时状态不可达，因此本次不宣称全部已配置设备的重名检查通过。
- 已安装 adapter 的同名设备专项 `test/integration/device-adapter.test.mjs` 1/1 通过，覆盖两个独立临时实例同名、不同 ID、连接键与工具前缀；此项不等于真实模型面对同名在线设备的澄清行为已经验收。

本次证明已配置且在线的 Executor 可被模型按设备名称识别并调用；设备名称不替代稳定连接键或凭据。模型调用记录及实际输出保留在上述 Web 会话中，未修改设备名称、授权范围或其他连接配置。

### 排除 MCP 名称提示后的设备识别验收（2026-10-14）

用户指出上一轮连接键及工具前缀包含设备名，因此上一轮仅作初步验收。此次通过 Host API 暂时以中性连接 `route-q7m4` 替代 `executor-laptop-lh-desktop-qa`，连接描述为通用测试文字，搜索关键词为空，原连接从测试期间的有效配置中移除。13 个工具均采用 `route-q7m4_*` 名称，不含 LAPTOP-LH 或设备 ID；Executor 的结构化身份与初始化说明继续保留实际设备信息。

- 新建真实 Web 会话 `310ae002-2f29-4e62-8307-51cc8a9b2555`，仅提供设备名称 `LAPTOP-LH` 及只读显示器查询要求，未向模型提供中性别名、地址或设备 ID；要求依据本轮发现及实时状态而非旧记忆识别。
- 模型读取 discovery/instructions 中的设备身份后选择中性连接，实际 `route-q7m4_runtime_status` 返回名称 `LAPTOP-LH` 和 ID `1ea7ef6a-c490-4815-8987-27abfaf784d1`；`route-q7m4_computer_displays` 返回单显示器 1920×1080。观察任务 `ba43cc5a-45df-4a3f-8156-5e243e2bb801` 最终 completed、quarantined=false。无键鼠输入、截屏或文件修改。
- 附带失败保留：模型尝试连接旧 `windows-mcp`，首次因等待批准期间权限配置变化被阻断，重试后 fetch failed；该连接没有参与目标设备的查询。此次不宣称所有工具调用均成功。
- 临时配置首轮把 DTO 中仅适用于 stdio 的 inheritEnv 带入 HTTP，API 返回 400；此时尚未移除原连接。修正临时装配后测试成功，没有更改生产校验或扩大权限。
- 测试后通过 API 恢复原连接并移除中性连接，核对私有配置的规范化结构与测试前备份一致；设备名称、ID、端点及授权范围保持。

该结果证明已排除连接名、工具名及人工连接描述的名称提示，真实模型仍可依据 Executor 身份信息定位并调用当前在线目标；不据此扩大到真实在线同名设备的澄清行为已验收。完整调用轨迹保留在上述 Web 会话中。

### 全局重启提示与动作（2026-10-14）

新增全局顶部悬浮 warning Alert、立即重启按钮、有限 Preload/IPC 重启接口及开发启动器串行重启支持。Main、Preload 与 Renderer 已构建，开发版按用户确认完整重启并加载新接口。全量 Executor 测试 206 项通过，包级 lint、typecheck 通过。

`test/application-restart.test.mjs` 验证：重复重启合并、Runtime 退出确认前不得 relaunch、退出失败不得 relaunch、开发版保留 Vite 且停止后不得重启、外来 frame/非空输入/未保存状态拒绝，以及重启后禁止新设置写入。保存中的设置与未保存草稿也阻止界面按钮派发。

原生交互补充检查未完成：隔离 `--executor-test` 进程按既有测试规则不显示窗口，computer-use 无法定位该隐藏窗口，未将其记作实际按钮点击通过。独立测试进程已停止，临时目录清理被自动审批拒绝并保留在 Temp；日常开发版由用户授权重新启动。真实打包环境的 relaunch 与发行验收仍需另外验证。

## 开发回归与验证范围

2026-10-11 源码清理的历史范围如下，结果汇总自当时的本地命令输出；不能把旧证据目录或旧包的通过结果当作后续变更的原始日志。

| 检查                               | 结果                                                  |
| ---------------------------------- | ----------------------------------------------------- |
| 两应用 build、lint、typecheck      | 通过                                                  |
| Executor 基础与原生                | 182/182，无跳过                                       |
| 扩展协议/路由/实际产物             | 11/11                                                 |
| 隔离 Chrome/Edge action/popup 文档 | 2/2                                                   |
| Executor 集成                      | 23 个不同用例通过；1 个真实键鼠用例未通过前台前置条件 |
| 新包核验/加固/扩展/Computer owner  | 4/4                                                   |
| 新包安装目录移动与 write/edit 恢复 | 1/1                                                   |

此前构建身份配置变更的检查：Executor 基础与原生 189/189、插件 11/11、shared 7/7；两应用 lint/typecheck 通过。隔离双商店 ID 构建下，配置/Native/迁移 12/12 与 manifest 1/1 通过；已恢复 sideload 产物和空商店 ID。安装版 Chrome/Edge 的真实 popup/Host/MCP 与插件 UI 专项各 2/2 通过，不能代替真实商店身份验收。

此前未签名包 productBuildId 为 `2b5778ce24b24f0268a0e7def43a646e1704604fbbdb1fb747b7974abbfa4033`。选定的包内插件/身份摘要、完整清单、离线核验、Fuse/ASAR、私有工具/真实 Host 和原始加固 Runtime 六项通过。首轮旧“管理连接”定位失败保留；随后夹具等待任务栏最小化而产品默认进入托盘，结束专属测试进程后修正显式 taskbar 设置，按原 600 秒期限复验通过。原始日志保留在本地，不随源码提交；本轮没有验证实际安装/卸载、签名或商店分发。

GUI 首轮失败保留：正式 Host 注册保护拒绝旧夹具、旧 toast/传输控件定位、旧诊断断言、浏览器级 CDP 错误路由、未结束旧任务的准入冲突，以及内置页面尚未渲染时启用调试的竞态。夹具修正后按原期限复验，不改生产权限或回放语义。

真实键鼠用例中，Electron 可见/focused 仍不是 Win32 前台；保护返回拒绝，未输入到其他窗口。需要用户激活专属测试输入框再复验，不删保护、不跳过或据此开放 Computer。此前人工激活的一次成功只覆盖当时产物和有限场景。

本轮清理已移除一次性启动诊断、运行时阶段/字节采集、历史脚本副本、截图输出分支和废弃 IPC；持续行为回归仍保留。测试 Host 使用唯一名称和扩展副本，不占用正式注册或用户 Profile。

2026-10-12 独立升级实施验证：两应用构建、lint/typecheck 通过；Executor 全量 193/193，随后补充的版本格式边界与独立产物专项 9/9。插件 sideload/store 两种真实构建各 11/11；仅重建插件切换模式时，客户端记录字节不变且交付校验通过，最终恢复 sideload 产物并保留本地 .env 的两个官方商店 ID。夹具验证不同插件产品版本的升级/回退握手、旧连接失效及不兼容协议拒绝，不代表已发布版本或真实商店安装验收。Turbo dry-run 确认仅切换进程 profile 时 Executor 缓存键不变。

该轮未签名包位于 apps/executor/release/0.0.1-unsigned-9a679802-f77c-4368-bd76-59f55053b458，productBuildId 为 `1c1b0659bf7e07ff847c0749c3ab1b81e63578e2bf067a34b49b5415b366bc93`；包内插件字节/身份记录与完整资源清单两项通过。没有执行安装/卸载、实际商店更新或独立电脑验收，不能沿用此前包的其他验收结果。首次构建残留旧 loader 名称与专项测试缺少花括号的 lint 失败已修正后复验；未放宽运行预算或权限。

2026-10-13 工程脚本整理验证：scripts 中 11 个 .mjs 入口均由 package.json 的 node 命令调用；工程辅助模块使用 JavaScript，通用归档不再调用 PowerShell。关闭 Node 实验性 TS 支持后，完整构建和实际未签名打包成功。平台分支用例覆盖 Windows x64 选择、Windows ARM64 拒绝以及 macOS/Linux 待适配错误，不代表其他系统支持。

两应用 lint/typecheck 通过，Executor 全量 197/197，插件 11/11；工程边界/归档专项 3/3 已包含在全量中。Node 资源清单与整理前一致；Computer 清单 5,987 个资源条目一致，另一个 native/computer-supervisor.exe 条目随本次原生重编译更新。首轮全量 196/197，网络探针因 CJS 编译契约再次打包出现初始化错误，改为 ESM 后原用例及全量复验通过，未删断言或放宽超时。

本轮未签名包目录为 apps/executor/release/0.0.1-unsigned-3f30e0f0-75b1-446c-86d9-e5d9afc17225，productBuildId 为 `069dee4f9c8cead6e35c854309b17a572218cade906178c45fc261931178054c`。选定的包内备份恢复、插件字节/身份、完整资源清单及独立清单核验四项通过；未执行安装/卸载、真实商店更新、其他操作系统或独立电脑验收。

2026-10-13 浏览器插件工程目录同步：scripts/compile/build.mjs 与 scripts/package/licenses.mjs 均由 package.json 直接调用；补丁引擎迁入 tooling，固定运行时补丁数据归 vendor/page-controller。关闭 Node TS 支持后完成 Chrome/Edge 两目标构建与许可证收集，lint/typecheck 和 13/13 测试通过。两份 vendor 补丁输出与原实现逐字节一致，两个浏览器的 background.js 与 content-scripts/content.js 与上一验收包字节一致；现有 Executor 的独立产物兼容校验通过。未执行真实商店安装或新增系统平台验收。

2026-10-13 工程辅助目录内聚：Executor 与 browser-extension 的 15 个辅助文件迁入各自 scripts/lib，两个顶层 tooling 源目录已移除。命令入口与 lib 辅助模块的分类断言、导入路径、资源定位、Turbo 输入和当前规范同步更新；生成缓存 build/tooling 保持原契约。关闭 Node TS 支持后的两应用构建通过，lint/typecheck 通过，Executor 197/197、插件 13/13；三个官方身份及当前产物兼容校验通过。使用既有 3f30e0f0 验收包进行包内插件和完整清单只读复验，两项通过；本轮未生成或安装新的发行包，不沿用旧包证据声明新发行验收完成。

2026-10-13 官方身份配置收敛：browser-identity.json 成为侧载公钥/ID 与两个商店 ID 的唯一来源；删除 .env、模板和 CI 缓存中的商店 ID 覆盖，客户端不再读取或缓存依赖根 .env。两应用构建、lint/typecheck 通过，Executor 198/198、插件 13/13；身份专项 10/10 已包含在全量中，覆盖无 .env、旧环境变量无法覆盖 JSON、任一模式缺失身份拒绝及独立产物兼容。Turbo dry-run 确认旧身份变量及插件 profile 不改变客户端任务缓存键；当前构建产物身份与附带插件兼容校验通过。本轮未生成或安装新的发行包，未执行真实商店安装验收；此前 .env 身份配置的验证记录仅保留为历史证据。

2026-10-13 PageController 补丁管理纠正：通过 pnpm patch/patch-commit 生成根 patches/@page-agent__page-controller@1.12.4.patch，由 workspace patchedDependencies 和锁文件管理；已删除 WXT/集成测试的字符串替换钩子、自制引擎及 browser-extension/vendor。冻结离线安装通过，安装后的两份依赖文件与迁移前补丁输出逐字节一致。插件双目标构建、lint/typecheck、13/13 测试及真实 Chrome/Edge 隔离反馈回归 2/2 通过；依赖补丁已列入 Turbo 输入及 Windows CI 触发范围。本轮保留既有定制，不代表已证明每项补丁都不可被公开配置/API 或适配层替代；产品裁剪、生命周期修正和自定义事件接入须分别复审。未上传商店或生成新的 Executor 安装包。

2026-10-13 PageController 全部补丁撤销：通过 pnpm patch-remove 移除本依赖补丁及其 workspace/锁文件绑定，删除专属 Turbo/CI 补丁路径；其他依赖补丁保留。当前使用未经修改的 1.12.4，安装字节与上游两份源文件 SHA-256 一致，冻结离线安装通过。适配层改用默认无遮罩模式与公开 beforeUpdate/afterUpdate、cleanUpHighlights API；只有同步 SDK 提取/清理暂停观察，异步页面反应仍使快照失效。依赖修改的证据门槛与标准 pnpm 流程已写入插件 AGENTS.md。

本轮 shared、插件 Chrome/Edge 与 Executor 构建通过，两应用 lint/typecheck 通过；插件 13/13、Executor 198/198。真实 Chrome 155.0.8059.39 / Edge 155.0.4283.45 隔离适配回归 2/2，覆盖点击/填写/选择/滚动、提取后及清理时的页面反应、人工输入、伪造 mask ID/ignore 属性、任意脚本方法拒绝、连接替换/reset/dispose。使用独立 Host/Profile 的真实 Native Messaging HTTP 往返 1/1 通过，覆盖两个浏览器。

首次两引擎测试误把上游保留的空高亮容器判为残留高亮；改为检查覆盖层/标签子节点后，反应探针仍等待容器增删，造成第二次失败，随后改为观察实际子节点变化。业务失效断言始终保留；没有为这些测试假设修改依赖。初次 lint 缺少花括号已修正复验。原失败摘要与最终构建/测试输出保存在本地 apps/executor/build/validation-evidence/page-controller-unpatched-2026-10-13。上游未使用的 executeJavascript 导致构建 eval 警告仍存在，协议不开放该能力且未放宽 CSP；这不构成商店审核通过的证据。未生成新安装包或执行商店、独立电脑验收；之前的彩屏/指针回归仅保留为历史证据。

2026-10-13 遮罩恢复与脚本边界确认：依照用户决定，通过 PageController 公开 API 恢复动作期间的原生彩屏、指针和交互阻挡；快照等待隐藏遮罩初始化后建立基线，动作完成/失败立即释放 Controller 与输入监听，下一次观察重新创建。无需依赖补丁、私有遮罩节点或特殊 DOM 过滤。真实 MV3 扩展 ISOLATED 内容脚本探针确认浏览器 CSP 拒绝 eval，随后撤回任意脚本协议/MCP/Worker 入口与 Debugger 权限；项目规则明确关闭任意脚本，并接受上游未调用的 eval 构建警告，不再列为待办。

本轮 shared 与 Chrome/Edge 插件构建通过，插件 lint/typecheck、13/13 测试及 Executor 集成测试文件 lint 通过。真实 Chrome 155.0.8059.39 / Edge 155.0.4283.45 遮罩回归 2/2，覆盖彩屏 canvas、指针点击动画、真实鼠标/键盘阻挡、隐藏期间等待一秒后的快照稳定、重复动作释放、初始化中 reset 后无残留遮罩、有限动作及 DOM/人工输入失效、任意脚本方法拒绝。独立 Host/Profile 的真实 Native Messaging 往返 1/1 通过，覆盖两个浏览器。输出保存在本地 apps/executor/build/validation-evidence/browser-mask-restored-2026-10-13；未生成安装包、未进行商店安装或独立电脑验收，本轮没有重新运行 Executor 全量测试。

2026-10-13 executeJavascript 最小裁剪：用户明确要求从发布产物移除未使用的动态脚本实现。通过 pnpm patch/patch-commit 生成根 patches/@page-agent__page-controller@1.12.4.patch，仅删除 JavaScript 方法与对应类型声明（两个文件、26 行删除），不修改遮罩/高亮；workspace 与锁文件绑定该补丁，其他依赖补丁保留。协议白名单与扩展权限配置注释说明关闭任意脚本并通过 pnpm patch 移除实现，Turbo 输入和 Windows CI 路径同步覆盖补丁。

本轮 shared 与 Chrome/Edge 插件构建通过，构建日志不再出现 EVAL 告警；产物测试扫描两个浏览器全部发布 .js/.map，不包含 executeJavascript 或 eval 调用。插件 lint/typecheck、13/13 测试、Executor 集成测试文件 lint 通过，真实 Chrome 155.0.8059.39 / Edge 155.0.4283.45 遮罩与有限动作回归 2/2 通过。安装哈希验证包含已裁剪实现/类型声明及未修改的上游遮罩，冻结离线安装通过。原始输出保存在本地 apps/executor/build/validation-evidence/page-controller-no-eval-2026-10-13；本轮未重新运行 Native Messaging/Executor 全量测试，未生成安装包或上传商店。

2026-10-13 浏览器快照截图与调用优化：browser_snapshot 默认激活目标标签页并采集有界 JPEG，screenshot=false 保留后台 DOM 观察。截图按 document/controller/snapshot 验证，监测切换标签再切回及导航；编码最大 128 KiB、边长 1280，Native 帧上限不变。密码与显式敏感内容临时遮蔽，只忽略准确归属的 style 写入，同步自定义元素反应仍使快照失效，结束/reset/dispose 恢复。MCP 返回独立 image block 和文本/尺寸信息，Web 复用已有 Attachment 与放大预览；历史纯文本记录不补造图片。

调用指引明确使用精确工具名 describe，禁止用空参数业务调用探测；fill/select 要使用实际输入控件索引，task_end 只接受 taskId，并要求完整报告失败调用。用户批准的 Agent 记忆修改以当前用户文本检索、按回合/查询/存储身份和版本复用导航，固定插在用户请求之前；保留工具查询、删除校验及保存/取消流程。Host 配置监控改为语义内容指纹，格式重写、字段重排与无关设置不再误报准备期间配置变化，实际模型/认证/默认模型改变仍拒绝。

验证：插件 17/17、Web 268/268、Shared 7/7、记忆串行 55/55、会话准备与配置监控专项 20/20 通过；真实 Chrome 155.0.8059.39 / Edge 155.0.4283.45 遮罩与敏感内容/同步反应回归 2/2、真实 Native Messaging 往返 1/1（两浏览器截图及有限动作）通过。Web 隔离验收会话 ec983dee-977e-42b0-a3c3-0d39adf0d6a2 在 localhost:5174 实际展示 JPEG 1280×720、24.3KB 并验证放大预览，任务 completed；早期验收实例包含旧的硬编码前缀指引，最终源码已改为连接列表中的精确工具名。

广泛 Server 测试 440 项：437 通过、2 失败、1 跳过。附件用例因真实 C 盘使用率超过 90% 返回存储保护 507；知识服务并发启动超时，原期限下单独复验通过。并发记忆测试的启动失败保留，原期限下单独启动 2/2 和串行记忆 55/55 通过，未扩大时间或降低保护。第一次截图集成测试缺少 randomUUID 导入属于测试装配错误，修正后同用例复验通过。首次 Web 聚焦检查未使用已有 tsconfig alias 参数，改用包规定配置后通过。

原始日志和图片保存在本地 apps/executor/build/validation-evidence/browser-snapshot-2026-10-13。验收时原 5173/3001 开发服务被另一项目接替或停止，临时使用本项目 5174 页面和进程级精确来源配置，不修改持久 .env；临时 QA MCP 已禁用，唯一测试 Host/Profile/授权已释放。未上传商店、未打包新的安装程序，不据此宣称正式发行或复杂网页全量验收。

2026-10-14 桌面控制启用与状态投影：用户明确决定启用固定受管桌面后端，移除 ComputerRuntime 的 accepted 关闭参数，不提供任意后端或环境开关。真实握手才挂接工具；ready 与具名 Host 回复携带有界生命周期状态，Main 复用健康探针更新，停止/失联时清除可用能力。状态页展示实际启动、就绪、失败或不可用状态，授权页新增查看/控制桌面，control 包含 observe；已有客户端授权不自动扩大。新构建与包元数据 computerEnabled=true，启用不等于发布验收通过。

验证：Executor 全量 202/202、真实 Electron/桌面授权/断开与页面生命周期 8/8、新包清单/加固/私有 Node 的实际 Computer owner 3/3 通过，构建、lint/typecheck 通过。桌面验证只读取显示器信息，不发送真实键鼠输入；仅终止由捕获的 Runtime PID 拥有且固定路径匹配的测试 supervisor，之后界面不可用、MCP 桌面工具消失、新桌面授权禁用。开发版已恢复，现有 Browser 授权的真实 runtime_status 确认 computer.available=true，授权仍只有 browser。

首轮构建因并行验证进程加载原生 DLL 返回 EBUSY；停止该自有验证进程后串行构建成功。界面验证前两轮错误地把异步 IPC 谓词交给 waitForFunction，未真正等待就绪；改为等待异步结果的 expect.poll 后通过，45/15 秒期限不变。打包测试 lint 首次缺少 expect 导入，补齐后检查通过；原始失败记录保留。新未签名 NSIS/ZIP 产物身份为 0a5977849a224e69a4914bd0577223886583bcbeb3c756461f4f7a0a155297fb，未安装、未签名或发布，独立电脑硬件矩阵继续待验收。本地原始日志与图像位于 apps/executor/build/validation-evidence/computer-enabled-2026-10-14。

## 可重复检查入口

从仓库根使用实际 package.json 脚本，先构建再执行依赖产物的检查：

```powershell
pnpm --filter @octopus/executor build
pnpm --filter @octopus/browser-extension build
pnpm --filter @octopus/executor test
pnpm --filter @octopus/browser-extension test
pnpm --filter @octopus/browser-extension test:popup
$env:EXECUTOR_BROWSER_FLAVOR = 'installed'
try {
  pnpm --filter @octopus/executor test:integration
} finally {
  Remove-Item Env:EXECUTOR_BROWSER_FLAVOR
}
```

| 用例范围                                                     | 复核重点                                                        |
| ------------------------------------------------------------ | --------------------------------------------------------------- |
| test/native 的文件、Bash、搜索与 MCP                         | 真实竞争、恢复、权限、输出边界、Job 清理和同键不重放            |
| integration/electron、mcp-access、settings、overview、scroll | 沙箱/来源拒绝、授权配置、真实服务、关闭/重建和布局              |
| integration/browser-bridge、browser-feedback                 | Native 往返、效果一次、分页/身份、反馈与清理                    |
| integration/browser-lifecycle                                | 拒绝期间网页不附着调试器，真实 frozen/discarded、旧引用拒绝     |
| integration/browser-popup                                    | 实际 action 目标上的暂停/恢复、原 Host 生命周期、恢复后的新任务 |
| integration/computer-owner、computer-use-indicator           | 实际 Utility 握手、固定契约、绘制和持续提示                     |
| integration/computer-backend                                 | 人工取得 Win32 前台后的专属窗口截图与有限输入                   |
| test/packaging                                               | 最终清单/Fuse/资源，移动与恢复；安装卸载只在专用电脑            |

长预算/故障和实际 Web 验收位于 apps/server/test/integration；根据既有夹具选择明确场景，不用短调用代替完整 600 秒边界。未来文档检查只验证格式、索引、链接和决定一致性，无须重新运行全部硬件验收。

## 已有实际客户端验证

| 场景                   | 已验证范围与限制                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Web Basic HTTP/stdio   | 真实 Web、Server、生产 Agent RPC、MCP 和七工具；窗口重建不重放。                                                                            |
| 完整 600 秒预算        | HTTP/stdio 都取得有效期限 590 秒的真实超时与持久结果，不缩短时钟。                                                                          |
| 停止/撤销/回复丢失     | Web Stop 和本地撤销收束拥有的 Bash；回复丢失后查询与同键取回，效果不重复。同键取回不是新执行。                                              |
| Web Browser 短调用     | Chrome+HTTP、Edge+stdio 的有限工具、分页、旧引用和窗口/Host 退出。                                                                          |
| Worker/扩展/权限恢复   | Worker 重启、重新启用后的单次固定补注入、网站权限撤销/恢复；重连不回放。                                                                    |
| Browser 在途故障与 DOM | 两条链路各 timeout/disconnect/cancel/revoke；只拦已产生效果后的回包。单层同源 frame/open shadow、SPA 与拒绝边界，不扩大为每个动作中间步骤。 |
| 普通人工激活           | Chrome/Edge 冻结/丢弃四个有限用例，拒绝期间不附着网页，人工激活后新快照与新动作；显式 CDP/刷新不是同一证据。                                |
| 用户实际模型           | 用户本机 Chrome/Edge、扩展 0.1.3、真实 DeepSeek：开页、快照、一次点击、中文输入、选择、滚动与 task_end；源码效果独立核对。                  |

受控模型/协议 peer 与真实模型分别标记；API 激活、CDP action 和物理鼠标人工操作分别标记。限定用例通过不能消除首轮失败或证明所有环境稳定。

## 尚未完成与执行顺序

1. 在用户已暂缓的独立电脑可用后，完成断网首启、普通权限安装/卸载、升级失败与恢复、主题/DPI 图标。
2. 使用实际另机/VPN/防火墙及明确客户端完成网络调用、撤销、禁用和完整退出；本机网卡请求不能代替。
3. 逐项完成 Computer 独立电脑矩阵，保留真实原生部分输入、锁屏/UAC、焦点竞争和混合显示证据；2026-10-14 的用户启用决定不替代这些发布证据。
4. 完成正式扩展商店/企业策略、签名与目标环境验证，核对最终产物及 G1–G6，不自动提升门禁。

用户暂缓环境意味着 not-tested，不表示场景不存在或已经验收。缺少环境时继续可独立完成的代码与文档工作，不引入生产绕过开关。

## 历史验证边界与已知失败

2026-09-30 的运行时与 Browser 评估针对原语和临时原型，不作为正式产品验收。2026-10-08 至 2026-10-11 的本机检查涉及设备授权与旧控制记录拒绝、人工侧载后的安装/连接/重连/撤销、mask/指针反馈与 DOM 新鲜度、私有离线工具链、完整清单和元数据/额外文件拒绝；这些检查不证明正式商店分发、签名或独立电脑验收完成。

Computer 的早期超时、已撤销的启动预检、后续启动依赖修复与截图拒绝归因属于不同阶段。初次冷启动/负载失败不能被暖态成功抵消，首次截图失败原因仍未确认。持续彩屏检查覆盖任务间隙、未知状态、多屏窗口与透明流动；界面检查覆盖原生标题栏、独立授权/配置和三页布局，旧放大控件/底部按钮不再是当前要求。

关键历史失败包括五分钟 HTTP 回复丢失、冷启动/资源压力、冻结页面普通激活后仍 frozen、恢复前额外效果、真实前台拒绝、首次捕获归因不足及旧 Host 路径问题。后续限定用例通过不抹去这些事实；未知原因不能借“夹具修正”宣称产品根因已经解决。较早包身份及当时未完成的物理工具栏操作，也不能证明后续源码通过验收。

## 文件传输（ADR-0079）

以下为已替代独立客户端方案的历史记录，不代表新协议通过。2026-10-15 在本机 Windows、Node 24.20.0、pnpm 11.18.0 下完成源码实现和本地验证。客户端是新建的独立 `apps/executor-client` Node MCP Host；未修改 Agent Core，未部署用户连接配置或发布安装包。

| 范围                                     | 实际结果与边界                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| shared / executor-client / executor 构建 | 通过；客户端生成独立可运行的 ESM bundle，执行体重新构建原生组件及 Runtime。构建保留既有 vswhere 探测提示和前端 chunk 大小警告，命令退出成功。                                                                                                                                              |
| shared 检查                              | test 7/7、lint、typecheck 通过。                                                                                                                                                                                                                                                           |
| 客户端检查                               | test 2/2、lint、typecheck 通过；实际 Windows 私有 ACL、目录范围、快照、不覆盖发布及配置地址检查。                                                                                                                                                                                          |
| 执行体回归                               | `pnpm --filter @octopus/executor test` 223/223 通过；此轮包括当时 8 项传输测试。后续补充的传输与恢复收口另用聚焦测试验证，不将 223 记作最终全部用例数量。lint、typecheck 通过。                                                                                                            |
| 传输聚焦验证                             | 11 项用例已通过：二进制与零字节、多分块双向传输、真实 2 GiB HTTP 往返及 SHA-256 一致、2 GiB 原生快照边界、超限、目标竞争创建、失去块确认后重连续传、错误身份/撤销、任务停止、幂等键冲突、错误摘要、准备中断不续传、提交结果不明后的事实恢复、模拟磁盘准入失败，以及实际打包 stdio 子进程。 |
| 运行期内存                               | 2 GiB HTTP 往返采样的 JavaScript ArrayBuffer 增量低于测试的 512 MiB 上界；原生快照使用固定缓冲。该检查不等于所有操作系统及负载下的 RSS 上限承诺。                                                                                                                                          |
| 未验证                                   | Linux 实机/容器、独立第二台电脑/VPN 链路、真实满盘/掉电及最终发行包。Docker Linux 引擎未运行，连接 `dockerDesktopLinuxEngine` 返回找不到管道，故未进行 Linux 容器验证。模拟故障不冒充真实硬件故障验收。                                                                                    |

首轮新增测试的失败保留为实现修复记录：私有目录中继承 ACL 的文件被误判、准备完成状态过早暴露导致 TRANSFER_BUSY、Windows 只读上传句柄调用 sync 失败，以及 Windows PowerShell 的 Get-Acl 模块加载失败。分别通过沿用私有父目录与对象身份校验、等待操作收束后暴露可用状态、只刷新写句柄、固定 .NET ACL API 修复；后续测试未放宽断言。类型检查的 structuredContent 窄化错误和 lint 提示亦已修复。新增恢复测试最终独立为顶层用例，避免与 stdio 测试的生命周期混合。

原始命令日志保存在本地 `apps/executor/build/transfer-verification/`，并归档到下述忽略目录；初次失败摘录与后续成功输出分开保留。以上为已被 2026-10-16 新方案替代的历史证据，不代表新协议通过；当前操作见 [Executor 安装说明](../../apps/executor/INSTALLATION.md)，设计见 [ADR-0079](../adr/0079-executor-file-transfer.md)。

## 正式设置、项目目录与限额（ADR-0081）

2026-10-15 先记录 ADR，再实施正式 settings.json、传输 journal 项目目录与四项执行体限额。下列结果均使用测试拥有的数据目录，未将用户真实设置作为测试对象。

| 检查                  | 结果与范围                                                                                                                                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 构建、lint、typecheck | 通过；最终构建包含最新 Main、Runtime 和 Renderer。前端 chunk 大小警告保留。                                                                                                                                                                                |
| 完整执行体回归        | 首次 232 项中 229 通过，3 个重启用例因 Electron Mock 没有 commandLine API 失败。补齐有限 API 后常规单元复验 96/96，其中 4 项重启用例另行复验通过；另外 136 项原生用例在完整回归中通过。首次完整命令的失败保留，不记为一次全绿。                            |
| 最终存储与限额        | 15/15：正式文件优先、旧设置和 journal 一次性导入且保留原件、损坏/缺失/标记回退拒绝、并发修改备份保留、提交结果不明时不重放、双方向限额、残留占额、磁盘余量及 journal 导入中断。                                                                            |
| 实际跨卷发布          | 工作目录位于 C 盘、正式设置位于 D 盘，连续保存及重新打开均通过；仅操作新建的临时目录。                                                                                                                                                                     |
| Electron UI           | 保存、关闭行为、端口占用、主题、设备名称和文件传输设置流程分轮通过。新流程验证非法数值禁止保存、运行中仍用旧限额、完整重启后 runtime_status 返回新限额。普通/窄窗口截图已查看，无相关 pageerror。Browser 插件不可用，使用现有 Playwright Electron 工作流。 |
| 备份脚本              | 增加默认项目目录占用识别，PowerShell 语法检查通过；默认实例需分别保留项目目录和 AppData。                                                                                                                                                                  |

首次失败还包括 journal 迁移夹具误从 save 后未更新的内存 Map 取值，以及旧端口用例查找已移除的提示文案。夹具改为比较真实原始 journal，UI 定位器对齐当前持久重启提示，保留端口、占用及重启断言。随后 toast 自动消失断言超时，改为用户显式关闭通知后验证持久提示仍存在；本轮不宣称验证了 toast 自动消失的具体时限。没有放宽原有任务或测试期限。

原始完整日志及复验记录位于本地 `apps/executor/build/settings-verification/` 并归档到忽略的 apps/executor/build/validation-evidence/ 目录。没有重新执行独立电脑、真实掉电或安装包验收。设计见 [ADR-0081](../adr/0081-executor-settings-storage.md)，用户操作见 [安装说明](../../apps/executor/INSTALLATION.md)。

## 验证材料的保存方式

材料目录、批次命名、Git 边界与清理规则统一见 [Executor 项目规范：验证材料存放与清理](../../apps/executor/AGENTS.md#验证材料存放与清理)。本文只记录验收结论与证据状态；源码或产物变化后不得沿用旧结果宣称通过。

2026-10-17，原本位于 docs 下的本地验证归档迁入 Executor 工程后，已按用户要求删除该归档目录。本文历史条目中的相关路径仅表示当时的材料位置，不代表原始文件当前仍可取回；历史结果与未验证范围继续保留。该次删除不涉及其他批次或发布附件。

## 2026-10-16：直连 MCP 与普通 HTTP 文件流

本轮先更新 ADR-0079、架构及安装说明，再实现直连 MCP 与普通 HTTP 文件流；移除旧客户端源码、工具代理、旧控制/分块协议、共享传输导出及构建依赖。没有修改 Agent Core、部署用户 MCP 配置或发布安装包。旧客户端证据仅作历史保留。

验证平台为本机 Windows、Node 24.20.0、pnpm 11.18.0。原目录构建因正在运行的 Executor 占用 dist/native/computer-escape.node 被拒绝（EXECUTOR_NATIVE_OUTPUT_BUSY），没有停止该实例或覆盖已加载模块；后续在独立复制的源码/资源目录重建原生、Main、Preload、Runtime 和 Renderer。隔离构建通过，保留既有 vswhere 提示和前端 chunk 大小警告。新构建不代表当前运行实例已更新。

| 范围              | 结果                                                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| shared            | build、lint、typecheck 及 7 项测试通过；删除仅供旧客户端/Executor 消费的共享传输导出，Schema 回归 Executor                                                                                 |
| Executor 静态检查 | lint、typecheck 通过；变更文件格式检查和 git diff --check 通过                                                                                                                             |
| 包内测试          | 240 项覆盖通过：传输/限额 18 项，其余 222 项中首次 221 项通过；唯一失败为隔离材料缺少验收指南，补齐两份原始指南后该项复验通过                                                              |
| 文件流与工具      | 真实 SDK 直连发现四工具、按权限筛选，描述明确缺少本地能力不要调用；OS curl 验证零字节、中文/空格路径、超过旧 4 MiB 边界的二进制上传下载及 2 GiB 往返，完整摘要一致                         |
| 容量与内存        | 原生 2 GiB 边界通过、超一字节拒绝；2 GiB curl 往返采样 JavaScript ArrayBuffer 增量峰值 24,069,954 字节（约 23 MiB），断言上限仍为 128 MiB，未放宽                                          |
| 授权与故障        | 临时凭证不能访问 MCP、其他传输、其他监听入口或错误方向；长期设备 Bearer 不认证字节通道；权限撤销、任务停止、传输到期、阻塞下载取消、短读、摘要错误、目标竞争、幂等键隔离和未知发布恢复通过 |
| 已有入口          | Basic、Browser、Computer 非交互夹具、长 MCP 回复、可信内网入口及固定 stdio 取消/EOF 等原有回归覆盖通过                                                                                     |
| 界面              | 现有 Electron/Playwright 连接配置测试通过，工具目录只展示四个 Executor 工具，普通和窄窗口截图已查看，无溢出及相关 pageerror；复制说明包含能力前提，凭据不出现在页面预览                    |
| 锁文件            | 离线 frozen lockfile 校验通过，工作区剩余 12 个项目，无依赖版本升级                                                                                                                        |

原始失败与成功记录分别保存，没有跳过断言或放宽产品期限。首次传输测试对撤销响应期望 409，实际认证拒绝为 401，修正明确期望后通过。首次大文件复验在下载准备中耗尽测试助手的过密轮询次数；记录显示实际快照准备需 23,575 ms，测试改为遵守接口 pollAfterMs。2 GiB 往返本身仍受原 360 秒测试预算，上传校验/发布记录为 22,729 ms，不把这些单机耗时当作吞吐承诺。

Browser 插件不可用，界面沿用既有 Playwright Electron 流程。首次启动因宿主 ELECTRON_RUN_AS_NODE=1 将 Electron 当 Node 运行而拒绝 remote-debugging 参数；仅在测试子进程环境清除此变量。清理环境后的首次界面运行仍在原 60 秒预算超时，后续带诊断复验在相同预算内通过（约 51.7 秒）。当时首次超时的具体阶段和稳定性原因尚未定位，原始限制和失败继续保留；后续定位与修复见下方本日收口记录，不以一次暖态成功代替定位。

此前自动审批以 blocked by policy 拒绝旧客户端本地生成目录的清理，原始失败记录继续保留。2026-10-16 用户调整审批规则后，已删除整个 apps/executor-client 残留目录（旧 bundle、node_modules 和空源码目录）、Executor 中遗留的客户端依赖链接及 shared/dist/protocol 下四个 executor-transfer 旧编译产物，并逐项验证不存在。源码、manifest、依赖、锁文件 importer 和构建入口此前已删除。原始日志、截图和隔离验证副本保留；没有删除旧 journal、已发布文件或日常用户数据。

完整日志、隔离产物身份和截图留在本地 apps/executor/build/transfer-verification/；首次失败单独保留。未执行 Linux Agent、真实跨机、掉电、最终安装包或干净电脑验收，不将本机往返称为跨机验收。

## 2026-10-16 后续收口：原目录构建、正常实例与 UI 超时定位

原目录的原生输出已解除占用，完整 Executor 构建在原工作区通过（包含原生、Main、Preload、Runtime、Renderer），不再只使用隔离副本。沙箱内首次 Corepack 请求 npm 失败，升级执行权限后使用固定 pnpm 11.18.0 完成构建；两次输出分别保留。基于原目录新构建的四项文件传输冒烟测试全部通过，覆盖直连工具发现、系统 curl 零字节/多 MiB 双向传输、临时凭证隔离和真实在途上传的任务停止。

UI 超时已定位到交互测试夹具：Main 在 testMode 中明确不显示管理窗口（ready-to-show 仅在非测试模式 show），原 client-setup 用例直接在隐藏窗口中操作。阶段诊断显示 Runtime 在 16,416 ms 就绪，工具弹窗交互累计消耗至 37,054 ms，全部断言在 63,676 ms 完成，超出 60 秒总预算；关闭和清理只需约 337 ms，未发现进程退出卡死。另一轮直接观察到窗口 isVisible=false、isFocused=false，requestAnimationFrame 间隔 1,009/1,008 ms。

诊断仅显式显示并聚焦用例自身的窗口后，同一用例在 11,669 ms 完成。正式修复位于 test/integration/client-setup.test.mjs：复制子进程环境并删除 ELECTRON_RUN_AS_NODE；使用 app.browserWindow(page) 定位准确管理窗口，show/focus 后断言其可见且聚焦，再执行原有交互。产品后台节流、启动策略、原 60 秒预算和全部原断言保持不变。正式用例在故意保留宿主 ELECTRON_RUN_AS_NODE=1 的条件下通过（8,902 ms）；针对该文件的 ESLint、Prettier 和 git diff --check 通过。

从原目录启动的新正常实例已使用既有项目数据成功运行并保持运行。记录中的 Main PID 为 37244、回环监听 Runtime PID 为 17008，沿进程父链确认监听属于此次启动的 Main；未认证 GET /mcp 返回预期 401。未迁移或重置既有数据。完整启动记录保存在本地 20261016-normal-instance.json，进程号仅是本次证据，不作为后续操作的固定目标。

用户提供已连接的 LAPTOP-LH 远程桌面后，按 Computer Use 技能初始化 sky 并通过 list_apps/list_windows 唯一定位“LAPTOP-LH - 远程桌面连接”。首次激活被工具拒绝，精确错误为 Computer Use was not approved to use 远程桌面连接。收到用户“已授权”确认后再次尝试，并重建 node_repl 会话重新选择窗口，工具仍返回同一拒绝。未取得远程截图、未执行任何远程输入，不改用其他自动化通道绕过该应用访问控制。真实跨机验证仍被工具端应用授权阻塞，需要该访问控制实际生效后继续。

本轮 Docker/WSL 查询在沙箱内分别报告 daemon 管道缺失及访问拒绝；外部执行查询被用户拒绝，未重试或启动容器，因此没有新增 Linux 环境验证。真实两机、Linux Agent、满盘/掉电、正式安装包及干净电脑验收仍未完成。

上述原始失败、分阶段诊断、修复后的通过日志、正常实例身份和 Computer Use 阻塞记录继续保存在 apps/executor/build/transfer-verification/。旧客户端目录、依赖链接和 shared 旧传输产物的清理结果保持不变。

## 2026-10-16：验收包生成与手动携带

Computer Use 对既有远程桌面窗口的访问在后续重试中恢复；实际读取远端下载目录、磁盘列表及现有 Executor 状态页。现有远端界面没有新版文件传输工具；其已有 MCP 内网入口的无凭据请求返回预期 401，两台机器的控制端点可达。以上仅证明桌面访问及网络可达，尚未验证新版跨机文件传输。随后用户按实体 Esc 停止 Computer Use，未继续远程输入。用户选择由其手动复制新包。

从此前已完成构建的原工作区，通过固定 pnpm 的 package:acceptance 生成独立 unsigned 产物目录：apps/executor/release/0.0.1-unsigned-6304aea2-160c-4cbb-826b-95cc13bf1a4e/。productBuildId 为 b3d4fe3ad92b3c7a9020502890bd3ff861da464120a3af9513d2a61817dbc138，signed=false；未签名状态与正式发布门禁保持不变，不覆盖此前发行产物。

| 产物                                           |    字节数 | SHA-256                                                          |
| ---------------------------------------------- | --------: | ---------------------------------------------------------------- |
| Dr.Octopus-Executor-0.0.1-win-x64-unsigned.zip | 438157368 | f3a79a37de6e43b4b02904ecdf1dc46ca843a80712bbce5924733f5280c4aac2 |
| Dr.Octopus-Executor-0.0.1-win-x64-unsigned.exe | 342116101 | 1bae91f6624e8cc7442c21bd1a496caf35db9ceb82083bd2ed56b35891a66ed9 |

两份产物的实际长度和流式 SHA-256 均与 acceptance-artifacts.json 一致，另生成同目录 SHA256SUMS.txt。完整产品清单与产物身份测试、使用私有 Node 的便携清单验证器测试共 2 项通过。7-Zip 对最终 ZIP 的测试返回 Everything is Ok，包含 2,476 个目录和 17,867 个文件。实际打包 Runtime 包含四个新版传输工具。

首次直接运行 Node 打包脚本被工程入口校验拒绝，随后沙箱内 pnpm/Corepack 因网络限制失败；保留两次原始日志，按仓库规定的 pnpm 入口在批准的外部执行环境完成打包。没有修改脚本以绕过校验，也没有将旧包冒充本次源码产物。

用户手动携带推荐使用完整 ZIP，先退出远端旧 Executor，再完整解压到新的目录。新包尚未在远端运行；真实跨机文件流、远端授权及安装验收仍待后续执行。原始日志及交接摘要保存在本地 apps/executor/build/transfer-verification/，验收工具在本次产物目录的 acceptance-kit 子目录内。

## 2026-10-16：远端安装失败与 Host 修复

用户在 LAPTOP-LH 手动运行上述 EXE 后报告 Browser Host 注册失败。用户随后提供的只读 PowerShell 结果确认，Chrome/Edge 的注册均指向 `D:\下载\Dr.Octopus-Executor-0.0.1-win-x64-unsigned\resources\executor\bridge\native-host.json`，Exists=false。缺失旧 manifest 阻止身份确认是本次远端已证实的拒绝条件；未取得旧包实际注册脚本的异常全文，不将本地发现的编码缺陷认定为远端唯一根因。

独立回归另复现了 Windows PowerShell 按默认编码读取无 BOM UTF-8 JSON 的问题，中文旧安装路径会被误判为未知身份。注册脚本改为显式 UTF-8 读取 manifest 和数据 locator，保留完整来源集合校验、未知身份拒绝和旧卸载所有权检查。缺失 manifest 现在报告具体路径及恢复提示。验收诊断脚本同步使用 UTF-8，并将来源数量上限修正为当前完整身份的三项。

NSIS 失败分支增加退出码、脚本输出、临时 UTF-16LE 诊断日志及弹窗摘要。隔离夹具编译并运行真实安装宏，注册脚本替身返回 23，验证错误输出、退出码和中文路径完整保留；未运行真实用户安装或修改日常注册。夹具首次在沙箱启动编译器失败，权限升级后先后发现夹具误写只读 TEMP 常量和未指定 NSIS 源编码；修正夹具后通过，原始日志保留。

新增只读诊断回归通过，使用随机 OctopusHostTest 注册键验证完整三来源身份及中文路径、拒绝不完整身份且不改变注册。中文迁移与缺失 manifest 拒绝回归通过；同轮物理路径测试因命令遗漏 --import tsx 而加载失败，该命令失败单独保留。随后使用正式 pnpm test 入口完整复验 241/241 通过、无跳过，包含物理路径及真实 2 GiB curl 双向流；此次往返采样的 JavaScript 缓冲增量峰值为 22,284,065 字节，沿用原 128 MiB 上限。Executor lint、typecheck 通过。

针对用户已提供的精确失效路径，生成单次恢复脚本。仅允许在 LAPTOP-LH 运行，先检查两键无额外内容且仍指向同一缺失文件，再导出备份并移除。隔离测试证明路径变化时两键均保留、备份成功后移除两键、重复执行无副作用。用户随后手动运行并返回成功输出：Chrome/Edge 两键均已清理，备份保留在远端旧包目录旁 browser-host-backup-f1f0ca67901244e0aa7f5698e312cbca；重新安装和跨机文件流尚待确认。脚本和原始证据保存在本地 build/transfer-verification/，不作为通用自动清理能力发布。

修复后的 setup 通过现有构建身份生成函数重新生成并校验消费者摘要，未手改 dist 或重编译占用中的原生模块。固定 pnpm package:acceptance 生成新目录 apps/executor/release/0.0.1-unsigned-4a42908e-ccb2-416e-acb5-2ba3560ad9b5/，保留原失败包。新 productBuildId 为 6989f01fc2bfbd06b39e87308e04b181de1b532e3df3cc066990442fd77242a2，signed=false。

| 新产物                                         |    字节数 | SHA-256                                                          |
| ---------------------------------------------- | --------: | ---------------------------------------------------------------- |
| Dr.Octopus-Executor-0.0.1-win-x64-unsigned.exe | 342116844 | 861be390e1a0372cd4818de900de83711a9b2b70b1c2f05dfa5f5608cda28687 |
| Dr.Octopus-Executor-0.0.1-win-x64-unsigned.zip | 438157890 | c28e1d0e4669aaccd8990ee502dbc96807115c221d632837618c6288fab72c1f |

两份产物的实际字节数和流式 SHA-256 均与清单相符，同目录生成 SHA256SUMS.txt。新包完整清单和私有 Node 验证器两项测试通过；7-Zip 验证 Everything is Ok，2,476 个目录、17,867 个文件。NSIS 失败分支另有上述隔离运行验证。未在本机真实用户环境运行生产安装或卸载，新包远端重新安装及真实跨机文件流仍未验收。

用户随后反馈远端安装在进度条中间停留约 3–5 分钟，最终安装成功；尚未核对远端安装的具体 productBuildId，以上反馈只记为用户确认安装完成，不提升为完整发行或跨机文件流验收。检查新包清单发现 17,866 项清单文件合计 1,082,811,248 字节（最终 ZIP 另含清单本身）；其中 PortableGit 为 9,612 个文件、410,384,442 字节，Computer/Python 为 5,987 个文件、161,151,604 字节，Node/npm 为 1,936 个文件、106,117,105 字节。

固定 electron-builder 26.15.3 的 NSIS 模板在当前默认 7z 路径中先解压到 PLUGINSDIR/7z-out，再用 CopyFiles 复制到安装目录；oneClick 隐藏文件安装详情。大量散文件及双阶段落盘是已确认的安装工作量来源，但未取得远端分阶段耗时、磁盘或安全软件采样，不能认定 3–5 分钟全部耗于解压或杀毒扫描。后续优化应先测量解压、复制、进程检查和 Host 注册阶段，并评估资源文件数量及进度反馈；本轮未修改安装路径或裁剪私有资源。

## 2026-10-16：系统 Shell 决定与实施评估

用户同意采用系统 Shell，并要求先写文档及评估实施：Windows 实现 PowerShell 替换，Linux/macOS 的 Bash 分支仅声明并以注释占位。决定、显式 if-else 结构、命令传递/编码/退出码、Job 与搜索复用、持久结果、清理清单和分阶段验收统一记录在 [ADR-0084](../adr/0084-executor-system-shell.md)。

本轮只修改文档和索引，当前源码、PortableGit 资源及既有包均未切换。现有 241 项测试和包验收结果继续仅适用于原实现；没有将它们记为 PowerShell 替换通过。后续实施必须重新执行新命令语义、原生生命周期、搜索、MCP/stdio、打包和独立 Windows 验收，再报告资源差值及实际安装耗时。

## 2026-10-16：Windows 系统 PowerShell 实施

用户随后明确授权开始实施。Windows MCP 的 bash 已移除，以 powershell 提供系统 Windows PowerShell 5.1；shell.execute、HTTP/stdio、认证、任务和其他基础工具的契约保留。shell-platform.ts 与工程平台选择均使用显式 if-else，Linux/macOS 只有 TODO 注释和未实现错误。runtime_status.shell 返回实际探测的 kind/version/available，Shell 缺失时不广告该命令工具，也不阻止独立文件能力。

ShellExecutor 采用私有 UTF-8 BOM 的 CreateNew 脚本，固定系统解释器和参数；完成后校验身份再清理脚本，未知执行保留证据。process-supervisor 同时监管 PowerShell 和私有 fd/rg 搜索，保留 Job/管道/输出预算和树收束，不保留旧 Bash 模式。Shell journal 以新 Schema 和解释器身份隔离，旧记录明确拒绝并保留原件，不改写用户历史。

| 范围           | 实际结果                                                                                                                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 构建与静态检查 | 原工作区完整 build、lint、typecheck 通过。保留原有前端 chunk 大小警告。首次沙箱 Corepack 网络失败和一次新增夹具未使用变量的 lint 失败保留，修正后复验通过                                                                        |
| 聚焦回归       | 首轮执行/历史 16/16，通过；随后平台、执行、历史、私有 Node/npm、搜索、HTTP、stdio 共 55/55 通过；新工具发现/旧名拒绝、Shell 不可用和旧 journal 保留另有 4/4 通过                                                                 |
| 完整回归       | 247/247，无失败/跳过。覆盖真实 2 GiB curl 双向传输，以及 PowerShell 中文/引号/反引号/换行、16 KiB 上限、原始非 UTF-8 输出、64 MiB 上限、退出码、非终止错误、原生失败显式传播、取消/超时/父进程退出、后台残留拒绝、幂等和崩溃恢复 |
| 实际 Electron  | Utility Basic 测试与 client-setup 两项通过，均沿用原预算。界面工具目录断言包含 powershell 且不含 bash；授权、配置复制与凭据占位验证通过                                                                                          |
| UI 证据        | Browser plugin not available，沿用现有 Playwright Electron。普通 820 像素与窄 560 像素视口已查看；页面身份、非空、无错误覆盖、无相关 pageerror、工具详情/授权交互、凭据不泄露及无横向溢出通过，摘要单行省略按原设计保留          |
| 调用方夹具     | Server 的四份 Executor 集成夹具同步工具名、PowerShell 命令与丢包计数，语法和针对文件的 ESLint 通过；本轮未重跑完整 Web/RPC 链路及 600 秒长等待，未修改 Agent Core                                                                |

原生输出首次检测到仍运行实例占用 computer-escape.node，未强杀或覆盖；用户从托盘退出后完整重建成功。已删除本次明确拥有的 dist/resources/portable-git、build/vendor 的 PortableGit 归档/装配目录，以及 build/dist 中旧 bash-supervisor EXE/OBJ。装配源码、vendor pin、assemble:git 命令、CI 步骤、清单版本/入口/许可证依赖同步移除。其他资源、历史包、原始失败、隔离副本及用户数据保留。

日志保存在 apps/executor/build/transfer-verification/20261016-shell-*；旧截图已先归档至 20261016-shell-ui-before-PHNcT1，新截图和 QA 摘要位于 20261016-shell-ui/。新安装包与最终产物验证完成后另记身份；独立 Windows 新包安装耗时、干净机器、跨机文件流和 Linux/macOS 实机均未新增验收。

### 本轮最终验收包

固定 pnpm package:acceptance 已生成 apps/executor/release/0.0.1-unsigned-4b2f8336-c400-41dd-a1ca-82373d62438b/，productBuildId 为 b739a09fb4b59072c7dd52094eae316faa9a1edca3ebcb02d63323c04bf66d53，signed=false。旧包和旧验收材料保留，不覆盖。

| 新产物                                         |    字节数 | SHA-256                                                          |
| ---------------------------------------------- | --------: | ---------------------------------------------------------------- |
| Dr.Octopus-Executor-0.0.1-win-x64-unsigned.exe | 216051539 | 030e41a5922c23381392220896b8e7ad0561f85bba9dad28d03a6d0c8edbb561 |
| Dr.Octopus-Executor-0.0.1-win-x64-unsigned.zip | 270023823 | 9352dfc6990e2a7fbbe35b7dbe89410d45352099bd471c8da111f69f28d19b1b |

两份产物的长度和流式 SHA-256 与清单一致，并生成 SHA256SUMS.txt。相对上次 4a42908e 包，EXE 从约 326 MiB 降至 206 MiB，ZIP 从约 418 MiB 降至 258 MiB；ZIP 文件数由 17,867 降至 8,255，目录数由 2,476 降至 1,609。新 runtime-manifest 的 8,254 项清单文件合计 672,436,105 字节，不含 manifest 自身；比旧清单减少约 391 MiB。系统 PowerShell 以 operating-system/5.1 版本族需求声明，未伪装成包内文件，也未固定开发机 Shell 的哈希。

最终打包测试、清单及工具验证结果：

- 独立产品副本运行通过（约 50.4 秒）：仅为 Playwright 开启副本 inspector、替换副本 Browser 注册脚本，原包不变；在 system-only PATH 下通过真实 HTTP 执行七个 Basic 工具、私有 Node/npm 与中文 PowerShell，再通过真实固定 stdio 启动器执行中文命令并核对同一实际 Shell 版本。该测试不修改日常 Browser 注册，也不代替 Host 安装/卸载验收。
- 最终文件清单、私有 Node 清单验证器、Electron Fuses/ASAR 加固和随包 Chrome/Edge 四项复验全部通过。首次 3/4 通过，唯一失败是旧测试将扩展安装说明硬编码为 0.1.3，实际当前插件与包均为 0.1.5；改为逐字比较来源说明并验证 package.json 当前版本后，在同一包复验 4/4 通过，未放宽身份/文件断言。
- 7-Zip 最终 ZIP 测试 Everything is Ok。新增验收工具目录 acceptance-kit-b8d42484-a46f-4d14-850c-7b0a244d23ed 纳入当前交付说明，原先工具目录保留。该工具的只读 offline-preflight 通过，报告 preflight-system-shell-20261016.json 包含实际系统 Shell 可用性，G4–G6 保持 pending。
- UI 补充控制台 error/warning 采集后，同一 client-setup 流程在原 60 秒预算内再次通过（约 17.2 秒），无相关控制台告警或页面错误。第一次两项 Electron 回归结果保留。

完整回归内真实 2 GiB curl 往返通过，JavaScript 缓冲增量峰值 25,371,596 字节，仍使用原 128 MiB 上限。上述源码、UI、打包及离线预检均不能替代新包在 LAPTOP-LH 的重新安装及耗时测量、真实跨机文件流、干净机器或正式签名发行验收；这些项目仍未新增通过记录。Linux/macOS 注释分支也不计作平台实现。

## 2026-10-16：真实 Windows 跨机文件传输通过

用户亲测新包的远端安装时间已明显缩短并确认可接受，未提供精确秒数；该结论记录为用户反馈，不换算为安装吞吐或所有机器的时长承诺。随后继续主线验收，通过已连接的远程桌面确认 LAPTOP-LH 的 Executor 已启动，提供 PowerShell 和四项文件传输工具；本机对其内网 MCP 的无凭据探测返回预期 401。

用户手动提供网络 HTTP MCP 配置和远端独立目录。本次实际源机器为 ZGL，目标为 LAPTOP-LH，端点为 192.168.0.11:19876；脚本核对端点不是本机任何网络接口，并在开始任务前核对预期地址和设备名称。目标 runtime_status.deviceId 为 e0d2e121-6ee7-4009-a10b-2de7ca044ad3，Shell 为系统 PowerShell 5.1.26100.9711。验收任务只申请 files.write，未调用 Shell、Browser 或 Computer；用户提供的设备授权本身还含其他能力，本轮未修改授权。

控制面由普通 MCP SDK 直连，所有二进制数据由本机系统 curl.exe 8.21.0 直接从磁盘上传、下载至新暂存文件。临时 HTTP 凭据写入当前用户私有 ACL 的 curl 配置，不出现在进程参数、报告或模型上下文中；每次 curl 结束后确认文件身份并删除该临时配置。没有安装或运行额外的 Agent 桥接程序。

| 实际文件字节数 | 路径覆盖                      | 上传                | 下载与本机落盘                 | SHA-256                                                          |
| -------------: | ----------------------------- | ------------------- | ------------------------------ | ---------------------------------------------------------------- |
|              0 | 中文与空格                    | completed / applied | completed 且本机空文件验证通过 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
|      8,388,645 | 中文与空格，超过旧 4 MiB 边界 | completed / applied | completed、字节数与摘要一致    | b3b191de34036621be85553a6ba3aa48a18f3719bedc8f3e2f0f0eb8234b5dbe |
|     67,108,883 | 中文与空格，约 64 MiB 二进制  | completed / applied | completed、字节数与摘要一致    | 95d9e5bb58339582f97af6dc93d2ba0786d04ac734b329679423660d9d1fb6e2 |

64 MiB 案例的 curl HTTP 请求时间为上传 9.334006 秒、下载 9.129096 秒；下载快照准备不在下载 curl 计时内，这些是本次链路数据，不是性能承诺。各上传准备使用原操作键再次查询，transferId 保持一致；上传 completed 后不再返回 content。下载先落盘，再由本地流式计算字节数/摘要并发布本地文件，不把服务端 completed 当作本机已保存。

以下负向检查均在同一真实跨机链路通过：匿名字节请求 401、长期设备 Bearer 不能访问字节通道（401）、临时字节 Bearer 不能访问 MCP（401）、临时凭据不能反向 GET 上传通道（409）。另对约 8 MiB 文件限速上传，实际观察已接收 262,144 字节且仍 transferring 后调用 file_transfer_cancel；最终 cancelled、destinationEffect=not_applied，远端 ls 确认目标不存在，再次字节请求被 409 拒绝。

任务 d167338d-af29-4e0f-a1a5-66971dffe1ba 已正常 task_end，MCP 会话已关闭。后续只读核对六条完成传输和一条取消传输，七条均 cleanupPending=false；本机临时 curl 凭据配置剩余为零。验收源文件、下载文件、报告、用户提供的配置及远端三份已完成测试文件继续保留；没有自动撤销既有授权或删除用户配置。远端文件位于 `D:\下载\Executor-跨机验收-20261016`，文件名带本次 run UUID，未覆盖已有文件。

可复现探针为 apps/executor/test/packaging/cross-machine-transfer.mjs。原始成功报告和独立 cleanup-status.json 位于本地 apps/executor/build/transfer-verification/octopus-executor-cross-machine-20261016-eb822160f53f44508af5718d5ae064a6/；控制台仅输出摘要和报告路径，未记录配置正文或 token。首次初始化及诊断因输出目录未使用原生允许的私有目录前缀被拒绝，未读取授权或派发远端任务；修正验收目录名前缀后通过，原生约束未放宽，首次日志保留。

本轮新增探针的语法、ESLint 和格式检查通过；生产 Runtime/协议未改动，未为该实际链路验收重建产品或重复宣称包内 247 项回归。结论为真实 Windows 两机的文件流、凭据隔离、取消和清理验收通过。跨机 2 GiB、Linux/macOS Agent 或容器、真实满盘/掉电、完整 Web/RPC 和 600 秒长等待、干净机器及签名发布不在本轮新增通过范围内；此前本机 2 GiB 结果继续单独保留。

## 2026-10-16：远端 PowerShell MCP 工具实测

用户要求测试 powershell 工具后，复用其提供的私有网络 MCP 配置，从 ZGL 直接调用 LAPTOP-LH。开始任务前核对端点 192.168.0.11:19876、设备 ID e0d2e121-6ee7-4009-a10b-2de7ca044ad3、Shell 可用性和实际工具发现；任务只申请 shell.execute、files.read，不改变既有授权。实际 PowerShell 命令另返回机器名 LAPTOP-LH、版本 5.1.26100.9711、64 位及可执行路径 C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe，确认不是在控制端执行命令。

8 项实测全部通过：系统身份；中文/emoji/CRLF 文件写入、Get-Content 与管道；引号、反引号和美元符号字面量；exit 7；原生命令失败显式传播为 23；非终止错误写入 stderr 但进程退出码为 0；1 秒命令预算超时并确认 quiescent；同任务超时后继续执行成功。另以同一幂等键重复文件命令，结果完全相同，独立 Basic read 验证中文文件内容及计数文件仍为单个 x，未重复修改。

首次尝试已确认系统身份并成功执行文件/管道命令，但测试脚本未把 Get-Content 的带附加属性结果转换为普通字符串，ConvertTo-Json 因而输出含 value/PSPath 等字段的对象，严格结果断言失败。该次任务已停止，会话关闭，失败报告和文件保留。测试命令显式使用 [string](Get-Content ...) 后，在新的 UUID 子目录复验 8/8 通过；没有修改产品实现、放宽断言或扩大期限。

成功结果中，超时命令 effectiveTimeoutMs=1000，实际含准备/收束耗时 1167 ms；后续命令退出码为 0。任务与会话均正常结束。两次尝试的自建文件保留于远端验收根下各自的 PowerShell 验收 UUID 子目录，不删除已有文件或撤销既有授权。

可复现探针位于 apps/executor/test/packaging/cross-machine-shell.mjs。首次报告为本地 build/transfer-verification/remote-powershell-20261016-eeb51d798103494abe1b6eb82f6b8df3/report.json，成功报告为 remote-powershell-20261016-e4d14033bc4148bd9a48293960fc1e36/report.json。探针语法、ESLint、格式及文档差异检查通过，报告不含授权 token。该结果不提升为 Linux/macOS Shell、600 秒长等待、任意后台服务或干净机器验收。

## 2026-10-16：Windows-MCP 上游接入与 UIA 验证

用户授权整体替换未发布的 Computer，并确认所有截图/UIA/输入统一要求 computer.control。用户随后明确 UIA 是核心目标，撤销暂缓 Snapshot 的降级决定。当前接入固定 Windows-MCP 0.8.8（b74c507d9e709223a0904cf08019edf55f2a75bb），旧自有 product 后端移除；Computer 不开放上游 PowerShell/文件/任意程序执行。

### UIA 失败归因与修复

原版私有 Python 3.14.0 和通过 uv 安装的官方标准 Python 3.14.3 环境，均在同一 20 秒预算内 Snapshot 超时。按 HWND/进程跟踪显示，耗时集中在上游自己的控制装饰窗口；没有这些提示的上游 UIA 独立枚举约 0.24 秒完成。临时过滤本进程的 WindowsMCPControl_/WindowsMCPFlash_ 窗口后，Snapshot 约 3.87 秒完成并返回真实控件树。

现使用带源/目标 SHA-256 的最小固定补丁，在进入 UIA 前排除本进程专属装饰窗口。未改截图引擎、输入保护或用户应用遍历；外部同名前缀和本进程普通窗口仍保留。补丁说明与上游提交计划见 apps/executor/vendor/COMPUTER-PATCH.md，尚未向外提交 issue/PR。

私有 sitecustomize 将既有私有搜索根改为扩展路径，修复 MAX_PATH 下模块不可见；配置 comtypes.client.gen_dir=None 使用内存类型包装器，避免修改安装目录。不再对 comtypes 源码做字符串替换。最终真实 UIA/输入在此配置下复验成功。

### 已取得的验证证据

| 范围                 | 结果与限制                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全量单元与原生       | 224/224，通过；包含现有 PowerShell、搜索、文件发布、2 GiB 文件流及 MCP 生命周期。新增后续用例另行聚焦验证，不把 224 宣称为最终全部测试数量。                              |
| 清单、UIA 补丁与重启 | 6/6 聚焦复验通过；验证补丁幂等/源篡改拒绝、窗口所属过滤、重启竞争以及清单别名/穿越拒绝。                                                                                  |
| 最终 Computer 专项   | 8/8 通过，覆盖最终私有环境握手/长路径、真实 MCP 图像和未知结果恢复、UIA 补丁及重启竞争。                                                                                  |
| 构建资源逐字节核对   | 5,998 个清单文件、161,377,425 字节均与固定来源清单一致；旧 product 引擎不存在，输出 Schema 包含新九工具及 Snapshot。                                                      |
| 真实桌面             | 专属 Electron 窗口启用系统无障碍；Win32 前台核对后验证上游截图、Snapshot 中真实输入框名称、中文坐标输入、快捷键。最终内存 COM 配置下 1/1 通过，约 20.6 秒为整个测试耗时。 |
| Electron / Utility   | 后端真实运行、本机停止及注入 Escape 三项通过；授权/失联用例因旧界面定位先失败，按当前工具详情界面修正定位后独立复验 1/1 通过。已查看测试窗口截图。                        |
| 构建与静态检查       | 完整构建通过；保留现有前端 chunk 大小警告。lint、Node/Renderer typecheck 通过。后续清单和格式核对另保留原始日志。                                                         |

首轮失败保留：受限沙箱中的 asyncio socketpair 导致握手超时，沙箱外同预算通过；长路径模块导入失败经私有路径初始化修复；原版 UIA 超时在两个环境复现；未启用测试窗口系统无障碍时控件名断言失败；诊断脚本插入位置错误在执行输入前失败；GUI 用例旧状态定位和残留 row 变量错误修正后复验；清单测试受沙箱 junction 权限阻止，沙箱外原条件通过。临时资源装配的 .executor-asset.json 使用了原 JSON 键序，首次字节核对不符，已按正式装配器同一 Schema 序列化更正，未为任意运行文件重新生成信任摘要。

本地证据位于 apps/executor/build/upstream-computer-0.8.8/：原版/标准 UIA 日志、专属窗口日志、full-test.log、final-focused.log、gui-regression.log、gui-access-verified.log、uia-memory-cache.log、build-verified.log、lint-verified.log。旧失败与新成功分开保留。

尚未生成或安装本轮的新 EXE/ZIP，未升级远端实例。多屏混合 DPI、锁屏/UAC、独立电脑真实部分输入、干净机器及签名发行继续未验收；不把本机成功升级为这些门禁通过。

## 2026-10-16：Computer 源码整理（暂未验证）

按用户要求先优化代码，暂缓验证。移除不再参与输入放行的 ComputerIndicatorConfirmation IPC、活动 ready 回调和空的 Computer 观察失效调用；保留任务彩带与本机停止。上游调用命名改为 callTool/isConnected，参数映射按各工具 Schema 收窄，区域校验归输入 Schema；后端重连逻辑从构造回调移入具名方法，版本投影复用固定常量。关闭操作在执行 SDK 清理前缓存 Promise，清理失败保留 failed 状态和启动/清理原因，并始终退订控制通知。

同步调整调用方与相关测试源码，新增关闭失败状态用例，但本轮未执行测试、typecheck、lint、构建、应用启动或硬件验收；此前 224/224、Computer 专项和真实 UIA 结果只适用于整理前的代码与构建。当前仅做格式化和源码差异检查。后续恢复验证时，应覆盖参数映射、重连/关闭竞争、清理失败、状态彩带、停止、真实 UIA 和现有工具回归。

## 2026-10-16：UIA 超时归因复核（修正此前结论）

用户要求排除转发参数问题。本轮对官方 GitHub v0.8.8 的 desktop/service.py 与独立标准环境安装文件逐字节摘要核对，均为 c116adc0d221c993a89596a14f0ac66bf924e250672cb2691a8914b0e788231e。随后使用官方 MCP SDK 的 StdioClientTransport 直接运行标准 Python 3.14.3 / Windows-MCP 0.8.8 / FastMCP 4.1.0，不加载 Executor、不使用自定义 transport/Job，也不注入 Python 包装或过滤函数。

| Snapshot 参数                                                                        | 20 秒原预算   | 90 秒诊断上限下的实际结果              |
| ------------------------------------------------------------------------------------ | ------------- | -------------------------------------- |
| 官方默认参数 {}                                                                      | 20.008 秒超时 | 26.505 秒成功，返回 UIA 文本           |
| 实际转发参数：use_vision=true、use_ui_tree=true、use_dom=false、use_annotation=false | 20.005 秒超时 | 27.819 秒成功，返回一张图像与 UIA 文本 |

90 秒仅为区分慢调用和永久阻塞的诊断上限，没有修改产品 20 秒期限，也不将此记为原预算通过。调用后仅清理本次直接启动的进程树；未保存 UI 文本或图像。证据为 build/upstream-computer-0.8.8/plain-sdk-defaults.json、plain-sdk-executor.json、plain-sdk-long-measurement-defaults.json、plain-sdk-long-measurement-executor.json 及 plain-sdk-probe.mjs/plain-sdk-measure.mjs。

更准确结论：实际转发参数符合官方 Schema，且原版能完成相同请求；不能把 20 秒超时直接归为上游 UIA 不可用或永久死锁。客户端超时预算是本次失败的一部分，上游自身装饰窗口的额外 UIA 查询是已有证据支持的性能开销。过滤优化有效不等于补丁是唯一方案。此轮未修改产品源码、期限或现存补丁；也没有验证上一节源码整理后的整体应用。

## 2026-10-17：撤销本地补丁与调用维护性优化（本机验证完成）

用户同意恢复未修改上游，并在代码整理后开始验证。已删除 JSON 替换补丁、构建应用逻辑、补丁摘要/字节差特判和补丁专属测试。私有资源由现有固定官方归档在新目录重新装配，旧装配目录只移至本次 build 隔离目录保留，不提供运行期回退。资源配置不修改上游；保留深路径导入和 comtypes 内存类型包装器配置。

### 原版 UIA 耗时证据

使用新装配私有 Python 和实际受管 Job，核对 desktop/service.py SHA-256 为官方原值 c116adc0d221c993a89596a14f0ac66bf924e250672cb2691a8914b0e788231e。两次独立启动耗时分别为 5.797 秒、5.369 秒；每次执行三次 Snapshot，不保存 UI 文本或图像。

| 独立会话 | 不带图像首次 Snapshot | 带图像第二次 | 带图像第三次 |
| -------- | --------------------- | ------------ | ------------ |
| 1        | 26.525 秒             | 16.587 秒    | 31.804 秒    |
| 2        | 26.936 秒             | 16.790 秒    | 32.440 秒    |

六次调用均成功，所有带图像请求返回一张图像，两个 Job 均确认清理。数据支持当前 Snapshot 60 秒上限的本机配置，不证明所有机器和桌面复杂度均满足该预算；历史 20 秒失败保留，不重记为通过。证据为 build/computer-maintenance-20261017/measure.log、unmodified-timings.json、measure.mjs。

### 调用与状态规则

工具定义统一持有上游名称、Schema 关联、副作用分类及执行预算。Snapshot 与冷态可能触发完整 UIA 的 App switch 共用 60 秒上限/30 秒最低准入，其余调用 10 秒上限；TaskAuthority 提供授权等待和任务剩余时间中较短的截止时间，Computer 预留 10 秒收束，状态预检与执行共享一个绝对期限，进度通知不续期。

观察中断返回 COMPUTER_OBSERVATION_INTERRUPTED，保留结果不完整和控制需收束状态，不声称发生未知输入；输入派发后不明确返回 COMPUTER_RESULT_UNKNOWN。上游明确完成但报错与传输不确定性分开。已报告完成的输入仍需验证应用业务效果。后端退休集中处理，Runtime 停止与重连冲突不能发布迟到 ready。首页支持数量与后端真实状态分别显示。

### 用户退出运行实例前的验证范围与阻塞

- 聚焦源码用例 26/26 通过：预算、派发前拒绝、预检扣时、观察/输入失败区别、控制通知、重启/关闭竞争、上游源字节未修改及私有配置重复发布。此前资源测试第一次因 Buffer 与 Uint8Array 的比较类型差异失败，统一字节容器后复验通过，没有改变源字节断言。
- Node/Renderer typecheck 已通过。lint 曾指出格式及异常 cause 归属问题，已修正，末轮 lint 全部通过（lint-verified.log）。
- 官方归档装配成功；源码中无补丁应用或运行时函数替换逻辑。最终构建资源清单及应用 UI 尚待新构建后验证。
- 完整构建首次被 dist/native/computer-escape.node 占用拒绝，错误 EXECUTOR_NATIVE_OUTPUT_BUSY。只读进程检查确认本仓库存在非测试 Executor 实例；未强杀、未覆盖原生文件，也未拿旧产物宣称新构建成功。已请用户从托盘完整退出，之后才能完成新构建、原生/全量回归和 Electron 界面验证。

本轮未生成安装包，未更新远端实例；上一轮 224/224、本机截图输入和 UIA 小补丁结果不作为本轮最终通过证据。Browser 插件/browser skill 未列出，后续 Electron 视觉回归沿用仓库已有 Playwright Electron 工作流。

### 用户完整退出后的完成结果

用户确认已从托盘完整退出后，重新构建成功；未强杀日常实例或覆盖加载中的原生文件。首轮完整回归 233/233 通过，约 420.2 秒，无失败/跳过，覆盖 PowerShell、文件发布、2 GiB 文件流、MCP 和新预算/观察中断用例。

首轮 Electron 五项中四项通过，原版 UIA/截图/输入和 Utility owner 均通过；注入 Escape 用例在它前面的 App switch 超时。源码核对确认上游冷态窗口切换在 _find_window_by_name 中调用完整 get_state，因此不能采用普通动作 10 秒预算。将窗口切换纳入已测量的 60 秒 UIA 策略后重新构建，没有修改上游或降低结果/前台断言；该首次失败保留于 electron-test.log。

| 最终范围           | 实际结果                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 完整构建           | 初次退出后构建成功；窗口切换策略修正后再次构建成功，保留既有前端 chunk 大小警告。                                                        |
| 全量回归           | 233/233 通过；最后一次窗口切换策略及测试证据调整后，按影响范围聚焦复验，不把全量记录伪称为之后再次全跑。                                 |
| 最后构建后的聚焦   | 26/26，通过预算、错误/内容校验、Runtime/连接生命周期竞争和未修改上游配置；窗口切换预算已纳入断言。                                       |
| 原版真实桌面       | screenshot、Snapshot 内测试输入框名称、中文坐标输入及快捷键均通过，专属窗口整例约 56.97 秒；仍使用60秒UIA策略，未恢复补丁。              |
| 最终 Electron 复验 | 首页授权/就绪/失联、本机停止、窗口切换后注入 Escape 共3/3通过。窗口切换/注入整例约44.35秒，输入前额外核对拥有窗口的Win32 HWND。          |
| 静态检查           | 最后一轮 Node/Renderer typecheck、全应用 lint、格式及 git diff --check 通过。                                                            |
| 资源字节           | 5,998项、161,376,876字节全部匹配归档派生清单；上游service.py为官方原始SHA-256，旧product引擎与补丁不存在。                               |
| 视觉检查           | 已查看最终 desktop-ready.png 与 desktop-disconnected.png，支持数与真实状态分开显示；截图关闭有限动画，避免把弹窗退场中间帧当作布局问题。 |

最终日志均在 apps/executor/build/computer-maintenance-20261017：build-after-exit.log、build-app-budget.log、full-test.log、focused-after-build.log、electron-test.log、gui-final.log、resources-final.json、lint-complete.log；截图在 screens-final/。源码未再修改；文档按这些实际结果收尾。

该验证没有新增远端安装、锁屏/UAC、混合DPI/多屏、独立电脑或签名发行证据；没有生成新的EXE/ZIP，也未替用户重新启动日常Executor实例。上游首次预算失败、UIA性能归因修正及早期补丁实验继续按历史记录保留。

## 2026-10-17：会话恢复发现与代码精简（本机验证完成）

本轮在现有上游集成上修正离线会话的恢复发现：创建会话时按授权注册稳定 Computer Schema，listTools 按实时连接和授权过滤。显式任务生命周期变化发送 tools/list_changed 提示。注册和显式列表投影共用工具 annotations，避免只在注册时声明而实际发现时丢失。

Computer 返回值已从 unknown 改为明确结果类型，MCP 图像输出取消类型断言，统一结果 Schema 包含状态、完成内容和保留摘要。结果模块由工具执行与 MCP 序列化共同消费，独立于生命周期实现；没有为文件长度拆分。删除未使用的 owner 参数和 Browser 图像分支中永远不执行的备选路径，保留权限、状态、容量和收束检查。

失败诊断只输出阶段、工具、错误码、耗时及清理确认，不含原始异常、文本输入或UI数据；诊断写入失败不改变执行错误。私有配置和归档派生清单复用确定字节来源，资源版本与编译后的工具契约版本不一致时拒绝构建；没有修改上游源码。

构建、lint、Node/Renderer typecheck 首轮通过。聚焦30项及独立MCP恢复/权限6项已通过；全量及最终Electron正在串行验证，完成结果随后记录。最初类型检查发现启动诊断的计时变量未定义，已补齐并通过复查；未将这次初始检查记为通过。原版UIA与第三方二进制版本未改变。

证据目录为 apps/executor/build/computer-cleanup-20261017。未生成EXE/ZIP，未升级远端实例，独立电脑/混合DPI/锁屏UAC门禁保持原范围。

### 最终验证结果

- 全量单元/原生回归 239/239，无失败或跳过，约379.2秒；包括恢复发现、未授权/撤销、预算、结果契约、诊断脱敏、配置版本不一致拒绝、PowerShell和2GiB文件流。
- Electron 首轮五项中四项通过：真实授权/失联、Utility owner、本机停止、注入Escape。综合桌面用例在等待Win32前台60秒时被保护拒绝，未派发截图或键鼠，不是上游调用超时。首轮失败完整保留。
- 综合桌面用例按同一前台条件与工具预算单独复验1/1通过，约55.8秒；验证原版截图、UIA测试输入框、中文输入和快捷键，没有修改上游、放宽期限或删除断言。
- 最终构建成功，保留既有chunk大小警告；lint、Node/Renderer typecheck通过。最终格式检查发现三处调用参数整理后的排版，已仅格式化修正，源码差异检查通过。
- 资源清单5998项、161376876字节逐项核对通过，上游service.py仍为官方SHA-256 c116adc0d221c993a89596a14f0ac66bf924e250672cb2691a8914b0e788231e。配置单一来源没有改变发行资源字节；旧引擎与自制补丁仍不存在。

本地日志位于 build/computer-cleanup-20261017/：build-final.log、focused.log、diagnostics.log、resource-diagnostics.log、discovery.log、full-test.log、electron-test.log、desktop-retest.log、resources.json和lint-final.log。首轮前台失败与复验成功分开保留。未生成新安装包或执行远端、混合DPI、锁屏/UAC、独立电脑验收。

## 2026-10-17：未签名新包与包级验证收尾

本轮继续前述交付收尾，使用固定本地资源生成新安装包与 ZIP，不签名、不发布、不安装到日常或远端环境。源码全量 239/239 的记录属于上一轮；本轮新增构建期初始化和测试夹具修正后，按工程与交付影响范围重新验证。

### 首次失败、实际原因与修正

- 沙箱内首次打包在 pnpm 许可证收集阶段失败，单独复现得到 ERR_SQLITE_ERROR / unable to open database file；允许访问本地依赖存储后打包成功，没有下载替代依赖或跳过许可。
- 第一批包为 0.0.1-unsigned-633fca47-8553-4a13-94ac-247716ce14ac。初始清单核验通过，但原版 comtypes 首次导入在安装树生成 56 字节 comtypes/gen/**init**.py，后续核验因此拒绝。逐项比较确认只有这一新增文件，没有修改或丢失既有文件。该批产物和首次失败均保留，不作为本轮最终交付包。
- 修正为在构建和显式资源装配时，用固定私有 Python 正常导入原版 comtypes，由库自身生成包标记；校验其固定大小和 SHA-256 后纳入归档派生清单。没有手写/替换第三方源码、恢复 UIA 补丁或增加运行时完整性扫描。运行期包装器继续使用支持的 gen_dir=None 内存配置；包测试新增后端启动/关闭后完整清单不变的断言。
- 包级测试的旧定位位于折叠的服务详情中，改用当前可见的“连接”页入口。Host 响应实际为协议 v3，旧断言仍是 v2；改为引用共享 bridgeVersion。公开配置已使用设备 connectionKey，综合和恢复夹具仍读取旧固定键；改为根据实际设备身份取键，保留真实握手、目录移动、授权、原配置字节和结果不重放断言。
- 第一轮负向用例筛选未排除完整启动测试，实际将 Chrome/Edge Host 注册指向随后删除的临时测试副本。这是本轮测试隔离失误。已保存证据并只清理仍精确指向该副本、没有其他值或子项的两个残留键，未结束日常进程。测试前注册值没有留存，无法据此证明原注册已恢复；未猜测恢复位置。用户随后确认此前已配置，并选择自行在日常 Executor 中重新配置浏览器连接。恢复方式已确认，实际重配尚未由用户报告完成；不再自动修改注册。
- 普通包级 GUI 用例现与既有恢复/Shell 用例一样，只在独立副本替换注册步骤。原样产品启动可能自动迁移 Host，改为与安装卸载一样要求专用验收机显式启用。修正后的两轮测试前后均确认 Host 注册未变化；不再依赖测试名称筛选保证隔离。

证据目录为 apps/executor/build/computer-cleanup-20261017。package-first.log、package-license-first.log、package-tests.log、package-tests-final.log、package-registration-incident.json 和 package-inventory-differences.json 保留上述原始失败及差异；package-tests.log 在发现误执行后明确停止，不作为完整测试结果。

### 最终构建与本机包级结果

- 新构建成功，保留既有前端 chunk 大小警告；全应用 lint 和 Node/Renderer typecheck 通过。
- 工程聚焦 10/10，通过资源配置、原版字节、版本不一致拒绝、归档安全及清单。首次沙箱运行 9/10，junction 创建被 EPERM 拒绝；在允许创建测试 junction 的环境下按原断言复验 10/10，没有跳过或放宽链接检查。
- 新包完整测试共 12 项：10 通过、0 失败、2 明确跳过，约 210.2 秒。包含完整资源和私有 Node 核验、最终 PE/Fuse/ASAR、插件字节、Computer 受管握手和退出后清单不变、HTTP/stdio、系统 PowerShell/私有 Node/npm、安装目录移动后的授权与结果恢复，以及拥有的 NSIS 注册失败夹具。
- 两项未执行为原样产品启动及实际用户安装卸载，均因可能修改真实 Host 注册而保留给专用验收机。普通测试使用独立数据、副本和端口；最终 package-registration-initialized-before.json / after.json 一致。
- Computer 资源 5,999 项、161,376,932 字节逐项匹配。上游 service.py SHA-256 仍为 c116adc0d221c993a89596a14f0ac66bf924e250672cb2691a8914b0e788231e；新增的原版初始化产物为 56 字节、SHA-256 0d474e302634b834072be47bae442dd92b5919dba7870f13e8c8f91272dd8f68。Computer Schema 保持九项并包含 computer.snapshot。

最终产物位于 apps/executor/release/0.0.1-unsigned-13dbf54a-9efc-421a-beae-ac14578ccb68，productBuildId 为 fa01e8cc4b11d25d9a5442577a6b37bc9ec04b2548425d178951aa85fd7ac954，signed=false。ZIP SHA-256 为 2c577e88f75792c71441ad5487990c271dbcf552a0ac9bc6c1f26008e55e4519，EXE SHA-256 为 244c96e532c3acdee316aa76065a3550762092b3f73b95fe4abb720f875bfc92。新包不会更新已有安装或远端实例。

实际 ZIP 已解压到新的独立目录，含清单自身共 8,266 个文件。随包私有 Node 完整核验通过，清单覆盖 8,265 项、672,399,323 字节，productBuildId 与 EXE/ZIP 元数据一致；随包离线预检也通过，包含 123 项许可记录。报告为 zip-runtime-inventory.json、zip-offline-preflight.json；本机有开发工具且并未断网，预检明确保留 G4/G5/G6 pending，不是干净机器证明。沙箱预检的注册视图与主机测试前后记录不同；随后在主机视图只读复验通过，注册数为零，报告为 zip-offline-preflight-host.json。零残留不证明测试前的原注册已恢复。

本轮日志为 build-package-initialization.log、package-focused-final.log、package-lint-complete.log、package-typecheck.log、package-initialized.log、package-tests-initialized.log 与 resources-initialized.json。真实独立电脑、锁屏/UAC、混合 DPI、多屏/GPU、跨机和签名发行门禁保持待验，不因本机新包生成而提升。

## 2026-10-17：GitHub Actions 未签名交付流程（本机演练完成，远端待验）

完善 .github/workflows/executor-windows.yml，名称改为 Executor Windows unsigned delivery，保留 PR 和手动触发。shared 构建已提前到资源装配之前，解决干净检出时工程接口依赖 shared/dist 的顺序问题。pnpm 版本从根 packageManager 读取并要求固定版本；扩展使用明确 sideload profile，真实安装/注册用例明确禁用。没有新增签名、GitHub Release 创建、发布令牌或日常应用操作。

打包使用本次 run_id/run_attempt 独有的新目录，只接受此次调用生成的一份完成产物，不扫描旧 release 的最新目录。随包离线工具核验 EXE/ZIP 摘要、win-unpacked 和实际 ZIP 解压目录；六项有限回归从 ZIP 执行，包含原版 Computer 握手与确认退出后的清单不变。测试结果必须实际为六项通过、零失败，不能以空筛选或扩选替代。

只有完整核验和暂存完成且目录输出非空时，才上传独立交付附件。附件包含 EXE、ZIP、元数据、验收工具、BUILD-INFO、SHA256SUMS 和四份核验报告；不上传 win-unpacked、下载缓存或测试私有配置。交付物保留 14 天，诊断日志独立保留 7 天，失败也尝试保留已有日志/报告。Summary 的下载链接来自真实上传动作输出，同时列出源提交、版本、productBuildId、摘要和未验收边界。

### 本机实际验证

- YAML 唯一键解析与全部十个 PowerShell run 块的 AST 语法检查通过。actionlint v1.7.12 检查通过；工具来自官方 GitHub Release，并验证官方校验文件中的 ZIP SHA-256，工具及来源记录只在忽略的 build 目录保存。
- 从工作流提取并执行实际 package、verify、有限测试、stage 和 Summary 代码块，未重写一套等效流程。演练复用此前完成的本机构建，未重复依赖安装、资源下载和源码全量检查；这些初始化步骤及修正后的构建顺序本轮完成静态核对，干净 GitHub runner 的完整执行仍待验证。
- 新 EXE/ZIP 在 .tmp-ci-1017-1/executor-package-20261017-1/0.0.1-unsigned-a088171a-6003-4289-b3a8-b7eb46a24811 生成，两个产品树核验和暂存后离线复验均通过。产品身份仍为 fa01e8cc4b11d25d9a5442577a6b37bc9ec04b2548425d178951aa85fd7ac954；不会把相同内容身份解释为远端已构建。
- ZIP 有限回归实际 6/6，约 41.3 秒，无失败、跳过或取消；筛选没有运行 GUI、安装或注册用例。
- 独立复核交付目录：22 个文件的 SHA-256 全部匹配，SHA256SUMS 自身不计入自身摘要；根目录恰为 EXE、ZIP、acceptance-artifacts.json、BUILD-INFO.json、SHA256SUMS.txt。摘要文件为无 BOM 的 UTF-8/LF，目录没有混入完整产品树或 node_modules。
- 原样重复调用打包和暂存步骤，均在写入前明确拒绝已有目标，没有发布步骤输出或覆盖既有文件。成功和失败两种 Summary 分支均检查通过，失败分支不显示下载链接。
- 最终 actionlint、格式和 git diff --check 通过；没有修改 Runtime/工具实现或重跑无关的全量源码回归。

原始材料位于 apps/executor/build/actions-delivery-20261017/：rehearsal.log、logs/package.log、logs/package-ci.tap、三个产品核验报告、delivery-check.json、existing-output-refusals.json、两个 Summary 样本及 actionlint 工具来源记录。rehearsal.json 明确 githubUpload=not-executed；本地 BUILD-INFO 的 event=local_rehearsal，成功 Summary 的占位链接只用于分支格式检查，没有创建远端附件。

本轮未提交/推送源码，也未触发远端 Actions 或上传 GitHub 附件。工作流及它依赖的重构源码、vendor 配置和许可证需要一起进入仓库；远端首次执行的通过/失败证据另行补记。独立电脑、硬件、安装卸载和正式签名门禁仍待实际验收，不将本机演练提升为远端 CI 或发行通过。

## 2026-10-18：远端首次构建的许可证换行修正

首次远端运行 [39128217356](https://github.com/nebulaedata/dr-octopus/actions/runs/39128217356) 使用源码 35afc0bd9b24da84da38b6ef6652ac6c6a2d8c7b，在 assemble:packaging 阶段因 Pinned cfworker notice digest mismatch 失败，尚未执行构建、测试和打包。原始日志保留于该运行及对应诊断附件，本地副本按验证材料批次目录保存。

根因是 Windows Git 自动换行转换：仓库及固定上游原文均为 1,070 字节、LF，SHA-256 为 376944252ab78ca6b41aee44ddea8894927ee67891e77e61eb9d59af63e35094；Windows 工作副本转换为 CRLF 后为 1,091 字节，摘要变为 1eda211d873cf624198d343951c383c7ec717cc311432e3e8e5f5f707275f211。根 .gitattributes 为该固定原文添加精确路径 eol=lf，保留既有原文字节摘要校验。

本地以 core.autocrlf=true、core.eol=crlf 执行独立 checkout-index，检出仍为 1,070 字节且摘要匹配；pnpm --filter @octopus/executor assemble:packaging 复验通过。仅调整检出属性和说明，没有改变应用源码、依赖或许可证原文；未重跑无关的应用测试、lint 和 typecheck。修复后的完整远端构建、安装和下载功能仍待验证。

## 2026-10-18：远端第二次构建的临时目录短路径修正

远端运行 [39128659668](https://github.com/nebulaedata/dr-octopus/actions/runs/39128659668) 使用源码 89636e49efe0e419727a6b3befaefd579a460970。许可证及全部资源装配已通过；扩展 build/lint/typecheck 和 22 项测试通过，Executor build/lint/typecheck 通过，Executor 测试为 239 项中 99 项通过、140 项失败，尚未进入打包。原始失败日志保留在该运行及诊断附件，本地按验证批次保存，未以重跑覆盖。

本次失败来自 runner 默认临时目录 C:\Users\RUNNER~1\AppData\Local\Temp 的 8.3 别名：125 项直接触发 Native paths must be canonical local DOS paths，其余出现真实路径不等、RELEASE_ROOT_ALIAS、持久记录初始化失败和后续等待中断。工作流在依赖安装前创建本次 run/attempt 专属临时目录，用 realpathSync.native 展开真实路径并校验本地 DOS 路径及无短路径别名，再经 GITHUB_ENV 同时设置后续步骤的 TEMP/TMP。仅调整本次 CI 作业的环境，不放宽原生路径、链接、清单或测试断言。

本地使用真实存在的 8.3 临时目录别名复现，security 和 native/device-identity 两个测试文件共 7 项中 5 项失败；执行从修改后 YAML 提取的原始准备步骤，再加载其环境输出，相同 7 项全部通过。该演练故意给 RUNNER_TEMP 传入短路径，确认步骤会展开真实目录，而非仅替换到另一个未经核验的路径。

Executor 新构建、lint 和 typecheck 通过。首次本地全量复验为 239 项中 224 项通过、15 项失败：短路径复现目录又嵌套了过长的父目录，触发 PowerShell 脚本路径长度和子进程启动问题，原始 executor-test.log 保留。随后给同一 YAML 准备步骤传入与 runner 相近的 D 盘短根目录，复验覆盖所有 15 项失败的五个原生测试文件，35 项全部通过、零跳过；私有 npm 仍使用原 30 秒预算，未修改断言或应用实现。其余 224 项包含实际 2 GiB 往返传输。actionlint v1.7.12、全部十个 PowerShell run 块 AST 语法检查与工作流格式检查通过。远端完整测试、打包、交付附件、安装和下载功能仍待实际验证。

## 2026-10-18：远端第三次构建的 Electron 发行资源准备修正

运行 [39130530914](https://github.com/nebulaedata/dr-octopus/actions/runs/39130530914) 使用源码 449429b7114cb4ba179b41c0265be2019fd6a299。临时目录准备、资源装配、扩展及 Executor 的 build/lint/typecheck 全部通过；扩展 22 项、Executor 239 项测试全部通过，零失败和跳过，确认上一轮短路径问题已在真实 runner 解决。随后 package:acceptance 因指定 electronDist 不存在而失败，未上传交付包；原始运行日志与诊断附件保留。

锁定的 electron 44.4.5 package.json 不再提供 postinstall，而是提供 install-electron 二进制命令。pnpm rebuild electron 不会执行其发行资源安装，源码构建和非交互测试也不需要 Electron dist，因而直到打包才暴露缺失。工作流改为显式执行已安装锁定包的 install-electron，沿用官方安装脚本及 checksums.json；随后读取 electron 入口、实际二进制和 dist/version，要求版本与依赖包精确一致并独立保存日志。保留 --frozen-lockfile、--ignore-scripts、固定版本及全部原生测试，不开放工作区生命周期脚本。

本地从没有 dist/path.txt 的独立目录复制未修改的锁定 Electron 安装脚本、package.json 和 checksums.json，使用同一依赖解析执行官方安装，生成 electron.exe、path.txt 及匹配的 44.4.5 版本；完整工作区的 install-electron 和同一版本检查也通过。该验证不是干净机器安装或产品 GUI 启动。应用源码与依赖版本未改变，239 项远端测试的源码结论继续有效；修正后的远端打包与交付仍待验证。

## 2026-10-18：远端第四次构建完成未签名交付

运行 [39131666369](https://github.com/nebulaedata/dr-octopus/actions/runs/39131666369) 基于源码 7a87adb24f1240512d3d2954d744a022fcf24532，于 2026-10-18 21:39:49（UTC+08:00）成功完成，耗时 11 分 45 秒。显式 Electron 安装输出 Prepared Electron 44.4.5；资源装配、扩展和 Executor 的 build/lint/typecheck 全部通过，扩展 22 项、Executor 239 项及实际 ZIP 的六项非交互验收全部通过，零失败、取消或跳过。打包目录、实际 ZIP、交付暂存目录的离线预检及清单检查均成功，确认两个已修正的 CI 问题均已越过原失败阶段。

已上传 [交付附件 12138915414](https://github.com/nebulaedata/dr-octopus/actions/runs/39131666369/artifacts/12138915414)，名称 executor-windows-x64-unsigned-39131666369-1，488,313,547 字节，附件归档 SHA-256 为 2fe7b57c0f5a842f3cf7f10fa1e52d76d8ab0ae6117b15fe920d0c2a41be2b36，按工作流保留 14 天。产品版本 0.0.1，productBuildId 为 ab687f2822045866e99de0f1aff9e224eebc3203c1516a6adf7a56885737779e。Summary 公布 ZIP SHA-256 为 b44d6896e6f513a1580f5549526a639fcd5da3a1fd41a91949134567897d5481，EXE 为 938c2cb9a3944d8c89bdef2fc23523ac41f24dfbfecf7dedd3534864e63fed70。诊断附件 12138855625 独立保留 7 天；原始成功日志、结果 JSON 和网页截图与先前失败日志分开保存。

同轮本地使用从 YAML 提取的原始 package、verify 和六项有限测试步骤完成独立演练。新包目录标识 0.0.1-unsigned-41a78420-51e2-464a-aaaa-97c0149861b5，productBuildId 为 9cefe4f3fb0c55ddde787721407a4e4729645876adcd96350b29e081a371ce59；EXE/ZIP 生成、随包离线预检、两个产品树清单及 6/6 非交互验收通过。该本地产物与远端交付产物分别按身份记录，不混用摘要或提升为相同构建。

本轮仅完成未签名 Actions 交付附件，没有创建 GitHub Release，没有在日常环境安装、启动产品 GUI、修改 Host 注册或测试网站下载入口。网站下载、真实安装/升级/卸载、G4/G5/G6、独立电脑硬件和签名发行继续待验，不因 CI 成功改变这些状态。

## 2026-10-18：Release Assets 自动发布与 Web 下载默认值接入

为后续 v0.0.13 接入 release:published 触发及独立发布任务。构建任务仍为 contents:read，只在发布任务授予 contents:write；通过 artifact-id 接收当前验收附件，复核全部摘要、产品身份、验收结论及实际 Tag 提交后附加 EXE/ZIP 和版本化元数据。支持同字节保留、部分上传失败后从原任务继续，拒绝重名不同摘要覆盖。Web 从仓库 Release 与独立 Executor 产品版本生成同 Tag 的下载路径，Turbo 追踪版本清单与公开配置覆盖，避免复用旧链接。

本地 Web build、tsc -b、lint/i18n 及 284 项测试通过；Executor lint/typecheck 和 112 项根级测试通过，发布与工程入口聚焦检查 19 项通过。新增发布用例使用独立文件及 GitHub 协议替身，覆盖篡改字节、遗漏清单、路径穿越、非 Tag 来源、未完成验收、草稿/移动 Tag、资产冲突及部分失败恢复，没有修改真实 Release。actionlint v1.7.12 和工作流 run 块语法检查通过。新版本实际 npm/GitHub 发布、远端构建上传及浏览器下载入口尚待执行；未将本地替身验证提升为公网交付证据。

### v0.0.13 实际发布与下载复验

正常版本流程将仓库版本从 0.0.12 升至 0.0.13，并推送提交 50e235a7aaba9e8116bd8d50585f2807873473fa 及注解 Tag v0.0.13。pnpm release:publish --resume --yes 完成新构建、npm 上传及 GitHub Release 创建；npm 曾明确返回处理中，等待后公开查询已为 200，bin[dr-octopus] 正确保留为 bin/dr-octopus.mjs。没有重复发布同版本或移动既有 Tag。

发布事件自动触发 [Executor 运行 39135969013](https://github.com/nebulaedata/dr-octopus/actions/runs/39135969013) 和 [Docker 运行 39135968982](https://github.com/nebulaedata/dr-octopus/actions/runs/39135968982)，两者最终均为 success。Executor 实际为扩展 22 项、源码含原生回归 255 项、ZIP 有限验收 6 项全部通过，零失败和跳过；验收后独立发布任务上传五项资产，无需人工搬运旧包。Docker 等待公开 npm 版本后完成镜像构建、冒烟、推送、拉取验证和安装包上传。

[Release v0.0.13](https://github.com/nebulaedata/dr-octopus/releases/tag/v0.0.13) 的 ID 为 416495453，含 Docker ZIP、Executor 0.0.1 unsigned EXE/ZIP 及版本化 BUILD-INFO、acceptance-artifacts 和 SHA256SUMS，共六个上传资产，网页另列两个源码归档。Executor productBuildId 为 2175ec0aab16a6cbbf41062b8261b62ff521a50bd192472a5002aaff3773c85c；公开 BUILD-INFO 的 sourceCommit、sourceRef=refs/tags/v0.0.13 与 event=release 均准确对应本次自动构建。EXE 为 216,039,571 字节，SHA-256 为 2dd6f9df9725e26d09afd74816b0c3bb75eb236853e5bda3671516c2d98cd69f；ZIP 为 270,025,738 字节，SHA-256 为 aa265cfe9b369af7f613aadc7bb2409fbbc31c8db0cdcee4968b45271d7c70a0。

生产 Web 构建实际包含两个 /releases/download/v0.0.13/ 地址，不再包含旧站点版本路径。通过独立 Server/Agent 数据目录运行生产页面，在真实 Chrome 中关闭下载弹窗，再从 Executor 卡片重新打开：Windows 安装程序与 ZIP 链接、独立 v0.0.1 展示及验收说明正确，页面非空、无框架错误覆盖、无相关控制台错误。两个公开 URL 的匿名 HEAD 均为 200，Content-Disposition 文件名与 Content-Length 精确匹配 Release 资产。

通过页面 ZIP 链接实际点击下载后，浏览器工具的 download 事件等待超时；未重复点击或绕过浏览器保护。随后确认 Chrome 已完成下载，Downloads 中本次新文件的大小和 SHA-256 均与上述 ZIP 及 GitHub 摘要一致。原事件超时及独立文件复核结果一起记录，未把工具事件超时解释为下载失败或忽略原始现象。截图、完整发布日志、公开构建元数据、下载响应与文件校验 JSON 按同一验证批次保存；私有测试服务已停止。

本次完成公开 Release Assets 自动交付及网站下载路径/实际 ZIP 下载复验，仍为 unsigned 验收包；未执行产品安装、升级、卸载、正式 Host 注册、独立硬件或代码签名，不提升对应 G4/G5/G6 状态。

## 2026-10-19：安装版/免安装版命名与精简 Release 附件

新分发名称按 setup-unsigned.exe 与 unpacked-unsigned.zip 区分安装版和解压版，产品版本仍为 0.0.1；打包、发布校验、Web 默认 URL、双语按钮和安装说明同步更新。当前流水线将 Executor 的 Release Assets 精简为这两个二进制文件；两份 JSON、SHA256SUMS、验收工具与报告仍留在完整 Actions 附件，发布前继续逐项核对摘要、验收结论及 Tag 源码身份。

本地 Browser/Executor/Web 构建通过；Web 284 项测试、Executor 112 项根级测试、发布聚焦 16 项及 lint/typecheck/i18n 检查通过。首次本地打包尝试顶层 zip 配置被锁定的 electron-builder 26.15.3 Schema 拒绝；改为归档使用全局 artifactName、NSIS 使用专用 artifactName 后，新 EXE/ZIP 的真实文件名均符合约定，离线预检、产品目录与实际 ZIP 清单及六项包级验收全部通过。原失败日志与修复后日志分开保留。

本地新包目录标识 0.0.1-unsigned-8d7bba0c-e04e-46c2-9368-be538146190e，productBuildId 为 a59fa5c5983b23eea422a4fa536c7a8f330009ab56cd2a24b71d850a000e48dd；该记录只对应本地产物，远端新版本尚待构建。

按用户对截图红框附件的清理要求，已先备份并核对 v0.0.13 的 acceptance-artifacts.json、BUILD-INFO.json 和 SHA256SUMS.txt 三个 Release 资产，再按精确资产 ID 删除。删除后重新查询，Docker ZIP 和 Executor EXE/ZIP 的 ID、大小、摘要均保持不变；旧版本程序下载路径继续存在。备份与删除回执按本批验证材料保存，未删除 CI 内的原始校验材料。

发布前确认 0.0.14 的 npm、GitHub Release/Tag、Docker Hub 和 Harbor 标签均未占用。Harbor latest 可通过现有 Docker/Buildx 凭据读取；docker login 预检因本机 Docker Desktop Linux Engine 管道未运行而失败，没有认证拒绝证据。该失败记录保留；新版本发布后的真实镜像复制和摘要核验尚待执行，不将只读检查提升为推送权限验证。

### v0.0.14 实际发布与浏览器复验

实现提交 f87a8c3 随版本提交 118e29a3a4a29a4fba301957c1c1649def203d01 发布为 v0.0.14；Executor 产品版本保持 0.0.1。pnpm release:publish --resume --yes 完成 npm 上传与 GitHub Release 创建，npm 返回处理中后等待公开索引，最终精确版本查询与 tarball 均可用，bin[dr-octopus] 为 bin/dr-octopus.mjs。没有重复上传同版本或移动 Tag。

[Executor 运行 39185731953](https://github.com/nebulaedata/dr-octopus/actions/runs/39185731953) 与 [Docker 运行 39185732033](https://github.com/nebulaedata/dr-octopus/actions/runs/39185732033) 均成功。Executor 的扩展 22 项、源码含原生回归 255 项、实际 ZIP 验收 6 项全部通过，零失败和跳过；build/lint/typecheck、离线预检与实际 ZIP 清单核验均通过。完整交付附件 12158231699 与独立诊断附件 12158720341 继续保存 JSON、校验文件、验收工具和报告，Release 独立发布任务只上传两个程序文件。远端 productBuildId 为 12fcb9a24422c416eb3fe20524d0509730fbc2b89bdce93faeb4b2a93a4d8633，与本地产物分别记录。

[Release v0.0.14](https://github.com/nebulaedata/dr-octopus/releases/tag/v0.0.14) 的 ID 为 416821170，上传资产恰为 Docker ZIP、Dr.Octopus-Executor-0.0.1-win-x64-setup-unsigned.exe 和 Dr.Octopus-Executor-0.0.1-win-x64-unpacked-unsigned.zip，页面加上两个自动源码归档共五项，没有辅助 JSON/TXT。EXE 为 216,039,604 字节，SHA-256 为 7712aa5c990ca62fbc2a1b5239c66d202085f724861144a03ae2e75eaa657e37；ZIP 为 270,025,812 字节，SHA-256 为 2096786197980e215117c0fd9a10ac481225cd50efc27d3b22ef071cbce490ad。

使用生产 Web 构建与独立测试数据，在真实 Chrome 的 http://127.0.0.1:63071/?executorDownload=true 验证下载弹窗：Windows installer 与 Windows no-install (ZIP) 标签、v0.0.1 展示、v0.0.14 精确下载地址及安装或完整解压说明正确；关闭后从 Executor 卡片可重新打开，1920×911 页面无空白、框架错误覆盖或相关控制台警告/错误，截图确认布局及背景模糊。两个匿名下载 HEAD 均为 200，文件名、Content-Length 与上述资产一致。

通过页面实际点击 ZIP 时，Chrome 导航至 release-assets.githubusercontent.com 后显示 ERR_BLOCKED_BY_CLIENT，Downloads 中未发现本次新文件；保留拦截截图和结果，没有重复点击、绕过保护或将 HEAD 成功算作浏览器完整下载成功。本轮浏览器下载到盘仍未通过，移动视口及产品安装/升级/卸载未执行。测试页面已关闭，独立服务正常退出；公开 Release 页面保留。独立电脑、硬件、Host 注册和正式代码签名仍待验，不提升 G4/G5/G6。

### Harbor 实际同步与标签摘要核验

Docker 流水线完成精确 npm 版本构建、镜像启动/Web/三个持久卷冒烟、Docker Hub 发布及匿名拉取验证。现有 deploy/docker/sync-harbor.mjs 的 syncHarbor 将 Docker Hub 0.0.14 按固定摘要复制到 harbor.n.nebulaedata.com/nebulae/dr-octopus:0.0.14，复制后独立读取摘要匹配；该路径无需运行本机 Docker Engine，原 login 管道预检失败不影响使用现有凭据完成本次 registry 复制。

首次批次在同步 latest 前发现 Docker Hub latest 摘要 4c10763b1bf81664bf35d54f60a2e363024cf2becb22540710401f5dbda06e61 与版本标签不同，保护检查明确拒绝推送，原日志保留。原始 manifest 复核确认版本为 OCI、latest 为 Docker schema 2，首层压缩字节亦不同，其余七层摘要相同；两者配置字节摘要均为 5c687aa1477d89034ed386d29b385b28203c9155cc2f4daf5b91bfca473ceb23，且配置记录同一有序解压层摘要。没有将 manifest 摘要不同忽略为相同字节，也没有修改 Docker Hub 标签。

随后用 docker buildx imagetools create --prefer-index=false，将 Harbor 已校验的固定版本摘要提升到同仓库 latest，避免再次复制 Docker Hub latest 的另一种表示。最终独立核对 Docker Hub 0.0.14、Harbor 0.0.14 与 Harbor latest，三者均为 sha256:9d2bed6485fdce9365ecc11e9c4039a585d6fef6cd33bd0451d6f07cb31c7353。本次同步与标签更新通过，没有重新构建镜像、创建项目或部署运行环境；原始复制、保护拒绝、配置复核、提升及最终摘要报告分别保留。

## 2026-10-19：统一升版入口与 CI 非交互参数

根 pnpm release:publish 新发版入口明确选择仓库与 Executor 各自的 patch/minor/major，在写入文件、提交与推送前显示并确认两个版本；通过 release-it 标准插件在同一个提交和 Tag 中更新 release.config.json 与 apps/executor/package.json。默认的底层仅升版入口为 Executor 递增 patch。Executor package.json 为唯一产品版本来源，product.ts 静态引用并在 Node/Renderer 构建中内联；普通构建、打包及发布恢复不递增版本，扩展独立版本不改。

非交互新版本必须同时提供 --increment 与 --executor-increment，并明确使用 --yes 或 --ci；--ci 隐含 --yes。无 TTY、CI 环境及显式非交互模式均不等待菜单；缺少参数或恢复/升版冲突在认证、构建和 Git 写入之前失败。可选 .env.publish 不再阻止直接使用 CI 环境凭据，npm 认证仍由 npm 配置管理。Actions Token 与下游 release:published 事件的要求统一记录在 CLI 联合发布指南，未新增或触发真实工作流。

首次聚焦复验暴露锁定的 release-it 21.0.2 拒绝自定义 CLI 参数 --executorIncrement；保留原失败输出。改用程序化 API 传递标准插件配置，根 release-it 配置没有引入 Schema 外的自定义字段。复验 22 项通过；真实 Git 演练只使用临时仓库和本地 bare remote，覆盖版本提交/注解 Tag、独立幅度、dry run、取消、非法输入、脏工作区与不变版本拒绝。额外隔离用例确认缺少 .env.publish 时可读取 CI 环境，并仅访问本地 npm 认证替身，没有接触发布服务或写入真实版本。

CLI 全量 84 项及额外 CI 环境用例 1 项通过，Executor 含原生回归 256 项全部通过，Web 下载配置 6 项通过；CLI/Executor 构建、lint/typecheck，七个根发布模块的显式 lint、格式与换行检查通过。单一产品来源用例在独立目录将版本改为 0.9.7，确认 Node 和浏览器 bundle 均内联新值且不保留 package.json 运行时读取；发布计划到 Web 下载地址的用例确认独立仓库/产品版本准确组合。原 lint 路径/扫描范围问题与实际零警告复验分别记录，没有将被忽略文件当作已检查。

本批原始材料按 version-release/20261019-ci 保存。测试期间工作区存在其他并行改动，记录只对应各次检查读取的源码与本轮生成产物；没有覆盖或提交其他改动。仓库版本仍为 0.0.14、Executor 为 0.0.1，未执行真实升版、Tag 推送、npm/GitHub/Harbor 发布或日常产品安装；独立电脑、硬件及签名门禁不提升。

### 同批新包与冻结源码对照复验

从本轮已完成的 Executor 构建执行工作流原始 package、verify、六项有限验收步骤，生成新目录 0.0.1-unsigned-63a4e0d6-9a2e-47f2-bc51-c5251d5916c6，productBuildId 为 08dda1583c2402a824ae3b91e6480937f4feab834aee57c4cede105e4ffd5edd。EXE/ZIP 文件名及产品版本符合单一来源；离线预检、产品树与实际 ZIP 清单均通过，ZIP 共核验 8,265 个清单文件、672,404,256 字节。

首次包级验收为 5/6：并行构建改写共享 dist/renderer 后，原 Renderer 对照文件已不存在。没有恢复覆盖共享 dist，也没有删除字节比较断言；从冻结的原始 HEAD 源码加本次产品版本契约，在独立目录重新构建 Renderer。其字节对照通过后，安装指南又因并行编辑与原包不同而失败；进一步使用同一原始源码归档按仓库 CRLF 约定恢复指南对照，未从产品包提取期望值。最终对同一 EXE/ZIP 运行原六项验收，6/6 全部通过、零跳过；两次失败与最终完整 TAP 分别保留。验收脚本中元数据、窗口标题、Electron 版本和 MCP 服务版本四处固定 0.0.1 断言同步改为读取唯一产品版本，避免下一次合法升版被旧断言阻断；GUI/安装用例本轮未执行。

本地 ZIP SHA-256 为 4515c327097e0465306edf21d58715616d9b59d099264074a01546d9f3c8398d，EXE 为 db759e760d2efe06c8285648a2cbef3ac42d23882d88ffa6e7ec9a5f7670bc3e。这是本地未签名验证产物，不替换 v0.0.14 的已发布文件或对应摘要；真实后续版本与远端 CI 仍需由维护者显式发起。
