# Browser Extension 项目规范

根 AGENTS.md 和代码开发规范适用。[Browser](../../docs/architecture/executor-browser.md) 维护当前协议与恢复契约，[验证矩阵](../../docs/poc/executor-validation.md) 维护覆盖与待办，本地启动、热更新和断点调试见[开发指南](README.dev.zh-CN.md)，用户操作见 [INSTALLATION.md](INSTALLATION.md)，商店账号、ZIP、实际 ID 适配、审核与更新见[发布 SOP](RELEASE.md)。本文件只维护规则，不追加阶段进度。

## 职责与不变量

- 独立 WXT/MV3 扩展支持 Chrome/Edge。Native Bridge 使用固定 PageController 做有限页面控制，不在桥接请求中引入 Agent Loop。新增 Skill 整理/重放遵循[统一 ToolLoopAgent 方案](../../docs/architecture/browser-skill-unified-agent.md)：两个工具配置共用会话机制，重放复用现有 Controller/路由，不引入 Page Agent Core，不开放任意脚本或外部网页控制入口。
- Worker 连接固定 Native Host，跨 Host 协议进入 packages/shared；扩展私有录制/工作流协议留在本应用，不导入 Executor 实现。Host 持有桥接凭据，扩展/页面/popup 不持有 Runtime Bearer。
- 保留 nativeMessaging、storage、alarms、scripting 和截图 API 必需的 <all_urls> 权限；录制按需增加 webNavigation，不照搬独立插件权限示例，不无依据增加 tabs/activeTab；内容脚本、路由和操作仍只接受授权的 HTTP/HTTPS 页面，不预先申请 debugger/cookies/externally_connectable。
- 只顶层 ISOLATED world 静态注入，Controller 懒初始化；静态/补注入共用一个接收器。无副作用探测明确缺少接收器且再次确认权限后才补注入一次固定脚本，动作失败不补注入/重放。
- 协议版本 4，单 JSON 不超过 256 KiB。源端分页绑定连接、tab、documentId、controllerId、snapshotId 和页号，旧引用不重建，旧 tab ID 不映射替换目标。
- 同源 frame/open shadow roots 有界准入与文档身份检查（最多128个根、100,000个元素）；跨域或不可读取的frame保持不透明，不因其存在拒绝整页DOM观察，也不读取或操作其内容。无法脱敏的frame存在时拒绝截图。嵌套同源文档也绑定根身份，导航/替换后旧引用不能继续使用。同文档DOM变化使用上游已索引的真实元素引用；不把任意DOM变化作为整份快照失效条件。
- 页面提取、元素索引、遮罩彩屏、指针与高亮直接使用固定 PageController 公开 API 和默认行为，不为页面执行另建 DOM MutationObserver 或输入拦截。录制可在明确会话范围内监听 DOM 用户事件，源端脱敏，不阻断用户操作，也不初始化 Controller/执行遮罩。常规无选择约束时只显式启用 enableMask，页面提取范围和属性使用上游默认配置；本地 apply_choice 使用公开 interactiveBlacklist 在同一 Controller 内建立已解析目标的单元素索引，带选择要求的普通快照排除选择控件及其标签，不读取私有 selectorMap、不解析页面文本授予目标身份；第一次观察时 showMask，任务内复用 Controller，观察及思考间隙不 hideMask，单次动作不 dispose；任务结束、连接暂停/断开和内容脚本失效时按所有者释放原生资源；Bridge 断开不得清理本地录制或其他所有者的运行状态。连接/任务/文档身份与 TTL、分页、限额、敏感字段投影仍由桥接层管理，不修改上游实现。
- 连接、监听、计时器归所属生命周期，旧回调不改新状态。重连只恢复连接、不重放；用户暂停持久后不能自动恢复。
- Popup 管理命令只接受本扩展 popup.html；智能体执行命令仅接受已注册的 window-panel.html 独立文档（runtime.getContexts 校验 SIDE_PANEL，绑定窗口、文档和执行世代），在线依据当前 Worker 握手而非旧 storage connected 标签；保留连接管理并可提供录制/工作流命令，不拥有后台连接、录制器或 Agent 实例，不直接执行页面操作。
- manifest.icons/action.default_icon 的 16/32/48/128 PNG 和许可随两产物交付，不自动固定工具栏。浅深色/reduced-motion 保留，不改共享 shadcn 源组件。
- public key 只稳定侧载 ID，不证明商店或密码学身份。
- 任意脚本执行明确关闭：当前 MV3 ISOLATED 内容脚本受浏览器 CSP 限制，不为此新增 debugger/userScripts 或切换执行环境。用户明确批准通过最小 pnpm patch 移除未使用的 executeJavascript 方法及其类型声明，使发布产物不再包含该方法或 eval；不通过隐藏告警代替移除代码。

