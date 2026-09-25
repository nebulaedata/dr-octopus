# 前端设计规范

本文从当前 Dr.Octopus Web 的共享主题、页面容器、首页、会话及后台任务界面提炼，作为新增和修改 UI 的共同基线。规范描述后续实现应遵循的约定，不代表所有历史界面已经完成验收。工程分层与技术栈仍遵循 [AGENTS.md](./AGENTS.md)。

## 1. 产品视觉与信息层级

- 界面服务于工作区、会话和任务操作，优先保证内容可读、状态明确、操作易找。
- 保持紧凑的工具型界面：标题说明当前对象，正文呈现主要内容，弱化时间、计数和辅助说明。不要把每条信息都包装成独立卡片。
- 详细日志、低频操作和高级选项按需放入折叠区域、菜单或侧边面板。摘要保留名称、状态和进入详情的入口。
- 普通页面沿用共享 Hero 的轻量主题色装饰；首页允许品牌 Logo 和欢迎语。不要把首页渐变标题、装饰背景扩散到列表、表单和会话内容。
- 每个视图只设一个主操作，其余操作使用次级样式或收入菜单；一屏内不出现多个默认强调的 Button。
- **先参考，再开发。** 新增或修改 UI 前，先查看同类模块和现有组件，沿用字段、按钮、状态与布局规则，不为单个页面另创样式；局部需求通过 props、`className` 或 feature wrapper 实现。

## 2. 主题、颜色与表面

颜色和圆角的来源是 [共享主题](../../packages/ui/src/styles/globals.css)，应用通过 [index.css](./src/index.css) 引入。使用 Tailwind 语义 token，不在业务页面复制色值或建立平行主题。

| 用途               | 默认 token                                                 |
| ------------------ | ---------------------------------------------------------- |
| 页面与正文         | `bg-background`、`text-foreground`                         |
| 卡片、分组面板     | `bg-card`、`text-card-foreground`                          |
| 菜单和浮层         | `bg-popover`、`text-popover-foreground`                    |
| 次级表面和说明     | `bg-muted`、`text-muted-foreground`                        |
| 主操作、品牌强调   | `bg-primary`、`text-primary`、`text-primary-foreground`    |
| 交互强调           | `bg-accent`、`text-accent-foreground`                      |
| 分隔、输入框、焦点 | `border-border`、`border-input`、`ring-ring`               |
| 危险、警告、成功   | `destructive`、`warning` / `warning-foreground`、`success` |
| 数据可视化         | `chart-1` 至 `chart-5`                                     |
| 应用侧栏           | `sidebar` 系列 token                                       |

- 前景与背景配套使用，尤其是 primary、accent、popover 和 warning 表面。浅色透明背景可沿用 `bg-primary/10` 等写法，需检查明暗模式的可读性。
- `destructive` 和 `success` 没有配套 `-foreground`：使用低透明度表面加同色文字，如 `bg-destructive/10 text-destructive`、`bg-success/12 text-success`，可参考 Button 的 destructive variant 与 DocumentStatusBadge。`warning` 是仅有的成对状态色。
- 支持现有 `default`、`electric`、`shadcn` 配色及 light/dark 模式，不把橙色视为固定品牌常量。
- 以边框、留白和浅色表面建立分组；阴影沿用 primitive 默认值，不为每层容器增加阴影。
- 浮层层级沿用 primitive 的默认 z-index（popover、dialog、sheet、toast），业务代码不为浮层自定义 z-index。
- 圆角使用主题映射的 `rounded-*`。列表分组常用 `rounded-xl`，普通页面 Hero 使用 `rounded-2xl`；按钮和输入框沿用共享组件的默认圆角。
- 成功使用 `success`，失败使用 `destructive`，等待使用现有加载样式；状态颜色必须配合明确文字，不能仅靠颜色或图标区分。复用各领域的状态组件（如 DocumentStatusBadge、ScheduleTaskStatusBadge），不在各处散落颜色判断。

## 3. 字体、间距与图标

