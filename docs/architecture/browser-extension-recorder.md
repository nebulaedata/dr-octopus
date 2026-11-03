# 浏览器扩展录制：范围、事实与生命周期

2026-11-03 文档收敛：本页只维护仍有效的录制及共享准入契约。旧工作流编译/编辑/发布、固定引导问卷、Page Agent Core 双引擎与非活动 Host 标签页不再作为当前方案。清理前完整正文见[历史原件](../design/browser-extension-recorder/history-manifest.md#docs-architecture-browser-extension-recorder-md)，原日期、失败记录与来源不覆盖。

| 责任                           | 当前权威文档                                                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 产品与界面                     | [PRODUCT.md](../../apps/browser-extension/PRODUCT.md)、[DESIGN.md](../../apps/browser-extension/DESIGN.md)                                |
| Bridge 协议、Controller 与恢复 | [Executor Browser](executor-browser.md)                                                                                                   |
| Skill 整理/重放与会话          | [统一 ToolLoopAgent](browser-skill-unified-agent.md)                                                                                      |
| 浏览器副本、磁盘关联与离线重放 | [浏览器优先保存](browser-skill-offline.md)                                                                                                |
| 开发与交付规则                 | [扩展 AGENTS.md](../../apps/browser-extension/AGENTS.md)                                                                                  |
| 已执行与待验收                 | [验证矩阵](../poc/executor-validation.md)、[Host 生命周期验证](../poc/browser-host-lifecycle-validation.md)                               |
| 后续录制能力提案               | [单层同源 iframe](browser-recorder-reliability.md)、[专项验收计划](../poc/browser-recorder-reliability-validation.md)（Proposed、未实施） |

## 范围与非目标

录制与 Native Bridge 同属一个 WXT/MV3 扩展，但录制事件不经过 Native Host；Executor 离线或连接暂停不阻止录制。用户明确开始后采集网页操作及可访问的浏览器事件，先保存脱敏事实，再由显式整理操作消费。Popup 管连接/录制，window-panel 承载 Agent 会话、历史与设置，Content 显示录制浮条。

不录制屏幕视频，不捕获地址栏逐键输入、浏览器原生菜单、系统文件框或 Windows 桌面，不开放任意 JavaScript、网页命令入口或录制/重放 MCP 接口。能观察到导航/Tab 变化不等于确定用户点击了哪个原生控件；无法归因保留 unknown。

## Tab、站点与文档边界

- 这里的录制是操作事件录制，不是屏幕视频录制。开始时保存起始 `tabId/windowId`、逻辑 `tabRef`、允许站点和参与 Tab 集合。
- 默认只采集起始 Tab。开始时可明确启用“包含流程打开的新标签页”；仅在 `openerTabId` 属于参与集合、同一窗口且 URL 在允许站点内时纳入。缺少关联证据或站点不允许时，不自动采集；由用户在 Popup 明确纳入和授权后再监听。
- 切换到无关 Tab 只呈现录制范围外状态，不保存其 URL、标题和 DOM。所有事件先通过参与范围过滤，再脱敏和持久化。
- 起始 Tab 关闭时，有其他参与 Tab 则继续并显示起始页已关闭；全部参与 Tab 关闭则保存结果并结束。Tab 移出所属窗口或发生替换时停止该目标采集并标记缺口，不能把旧 tab ID 自动映射到替代页面；没有有效参与页则标为中断。
- 参与页跳转到未允许站点或受限页时，停止该页 DOM 采集，只保存脱敏的边界事件；继续前需明确纳入站点。窗口关闭、浏览器重启后保存中断记录，不自动恢复采集。
- 沿用顶层 ISOLATED 静态入口。顶层监听不会自动覆盖 iframe：一期遇到 frame 内流程标记不支持并提示人工补充，不声称完整捕获。同源 frame 的独立监听、身份及卸载另行验证后扩展；跨域/嵌套 frame 不在一期范围。现有 Browser 工具的单层同源 frame 能力不因此回退。

单层同源 iframe 后续提案尚未实施，不因文档已经存在而改变以上采集边界；执行层 PageController 的 frame 能力与录制器覆盖分别验收。

## 录制、Bridge 与本地重放的协调

Background 是页面操作准入的唯一协调者。录制会话、Native 连接和本地 run 分别拥有自己的状态，不能通过一个通用 reset 互相清理。执行来源使用判别身份：Bridge 为 `connectionId + taskId`，本地重放为 `runId + hostInstanceId`；页面引用还绑定 tab、document、controller 和 snapshot。不得伪造 Native connectionId 承载本地任务。

- 全扩展最多一个录制会话、一个本地重放，二者互斥。录制暂停仍保留参与范围，避免自动化改写待继续录制的页面。
- 同一 Tab 的 Controller 同时只归一个执行所有者。录制开始前检查参与页在途操作和 Controller 所有权；有冲突则拒绝开始，不抢占既有任务。新纳入 Tab 也必须经过同一检查。
- 录制期间拒绝参与页上的 Browser 操作，包括会改变遮罩的观察；不影响参与页的列表读取等操作可继续。截图默认会激活 Tab，因此不能简单归类为无副作用读取。
- 本地重放期间拒绝其他来源对其目标页的观察和操作。会切换焦点的截图、Tab 激活以及影响受保护窗口的操作也必须检查，不因目标 Tab 不同而绕过。无法证明不会影响活动流程时返回忙碌。
- Bridge 冲突沿用协议中已有的 `BROWSER_BUSY`；内部录制/重放返回带冲突来源的本地状态。拒绝不自动排队、重试或接管。此处只做扩展侧有限准入，不增加 Executor 任务许可世代、强停确认或通用调度系统。
- 停止立即关闭新派发，允许已发动作回包收尾。取消或超时不等于撤回，结果不明记录 `outcome_unknown` 并阻止该目标被新所有者抢占，直至在途结束或文档已明确失效；由用户确认和重新观察决定后续动作，不自动重放。
- Bridge 暂停/断线仅释放 Bridge 自己的资源；本地 run 取消仅释放匹配 run/host 的资源。旧释放回调不能删除新所有者状态。SW 恢复期间先暂停新动作准入，核对 Host、页面身份和未完成操作；不能仅凭 storage 中的锁认定可继续执行。无法确认时中断并要求重新观察，不重发未知动作。

三个 UI 操作分别命名为“暂停连接”“暂停录制”“停止重放”。Popup 不持有后台连接、录制器或 Agent 实例；任何控制都通过经身份验证的消息交由所属运行时执行。

## 模块与事实所有权

| 模块                     | 责任                                                       |
| ------------------------ | ---------------------------------------------------------- |
| `src/lib/recording`      | 会话、浏览器事件、DOM 采集、归一化、脱敏、存储与消息客户端 |
| `recording-content.tsx`  | 录制页面运行时与 React root 生命周期                       |
| `src/features/recording` | 录制列表、详情、控制与状态投影                             |
| Worker / 页面准入层      | 来源/身份校验、参与范围、写事务与页面操作所有权            |
| `src/lib/builtin-agent`  | 读取已选录制，管理整理/重放会话；不反向控制采集事实        |

DOM 监听只在授权会话内进行；click、input/change、语义按键及 scroll 记录有限控件上下文。isTrusted 是辅助证据而非唯一凭据，中文输入处理 composition；敏感字段不记录原值，不捕获自己的浮条事件，也不为录制初始化 Controller 或执行遮罩。

浏览器事件监听在 SW 顶层同步注册，仅处理活动录制窗口与参与 Tab；排除扩展内部页面。DOM、Tab 创建、导航通过明确来源与因果证据归并，LLM 不负责去重或事实排序。

事件携带 eventId、sessionId、producer/document 身份、本地序号、接收序号、时间、逻辑 Tab 引用、来源与可选 causationId；短暂浏览器 ID 不是可跨文档重用的执行引用。RecordedAction 保留 sourceEventIds，原事件不因归一化丢失。

连续同文档/控件/编辑会话的 input/select 可以合并，350ms 只作为传输边界；blur、独立动作、暂停与导航结束合并范围。缺少 targetRef/editRef 的旧录制逐条保留，不猜测合并。排序使用 DOM 子序列、明确因果和 tab_open 前置约束；本地时间仅作为无约束节点排名，循环/不完整证据拒绝。submit 是提交观察，不能映射成第二次点击。

整理读取短 ID 的脱敏动作摘要，不获得任意网页采集权；旧编译协议、逐条审批和发布门禁不再扩展。Skill 校验与工具契约归统一 Agent 文档。

## 批次、身份与停止收尾

控制回包和缺口报告失败按 sessionId 与页面 generation 校验，旧成功、旧失败均不能修改新录制。hello 请求还使用递增修订号保证只应用最新回复；无会话身份的终态通知先重新握手再决定清理。

`recorder.hello` 返回 `{ session, lastBatch }`：lastBatch 只来自接收侧已绑定文档的提交进度。全量导航和 BFCache 恢复后都先握手同步，不能将页面缓存中的旧批次号直接用于当前路由。Content 的本地 generation 隔离恢复前的迟到回包、重试和 pagehide 收尾；不能仅以浮条可见认定恢复成功，必须验证新输入可继续提交。

- Popup 录制命令只接受本扩展 popup.html；Content 事件绑定参与会话与实际文档。Agent 命令只接受已注册 window-panel 文档，运行宿主身份契约归统一 Agent 架构。网页 DOM 和 postMessage 不能作为授权依据。
- SW 持有录制写入与全局 seq 分配责任；Content 批次携带 sessionId、producer/document 身份、本地序号和 eventId。以 `(sessionId, eventId)` 幂等写入；事件与提交进度在同一 IndexedDB 事务完成后才 ACK。全局 seq 表示接收顺序，因果关系仍由来源序号、导航及 causationId 表达。
- 初始预算：单批序列化不超过 64 KiB、最多 100 个事件，单生产者最多 4 个未确认批次，最多重投 3 次。实施通过集中常量与边界测试落实；输入/滚动先合并，超大事件裁剪非必要上下文并标记，不能截断 JSON。预算耗尽暂停该页采集并显示缺口，不静默丢弃也不无限积压。
- `recording.stop` 返回录制结果 ID，不等待模型编译。会话进入 `stopping`，禁止新参与页和新交互，要求各生产者 flush；最多等待 3 秒后固化已提交数据与每页截止序号。未响应页面标记缺口；停止固化后的迟到事件拒绝，不写入下一会话。
- DOM 的 pagehide 发送仅为尽力提交，不承诺可靠送达。浏览器异常退出、源页面销毁或存储失败均需呈现 `partial`；录制状态为 `recording / paused / stopping / stopped / interrupted`，编译状态独立为 `not_requested / pending / running / failed / ready`，停止成功不等于编译成功。
  Agent 问答使用当前会话工具与事务契约，不恢复旧 input.submit/cancel 阶段协议。

## 存储与隐私

录制结果由 IndexedDB 持久化，Worker 独占写入；storage.session 仅保存活动索引，不是唯一事实来源。现有 Bridge 的 paused、installationId 和 bridgeStatus 键语义保持独立。

录制预算为每会话 20,000 个事件或 20 MiB，录制事件累计 100 MiB；达到上限停止采集并说明原因，不静默淘汰活跃数据。脱敏事件默认保留 30 天，在已有唤醒及任务开始/结束时清理，不依赖定时器精确触发。删除录制清理其事件；技能与会话删除范围由当前 Skill 契约明确管理，不沿用旧工作流级联删除语义。

源端先过滤字段值、URL、控件标签及上下文，再传输/存储；提供给模型前再次做有限投影，不无条件发送完整网页。密码、验证码、token、会话标识与 PII 不进入录制证据。无法脱敏的内容拒绝采集，缺口如实记录。

模型配置和凭据归扩展，不借用 Native Host 凭据或 Runtime Bearer；只在受信扩展存储按规范化 endpoint 保存，不进 Content、技能包、导出或日志。发送授权、模型发现、连接测试及错误分类由统一 Agent 契约和 DESIGN.md 维护，录制不隐式触发这些请求。

## 记录浏览与分页

- Popup 的连接 Tab 排第一并默认展示；录制首页仅显示最新 5 条已停止或已中断的记录，通过「查看全部」进入完整列表。
- `recorder.list` 使用独立的 `query + cursor` 请求；每批最多 20 条，只返回列表摘要，不传输事件正文或整份运行上下文。结果包含 `items` 与 `nextCursor`，没有下一批时游标为 null。
- 游标绑定规范化搜索词和最后一条记录的 `startedAt + id`，使用 IndexedDB 复合索引按倒序排他读取；相同时间戳由 ID 决定稳定顺序。新插入的更晚记录不插入已展开的旧游标链，删除游标所指记录也不使后续范围失效。
- 搜索覆盖完整存储范围，不仅过滤当前加载内容；变更搜索词重置游标。旧请求回包不得覆盖新搜索，失败保留已加载结果并可原位置重试。
- ExtensionPopup 固定品牌栏与 Tab；各业务页面使用应用级 PopupPage 组合固定 NavigationBar/工具区、正文 ScrollArea 与底部操作区。外层 body 不滚动，所有滚动恢复绑定实际 viewport；空数据用 Empty，加载/错误各有独立状态，可点击记录行具有鼠标与键盘反馈。
- 完整列表手动「加载更多」，不使用自动无限滚动或数字页码。进入详情后返回保留已加载列表、搜索词与滚动位置；同一 Popup 内重命名/删除同步投影到列表，不清空整个浏览上下文。
- `recorder.detail` 按已提交事件序号每批读取 50 条，继续使用稳定序号游标；业务步骤数与保留的原始事件数分别表达，不因关联事件折叠丢失证据。
- 当前存储使用 `octopus-recordings` 数据库的 `sessions` 与 `events` 表，版本 2 增加时间/ID 索引；升级保留已有会话与事件，不通过清空数据迁就新查询。

## 权限与验证边界

保留 nativeMessaging、storage、alarms、scripting、webNavigation、sidePanel 及截图所需 <all_urls>。安装权限不等于全浏览器采集同意；任务仍独立检查站点、窗口和参与页。禁止新增 debugger/cookies/externally_connectable/userScripts 或任意脚本入口。停止后解绑 DOM 监听，SW 顶层监听保留但无活动录制不采集。

本次仅整理文档，不新增能力或更改验收结论。原架构的阶段计划见[历史验收记录](../poc/browser-extension-recorder-validation.md)；当前覆盖以验证矩阵为准，受控测试、真实模型、人工体验与商店验收分别报告。后续 iframe 提案只有设计与未执行计划，不得宣称支持。