- browser_snapshot 默认激活目标标签页并附带 JPEG 视口截图；screenshot=false 只观察 DOM。截图绑定同一 document/controller/snapshot，切页、文档变化或出现未遮蔽敏感元素时拒绝；敏感标记和密码控件临时遮蔽并在 finally/reset/dispose 恢复；不返回其他标签页图片。图像不超过 128 KiB，边长不超过 1280，Native 单帧仍不超过 256 KiB。

## 录制与本地技能边界


- 录制运行模块位于 src/lib/recording，录制 UI 位于 src/features/recording；recording-content.tsx 仍是持有 React root 的页面运行时，不为后缀或目录形式机械拆分。内部直接引用所属模块，不新增旧路径转导出。

- 在同一扩展新增录制、浮条、事件保存与查看，保留现有桥接。录制事件不经 Native Host，Executor 离线不阻止录制；暂停连接、暂停录制和停止重放是独立操作。
- 录制仅处理用户明确选择的 Tab/站点及按规则纳入的关联 Tab；安装网站权限不等于同意全浏览器采集。默认顶层文档，frame 扩展需独立身份/生命周期验证，不因现有工具支持同源 frame 就宣称能录制其中事件。
- SW 统一进行页面操作准入，Bridge 与本地 run 使用各自真实所有者身份，不能伪造 Native connectionId。录制与重放互斥，同目标及焦点/窗口冲突返回忙碌，不自动抢占或排队重试；旧释放不得清理新所有者资源。
- 停止不承诺撤回已派发动作。未知在途结果必须显式保留并阻止冲突接管，重新观察/人工确认后决定后续行为，不自动重放。不扩展为 Executor 通用强停、许可世代或调度系统。
- Content 沿用唯一接收器与固定注入路径，页面动作复用现有 Controller 公开能力；不复制官方扩展的第二套 Controller/接收器。官方跨 Tab 源码只按必要职责适配，具体版本兼容性须验证。
- 事件源端脱敏，事务提交后 ACK，批量传输、重试与存储有界。停止先固化录制结果和尾批次缺口，再独立编译；不得承诺异常退出不丢事件。浏览器重启后标记中断，不自动采集或重放。
- 整理和重放使用窗口级侧边栏内的 Agent Host；纯录制不创建 Host。模型配置属于扩展，不使用 Runtime Bearer/Host 桥接凭据。用户显式保存配置可将接口密钥持久保存到本机受信扩展存储，按规范化 endpoint 绑定，不同步、不混入工作流/导出/日志、不宣称系统密钥库加密。Content 不接收或读取模型密钥；Popup 仅显示保存状态、更换和清除操作，不回填已存密钥明文。
- 模型目录拉取与连接测试使用设置页专用 Port，由后台解析当前输入或当前 endpoint 的已存密钥；关闭页面、离开设置或改变配置取消请求，不自动重试。连接测试独立于整理任务、原页显示顶部 Alert toast、不自动保存配置或创建 Host；编译仍使用注册的 Agent Host。候选只保留在设置页内存，不允许该短请求通道执行编译、重放或页面动作。
- 整理、重放业务留在本扩展，不修改 packages/agent。新增私有消息不自动扩展 Native v4 Browser 工具白名单。详细状态、预算、存储与恢复流程只维护在融合设计，不在本文件复制。
- 整理入口只做本地配置/授权检查，不预先调用模型连接测试。记住的发送授权绑定规范化 endpoint 和当前脱敏契约版本，首次确认或设置中明确勾选保存后生效，可撤销；后台每次开始前重新检查。已授权也只能由明确整理动作触发，不能自动采集/编译。配置错误修复保留录制上下文，临时失败与输出校验失败不强制进入设置，不自动重试。
- 校验失败诊断必须从 Host 传到 Worker 并随失败任务保存，只包含有限错误码、白名单字段路径/数组位置、类型与结束原因等信息，不保存原始模型正文、字段值、密钥或请求头；旧任务没有诊断时明确说明，不推断根因。
- 整理失败不提供通用旧录制修复入口；保留具体校验诊断与显式重试，不猜测补齐录制事实。未来迁移应基于明确数据版本和真实需求单独设计。