- 普通 UI 继承共享 `font-sans`。当前默认是系统无衬线字体栈；主题另外提供 `font-geist`，不要因为加载了 Geist 就假定全站都使用它。
- 普通页面标题交给 `PageHero`；正文和行标题通常用 `text-sm`，时间、计数、状态说明用 `text-xs text-muted-foreground`，行标题按需使用 `font-medium`。
- 代码、命令和日志使用等宽字体；需要对齐的计数使用 `tabular-nums`。首页欢迎语的 serif 字体是局部品牌表达。
- 优先复用 Tailwind 间距尺度：紧邻控件 `gap-1` / `gap-2`，行内容 `gap-3`，面板内容 `p-4` / `p-5`，页面区块沿用 `Page` 的 `gap-5`。具体密度先与相邻界面对齐。
- 图标使用 Lucide 的 `*Icon` 导出。常规控件图标通常 `size-4`，面板标题可使用 `size-5`；优先由 Button 等组件管理内嵌图标尺寸和间距。
- 图标尺寸与点击区域分开考虑。紧凑工具栏沿用现有 `size-8` 或组件 size variant，并检查内容实际居中，不能只给外层设置居中。可点击目标不小于 `size-8`（32px）；触屏上拥挤的控件通过增大间距解决，而不是继续缩小。
- 加载与进行中的文案以单个省略号结尾，如“验证中…”；使用 `…` 而不是三个句点。标题与 Hero 描述可用 `text-balance` 避免孤词；计数使用阿拉伯数字。
- 键盘快捷键提示使用 `Kbd` 组件展示，不用纯文本拼写组合键。

## 4. 页面与滚动布局

| 场景                         | 复用入口与约定                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 普通管理页，如技能、计划任务 | 使用 [Page](./src/components/Page.tsx) 包裹 [PageHero](./src/components/PageHero.tsx) 和正文                               |
| 应用框架与侧栏               | 在 `features/layout/` 内沿用现有框架，不为单个页面重建导航                                                                 |
| 首页                         | 沿用 [AgentHomePage](./src/features/home/AgentHomePage.tsx) 的居中 Logo、欢迎语和 Composer 结构                            |
| 会话                         | 沿用 `features/session/` 的专用消息与输入区布局，不强套普通 Hero                                                           |
| 设置                         | 沿用 `features/settings/layout/`；领域分栏和导航规则见 [Settings 布局设计](../../docs/architecture/settings-web-layout.md) |

- `Page` 提供全高滚动容器、居中 `max-w-5xl` 内容、水平留白 `px-4 sm:px-5`、`gap-5` 和 `py-5`。页面不再各自补水平 padding；需要差异时使用 `Page.classNames.container` / `content` 覆盖（如 KnowledgePage 的 `max-w-6xl`）。
- 普通页面标题、描述和操作分别传入 `PageHero` 的 `title`、`description`、`extra`，不复制其标题和背景实现。
- 为每个区域明确滚动归属。纵向 flex 子区使用 `min-h-0`，含长文本的横向子区使用 `min-w-0`，固定工具栏使用 `shrink-0`，避免整页与内部内容重复滚动。
- 配置按职责归属：通用连接配置管理模型和密钥；功能开关及策略归所属业务模块，页面与配置所有权保持一致。
- 长名称允许换行或截断，并提供查看完整内容的途径。代码和日志可在自身区域横向滚动，主要表单和操作不能依赖页面横向滚动。
- 超过约 50 项的长列表使用虚拟化（`@tanstack/react-virtual`，参考 ScheduleToolPicker）或 `ListPagination` 分页；会话消息流沿用 `features/session/` 的既有滚动模式，不为其引入通用分页。

## 5. 组件与交互

- 从 `@octopus/ui/components/*` 消费 shadcn primitives。禁止直接编辑 `packages/ui/src/components/`；缺失组件按 AGENTS.md 的 CLI 方式安装。
- 新界面先查下表与相邻页面的既有入口，再考虑新建组件；确需新增的 app 级复用组件放入 `src/components/`，遵守 AGENTS.md 的边界规则。

| 场景            | 复用入口                                                    |
| --------------- | ----------------------------------------------------------- |
| 页面容器与标题  | `Page`、`PageHero`                                          |
| 页内页签切换    | `PageTabList`                                               |
| 搜索输入        | `SearchInput`                                               |
| 列表分页        | `ListPagination`                                            |
| 右侧详情面板    | `SideRightPanel`                                            |
| 统计摘要        | `StatCard`                                                  |
| 分段切换        | `ToggleButtonGroup`                                         |
| 时间线          | `Timeline`                                                  |
| 文件上传        | `Upload`                                                    |
| 代码与 Markdown | `CodeEditor`、`MarkdownRenderer`、`Highlight`               |
| 空态            | `Empty`（@octopus/ui）                                      |
| 加载            | `Skeleton`、`MessageSkeleton`、`LoadingFallback`、`Spinner` |
| 快捷键提示      | `Kbd`（@octopus/ui）                                        |