- Skill 整理与重放共享持久会话与有界工具调度：同轮有提问不执行动作，每轮最多一个外部操作；答案事务提交后才继续，重复答案不创建第二个 Host。关闭弹窗不删除待答；无自由聊天入口。
- 默认由浏览器事务保存技能快照/录制关联并完成整理，无需Executor；重新整理创建副本。用户显式保存到本地目录时先查询同一操作ID回执，再创建目录，不覆盖手改文件。磁盘失败不撤销浏览器副本，不重复请求模型。关联磁盘的技能优先读取当前文件，仅连接不可用时经绑定内容摘要的明确确认使用缓存，格式/权限/缺失错误不静默降级。未发布阶段不保留旧工作流兼容路径；经用户授权清理旧测试库、历史缓存及已导入摘要，保留当前录制、模型配置与新版 Skill 会话。
- 重放结果必须引用本次最新观察或明确关闭回执；程序未独立验证业务结果时保留 unverified。未知副作用阻止后续操作，人工核实结束需等待原文档空闲及持久化提交，不自动重试原动作。

## Popup 界面边界

- 控件优先使用现有 shadcn/ui 组件及其标准组合；日期字段采用 Button + Popover + Calendar 的 Date Picker 交互，字段值由 TanStack Form 持有。仅在没有合适组件时编写应用级定制，不直接修改共享源组件。


- 新增或重构的表单统一使用 TanStack Form（@tanstack/react-form），按 shadcn 的 Field/FieldLabel/FieldError 组合接入 form.Field、handleBlur/handleChange 与提交状态；不要用 useState 维护平行的表单字段状态。导航、筛选、展开与放弃确认等 UI 状态仍可局部管理。表单校验不替代 Worker 来源检查、领域约束及 Repository revision 校验。

- `ExtensionPopup` 拥有固定品牌栏与 Tab 容器，连接 Tab 第一且默认展示；业务 feature 不作为其他 feature 的外层容器。
- 业务页面通过应用级 `PopupPage` 组合固定 NavigationBar、必要工具区、正文和底部操作区；普通正文使用共享 ScrollArea；Skill 会话使用 ScrollArea 的主题滚动条，Viewport 通过 render 与 MessageScrollerViewport 合成为同一 DOM，MessageScroller 保留锚定/回到最新行为，会话外层禁止重复套滚动视口；用户明确要求的展开工具 JSON 卡片可使用有界内层 ScrollArea，具体高度与行为见 DESIGN.md。时间线节点间使用连续细连接线，图标顶部对齐，当前问题位于对应提问节点内。外层 body 不滚动，品牌/Tab/导航/footer 固定。Questionnaire 只呈现当前工具问题，字段归 TanStack Form，不开放自由聊天，不嵌套 form；具体视觉仍需批准后实施。
- Popup 外壳不设 padding；各区域统一由应用级 Box 提供内边距，正文 Box 必须位于满宽 ScrollArea 内，让滚动条位于最右侧且焦点外框留在视口内部。Box 不默认增加背景、边框或圆角，不对每个字段重复嵌套。整理与重放历史统一位于window-panel的会话列表，录制详情不再提供历史按钮，全局模型设置入口仅位于window-panel品牌标题右侧，Popup不再提供设置页，空历史也显示，不在正文独占一行；仅纳入带录制来源的整理任务，不纳入旧连接测试记录。详情绑定显式任务 ID，不以当前任务覆盖用户正在查看的历史；旧失败不自动跳设置。每次重试新增记录并关联上次尝试，不覆盖旧诊断。
- Popup 页面标题栏与导航栏的简短图标操作提示统一使用原生 `title`，并保留 `aria-label`；同一操作不再包裹 Tooltip。整理历史、模型设置和返回按钮遵循此规则。截断数据的完整值等信息展示不属于该动作提示规则。
- 列表容器保持gap-0，分隔线使用Separator my-2（用户2026-10-31修订）；列表必须有独立容器，不能将item/Separator的Fragment直接展开到PopupPage的区块gap中，避免与my-2叠加出多余空隙。item内部图标/文字间距和padding、日期分组标题及表单区块留白保留。
- 列表行、导航栏和页脚的分隔线统一使用独立Separator，不使用divide-*或行元素的border-t/bottom模拟分割，避免行圆角弯曲分隔线；卡片/输入框自身的完整外边框仍保留。
- 空数据统一使用 Empty；加载和失败分别显示 Skeleton 或错误/重试状态，不将失败伪装为空数据。可进入详情的记录行提供 hover、active、focus-visible、pointer 与箭头反馈；只读事件行不添加点击暗示。
- 删除确认操作行右对齐，取消在左、destructive 确认删除在右；不改变明确确认后才执行删除的边界。
- Popup 内导航、搜索和滚动位置由所属组件管理，不为布局问题引入全局状态库；Worker/IndexedDB 继续拥有录制权威状态。重大视觉调整先更新视觉稿与审阅登记（DESIGN.md 附录 A），再实施。

## Browser Use 上游优先原则

- Browser Use 尽量全部使用上游 PageController 提供的公开功能与合理默认行为，包括页面快照、DOM 提取、元素索引、点击/输入/选择/滚动、遮罩彩屏、鼠标指针和高亮；上游已提供的能力不自行重复开发，不为统一接口另建一套页面控制实现。
- 新增逻辑前先核对固定版本的上游 API 和默认配置。适配层仅承担上游未提供且产品确实需要的任务/连接/文档身份、执行来源准入、MCP/本地消息转换、分页限额和敏感内容投影；配置覆盖或额外封装必须有明确需求，不能以预防性设计代替依据。
- 代码以精简、清晰、优雅为目标：减少重复配置、重复校验、额外状态、定时器和无职责转发，保持流程直观、职责内聚。不通过机械拆文件或把复杂度转移到工具层制造精简；删除代码也必须保留必要的协议、安全边界和生命周期契约，并用相关回归验证行为。

## 第三方依赖修改原则

- 默认使用未经修改的上游依赖，优先公开 API、配置与合理默认行为；需求不匹配时先调整或简化自身适配层，不为视觉偏好、预防性修复或未使用的能力修改依赖。
- 只有可复现、阻塞当前核心功能、且公开 API 与自身适配均无法解决的问题，才考虑补丁；必须记录复现证据、替代方案、最小修改范围、回归验证和移除条件。不能把推测风险当作已证实的阻塞。
- 确有必要的补丁只能使用 pnpm patch/patch-commit，并由 patchedDependencies 与锁文件绑定；禁止构建时字符串替换、自制补丁引擎、运行时修改第三方实现或直接修改 node_modules。升级时重新评估，不自动沿用。

- 当前明确批准的例外仅为移除 PageController.executeJavascript：补丁不修改遮罩、高亮或其他行为。上游提供不含该实现的可用入口/版本后重新评估并移除补丁，不扩展为其他定制。

## 构建与交付规则

- scripts 根目录放 package.json 可调用的 .mjs 工程入口；单个入口不另建分类目录，多个相关文件才按职责分目录，lib 放辅助模块，使用 node 直接执行；纯 JavaScript 辅助模块归 scripts/lib，不作为独立命令入口。依赖补丁由 pnpm 安装阶段应用；scripts 不包含运行时行为补丁或自制补丁引擎。