- Button 沿用已有 variant 和 size：主操作用默认强调，次要操作用 `outline` / `secondary`，工具栏和低强调入口用 `ghost`。所有执行删除或打开删除确认框的按钮都必须使用 `destructive` variant，不能用 `outline` / `ghost`；确认框中的最终删除按钮同样使用 `destructive`。普通关闭或返回不应因邻近危险操作而使用危险样式。
- 菜单使用现有 DropdownMenu / Select 等组件；单选项展示当前值及选中状态。有官方选项列表时优先提供选择器，覆盖加载、失败重试和当前值保留。会话中的模型与思考等级继续复用合并选择器。
- 提交及辅助操作统一放在表单底部右侧；按钮顺序、尺寸和主次样式与同类表单一致，窄屏允许换行。
- 短表单使用 Dialog，附属管理详情可使用 Sheet。仓库尚未安装 AlertDialog：危险删除确认沿用 Dialog 加警示区的模式（`border-destructive/30 bg-destructive/5`、警示图标和明确的对象名称，参考 SkillDeleteDialog）；后续按 CLI 安装 AlertDialog 后统一替换。保留 primitive 的焦点管理、键盘和关闭行为。
- 表单字段提供可见标签、必要说明和就近错误；placeholder 不能代替标签。提交期间在相关按钮显示 pending 状态并阻止重复提交。
- 密钥使用密码输入框：未配置显示输入提示，已配置显示 `********（已配置）` 占位符；真实密钥不回填，掩码不作为输入值或提交值。
- 表单控件设置有意义的 `name`、`autocomplete` 和合适的 `type` / `inputmode`；不拦截粘贴；代码、命令和标识符输入使用 `spellCheck={false}`；提交失败时聚焦首个错误字段。
- 功能入口遵循实际能力与状态，不提供已知必然失败的操作；暂时禁用的重要操作应让用户能理解原因。
- 文案简短、面向操作：标题使用明确对象名称，如“API Key”；按钮使用“保存配置”“测试连接”“移除密钥”等具体动作。说明只保留必要用途、限制或生效条件，不重复标题，不解释内部实现。沿用业务术语，模型名、命令和代码标识保留原名，必要时使用 `translate="no"`。

## 6. 导航与 URL 状态

- 需要在刷新、分享或新标签后恢复的状态——页签、筛选、分页、选中项、面板开合——写入 URL search params，并经路由的 `validateSearch` / zod schema 校验；hover、输入中的草稿、滚动位置等瞬态不进 URL。
- 同一对象上的视图切换使用 replace navigation，进入新对象使用 push，避免浏览器历史堆积。
- 可导航目标使用 `Link` 渲染真实链接，支持新标签打开和 Cmd/Ctrl+点击；Button 只执行动作。
- 需要“模态覆盖 + canonical URL”的界面统一使用 TanStack Router route mask，不自建第二套路由：
  - 实际 location 保留当前 pathname，把经过校验的状态写入 Workbench search schema（如 `settings: { path, provider? }`）；
  - `mask` 把地址栏投影为 canonical URL，并设置 `unmaskOnReload: true`；
  - 打开使用一次 push；层内切换统一 replace，确保关闭只需一次 history back；Esc、遮罩点击和关闭按钮都走 history back；
  - canonical 路由保持可独立匹配和渲染，刷新、复制链接或新标签打开不依赖 masked location state。
- 当前唯一实例是 Settings Dialog（[SettingsDialogHost](./src/features/settings/layout/SettingsDialogHost.tsx)、[settings-modal.ts](./src/router/settings-modal.ts)，设计契约见 [Settings 布局设计](../../docs/architecture/settings-web-layout.md) §4.1.1）。Settings 页面内部的跨板块链接使用 `SettingsSectionLink`：Dialog 内走 masked 导航，canonical 页面渲染真实链接；不在 Settings 内容里直接写 `to="/settings/*"` 的裸 `Link`。

## 7. 状态与用户输入