- 从仓库根目录执行包命令，先成功构建 shared，再执行插件 build；构建步骤见[开发指南](../../README.dev.zh-CN.md#浏览器插件构建)，ZIP、商店身份与提交流程见[发布 SOP](RELEASE.md)。本文件保留约束，不复制操作教程。
- build 必须完成 Chrome/Edge 两个 WXT 目标及依赖许可证，输出为 .output/chrome-mv3 与 .output/edge-mv3。只压缩完整成功产物，不绕过许可证步骤或混入旧文件。
- 商店上传 ZIP 的 manifest 禁止包含 key，包括首次创建条目的草稿。从侧载构建制作草稿时，仅在独立归档副本去掉 manifest.key 和构建专用 browser-identity.json，其余运行资源与许可保持一致；不修改 .output 的侧载身份，不用草稿证明正式 Host 就绪。压缩后检查 ZIP 内实际 manifest。
- 独立 ZIP 默认留存在本项目 release/<version>-<UUID>/，草稿目录可标记 draft；避开 .output，避免构建清理已提交产物，不覆盖既有归档。.output/.wxt/release 及临时发布材料不提交。
- 插件兼容更新可独立构建、发布和安装，无需重建 Executor。仅在分发新的客户端内置插件副本时重新打包 Executor；不把源码或独立商店更新当作既有包内副本已更新。
- browser-identity.json 是侧载公钥/ID 与两个商店 ID 的唯一来源，所有模式均要求完整有效的官方身份。scripts/lib/browser-identity.mjs 由普通 Node 解析，不支持身份环境覆盖或缺失身份回退。只有插件 profile 按进程变量 → 根 .env → sideload 解析，并在 .env.example 说明；客户端不读取 .env。store manifest 不携带侧载 key，不向 Worker/PageController 注入运行时身份开关。
- 两个 WXT 目标输出独立的 browser-identity.json 产物记录，包含 identity、profile、protocolVersion、extensionVersion。identity 指纹只绑定稳定策略；客户端按各目标实际渠道身份和协议判断兼容，不要求插件记录与客户端完整指纹相同。变更客户端允许的身份时重建客户端；改变插件模式或兼容版本时只重建插件。配置与迁移步骤由[发布 SOP](RELEASE.md#33-配置身份并重新构建)维护。
- public key 不代替商店实际 ID；正式发行需核对 Chrome/Edge 实际安装身份、配套 Host 全部来源校验及注册迁移，不放宽到任意来源。审核与商店安装验收按实际结果记录，侧载不能冒充商店发布。

## 验证规则

- 按范围先 build，再 lint/typecheck/test；popup 集成验证使用专属环境，和真实商店安装分别报告。
- 真实往返使用隔离 Profile、唯一测试 Host 和扩展副本，不操作日常 Profile、正式注册或产品故障接口。
- 正式 Chrome/Edge 用 EXECUTOR_BROWSER_FLAVOR=installed；action/CDP、API 激活、人工工具栏点击、商店/企业策略分别报告。
- 冻结/丢弃改变和拒绝时不附着网页调试器，恢复用新观察；显式解冻/刷新不代替普通激活，不以默认回归替代在途/复杂页面专项。
- 受控模型、协议 peer 与用户真实模型分开；原失败保留，有限通过不提升 Computer/发行门禁。
- 文档更新长期职责文件和验证矩阵，原日志/JSON/图片保留身份与结果，不再新增日期阶段报告。
- 仅文档变更检查格式、索引、链接与决定一致性，无需运行无关的业务或硬件测试。

- 本地Skill重放观察真实页面时，即使screenshot=false也激活目标Tab并聚焦所属窗口；截图选择仅决定是否附图。Native调用的DOM-only观察保持既有被动行为。不存在合适页面时由重放工具打开允许站点，不能以新建Tab作为已执行的唯一依据。

- Popup保留连接、录制和文件管理；整理/重放会话列表、详情及模型宿主在全局sidePanel内复用原UI。关闭Popup不取消任务；关闭面板中断模型请求并保留会话/待答/未知副作用，重新打开不自动继续。Worker拥有会话及执行权，跨窗口不能接管仍有面板所有者的运行/待答会话，重放限定所属窗口。正常Tab加载面板URL不获得执行权限。

- Agent提问的每个字段支持系统提供的自行说明答案；单选/多选提供“其他，自行说明”，其他字段提供“不适用／自行说明”。使用QuestionnaireInput显示说明输入，由Worker验证字段归属、非空及长度限制，以结构化explanation工具结果提交，不能伪造日期/数字或等同暂缓回答。
- 设置只在window-panel编辑；监听已保存配置变化，未编辑表单自动同步，有草稿时提示并保留输入。模型/密钥/授权与执行限制使用同一表单、同一保存请求和统一版本校验，过期保存拒绝；不得回填已保存密钥。设置变更不重写现有任务快照。

- 模型轮次先持久化assistant回复和标准化finishReason/响应摘要，再作工具准入；纯文本不等于完成。纯文本由SDK自然停止，不由Worker自动重启；用户明确继续后的协议纠正每会话累计最多2次模型请求，计入原预算，计数跨Host/重启保留；网络重试仍为0。重放纠正仅准入读取/观察/提问/finish_run，不允许页面副作用，真实用户回答后才恢复常规观察-操作流程。空输出、截断、过滤和未知结束原因分别失败留证，不自动重发。

- 内置整理/重放通用运行模块为src/lib/builtin-agent。使用ToolLoopAgent原生多步执行、execute与停止条件；Worker只持久化预算/整轮准入/工具账本并执行有限操作，不在工具返回后自行启动下一模型轮。ask_user_question保留为外部工具，SDK规范步骤消息用于续接；完成回执而非工具名称决定完成。详细契约见ADR-0091与统一方案。