- 设计时覆盖首次加载、空数据、成功、进行中、失败、禁用与状态未知；相关功能还需考虑重试、缓存过期和权限不足。
- 首次加载可用 Skeleton 或 Spinner；后台刷新保留已有内容，局部操作使用局部反馈，不用整页 loading 遮挡无关操作。
- 空态解释当前情况，并在有下一步时提供入口。失败使用 Alert 等现有反馈组件，说明可执行的恢复方式。
- 轻量结果反馈使用 Toast：操作成功、后台任务事件等不需要用户处理的结果。Toast 文案简短，可带“查看”“重试”等动作入口；同类事件去重，不连续堆叠。需要用户处理才能继续的错误使用 inline Alert 或表单就近错误，不用 Toast。参考 NotificationCenter 与 KnowledgeJobFeedback。
- 重新执行操作时清除旧结果，避免旧成功或失败提示冒充本次状态；未确认完成的动作继续展示进行中或待确认，不能提前呈现成功。参考 [后台任务面板](./src/features/session/background-tasks/BackgroundTasksView.tsx) 的摘要、状态分组和按需日志。
- 可逆操作可以乐观更新并在 Toast 提供撤销；不可逆操作必须先确认，两种模式不混用。
- 失败、响应式切换和准备过程不应无故清空用户输入。Composer 的可输入状态与可发送状态分别处理；表单失败保留已填写内容。
- 共享草稿或需要跨重挂载保留的状态按 AGENTS.md 放入 store；服务器状态仍由 Query 管理，不为视觉组件建立第二份业务状态。
- 路由加载失败与未匹配路径由 Router 错误边界和 notFound 组件兜底；新增顶层路由时一并配置。

## 8. 响应式与可访问性

- 从窄屏单列出发，按现有 Tailwind 断点逐步增强。项目 body 最小宽度为 320px；在 320px 与 390px 下主要内容和操作应可访问。
- 窄屏优先调整排列、换行、收起低频操作，而非等比例缩小桌面多栏。菜单、子菜单和 Sheet 必须留在可视区域内。
- Composer 窄屏沿用紧凑图标入口；隐藏文字后保留可访问名称和完整菜单能力。不要照搬旧截图中某次固定的按钮数量。
- 保持页面可缩放，不在 viewport 中禁用 `user-scalable`；Sheet、Dialog 内长内容使用 `overscroll-behavior: contain`，避免滚动穿透到背景层。
- 图标按钮提供 `aria-label` 等可访问名称，并按需提供 Tooltip；装饰图标使用 `aria-hidden`。Tooltip 不能是触屏上理解操作的唯一途径。
- 使用正确的 button、link、heading、label 和菜单语义；展开项关联 `aria-expanded` / `aria-controls`，选择项暴露选中状态。
- 键盘可完成主要操作，焦点环保持可见，Dialog / Sheet 关闭后焦点返回触发器。危险确认不默认聚焦破坏性按钮。
- 动画只辅助反馈，不影响输入和阅读。使用 `motion-safe` / `motion-reduce` 或 reduced-motion 媒体规则处理旋转、位移和过渡；自定义过渡只动 `transform` 和 `opacity`，不使用 `transition-all`。

## 9. 设计验证与维护

对实际 UI 改动按影响范围检查：

- 对照同类页面，确认字段、按钮位置与主次、文案及状态展示一致。
- 桌面、390px 和涉及紧凑布局时的 320px 视口；分栏或断点改动额外检查断点两侧。
- 明暗模式；主题相关改动覆盖三套配色，确保文字、选中态、焦点和警告可辨。
- 长标题、长路径、多项列表、空态、加载、失败及进行中状态，不只检查理想数据。
- 菜单打开、键盘操作、焦点返回、提交与错误恢复，以及窄屏下输入和草稿保留。
- 纯键盘走查一遍主要流程；系统开启 reduced-motion 后动画降级正常。
- 刷新、复制链接、新标签打开后页面状态一致（URL 状态生效）；masked 界面额外验证一次 history back 即可关闭。
- 页面无意外横向溢出，滚动归属清晰，固定操作不遮挡内容，浏览器无新增错误。

有参考设计时对照信息层级、布局、密度与交互；验收证据记录在 PR 或任务交付中，说明实际检查的视口、状态和未验证范围。不要把临时截图绝对路径、测试会话地址或一次性的“passed”结论写入长期规范。共享约定变更时同步更新本文及对应组件；纯文档改动检查链接、格式和 diff，无需为其启动 UI 或运行应用测试。
