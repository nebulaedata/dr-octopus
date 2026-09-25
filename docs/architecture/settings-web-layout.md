# Settings Web 框架布局与交互设计

> 状态：设计基线（Design Baseline）
>
> 版本：v0.2
>
> 日期：2026-09-03
>
> 视觉输入：用户提供的 Settings 参考图，仅作为布局、密度和层级证据，不作为产品文案、Provider 清单或业务规则来源

## 1. 目标与边界

本文把 Settings Web 的框架布局收口为可实施契约，覆盖：

- 全局 Settings 导航；
- 模型服务的 Provider 目录与详情工作区；
- 其他 Settings 页面的通用内容框架；
- 桌面、平板和移动端响应式行为；
- 加载、空态、错误、编辑和删除确认状态；
- shadcn/ui 组件映射与可访问性要求。

参考图中的品牌、颜色值、字体、功能名称、Provider 名单、开关含义和模型操作不构成需求。产品信息架构、字段能力和 mutation 语义仍以
[Settings 模块架构设计](./settings-module.md)、[模型服务详细设计](./settings-model-providers.md)和
[Settings HTTP API 统一契约](./settings-http-api-contract.md)为准。

本文只修改设计文档，不授权本轮直接修改 React 页面或 `packages/ui` 源码。

## 2. 视觉原则

从参考图提取以下可复用原则：

1. 用相邻分栏表达“设置分类 → Provider → Provider 详情”的层级关系；
2. 每栏独立滚动，搜索、当前对象标题和主操作保持可见；
3. 选中态使用低对比表面和边框，不依赖品牌色大面积填充；
4. 详情页按认证、Endpoint、模型等任务分区，保持紧凑但不牺牲表单标签；
5. 次要操作使用图标按钮并提供 Tooltip，危险操作不与高频操作同等突出；
6. 使用主题语义 token，不复制参考图的硬编码黑色、灰色或像素级视觉样式。

## 3. 页面框架

Settings 不是独立页面应用。Workbench 内的 Settings 入口使用 TanStack Router route mask 打开模态层，背景 Workspace 或 Session route 保持挂载；地址栏仍显示 canonical `/settings/*` URL。直接访问、分享或刷新 canonical URL 时，`/settings/*` 继续作为 Workbench Layout 子路由渲染，形成不依赖浏览器历史状态的兜底页面。

模态层与 canonical 页面复用同一个 `SettingsFrame`、SettingsNavigation 和业务页面，禁止复制两套 Settings UI。下文所称 SettingsNavigation 是 Settings feature 内的二级导航，不代表第二个顶层 Sidebar。

### 3.0 页面类型

Settings 导航中的页面分为两类：

- 完整功能页：模型服务、默认模型、扩展、关于；
- 占位页：主题模式。

“关于”在导航中只有一个入口，页面内展示当前构建对应的发布版本、开源方与社区维护者、项目许可证和第三方许可声明。版本取自 `release.config.json` 的发布清单，与 GitHub Release 的 `v{version}` 标签对应；许可证和第三方声明链接也固定到同一标签。旧版“版本 / 公司 / 开源协议”URL 重定向到统一页面。

完整功能页复用本章的三栏或两栏框架。占位页也必须保留完整 Settings 导航和页面标题，内容区使用 `Empty` 展示“尚未开放”及简短范围说明；不得放置可编辑字段、保存按钮或模拟成功反馈。

### 3.1 桌面端模型服务

适用条件：视口宽度不小于 `1024px`。

```text
WorkbenchSidebar │ WorkbenchHeader / 当前 Workspace 或 Session（背景保持挂载）
                 └─ Route-masked Settings Dialog
┌──────────────────────┬──────────────────────────┬────────────────────────────────────┐
│ SettingsNavigation   │ ProviderCatalog          │ ProviderWorkspace                  │
│                      │ ┌──────────────────────┐ │ ┌────────────────────────────────┐ │
│ 分组导航             │ │ 搜索                 │ │ │ Provider 标题 / 状态 / 操作    │ │
│                      │ └──────────────────────┘ │ └────────────────────────────────┘ │
│ 当前页面选中态       │ Provider 列表             │ 认证                               │
│                      │                          │ Endpoint                           │
│                      │                          │ 模型工具栏                         │
│                      │ ┌──────────────────────┐ │ 模型分组与模型行                   │
│                      │ │ 添加本地提供商       │ │                                    │
└──────────────────────┴──────────────────────────┴────────────────────────────────────┘
```

Dialog 桌面端使用接近全屏但保留背景语境的受限视口，移动端使用全屏；内部 Settings 根容器使用 `h-full min-h-0 overflow-hidden`。canonical 页面高度继承 Workbench 主内容区，禁止为 canonical `SettingsLayout` 创建第二个 `h-dvh` 应用壳。布局尺寸为：

| 区域               | 默认宽度 | 约束               | 滚动责任                         |
| ------------------ | -------- | ------------------ | -------------------------------- |
| SettingsNavigation | `224px`  | 固定，不随内容扩张 | 导航内容过高时独立滚动           |
| ProviderCatalog    | `288px`  | `240px` 至 `360px` | 仅 Provider 列表滚动             |
| ProviderWorkspace  | 剩余空间 | `min-width: 520px` | 详情主体滚动，标题与工具栏可粘滞 |

三栏之间使用 `border-border` 分隔。Provider 目录与详情之间可以使用 `ResizablePanelGroup`，但不是首期必需条件；若启用可调整宽度，必须保留上述最小宽度并将用户选择限制在当前浏览器会话，不引入新的服务端设置。

### 3.2 其他 Settings 页面

默认模型、扩展和占位页复用同一外壳，但移除 Provider 目录：

```text
┌──────────────────────┬───────────────────────────────────────────────────────────────┐
│ SettingsNavigation   │ SettingsPage                                                  │
│                      │ 页面标题 / 说明                                                │
│                      │ 页面内容                                                       │
└──────────────────────┴───────────────────────────────────────────────────────────────┘
```

内容区使用 `max-width: 960px` 的可读宽度；列表型页面可放宽到 `1200px`。页面级标题和状态提示由 feature 层拥有，不下沉到通用组件。

### 3.3 分栏滚动与粘滞区域

- Settings 导航、Provider 列表和 Provider 详情各有唯一 `ScrollArea`；
- Provider 搜索位于目录顶部，不随列表滚走；
- “添加本地提供商”位于目录底部，不随列表滚走；
- Provider 标题栏在详情滚动容器顶部保持可见；
- 模型工具栏只在模型区进入视口后粘滞，不能遮挡 Provider 标题栏；
- Dialog、Sheet 和 Popover 打开时不得改变三栏宽度或造成布局跳动。

## 4. 导航与路由状态

### 4.1 SettingsNavigation

导航项严格来自 [Settings 模块架构设计](./settings-module.md)第 4 节，不复制参考图的信息架构。桌面端在 Settings Dialog 或 canonical 页面内使用固定宽度二级 `aside`，移动端使用 shadcn/ui `Sheet`；不得再挂载第二个顶层 `SidebarProvider`。桌面端不可折叠成仅图标模式，避免设置分类失去可扫描性。

- canonical 页面由 TanStack Router route match 决定；masked Dialog 由 Workbench 已校验的 `settings.path` search state 决定；
- 每个导航项具有文本标签和 `aria-current="page"`；
- 图标只作为辅助识别，使用 `lucide-react` 的 `*Icon` 导出；
- 占位页仍可导航，但必须展示“尚未开放”，不能渲染伪保存表单。

### 4.1.1 Route-masked Dialog

- 从 Workbench 打开时，实际 location 保留当前 pathname，并在 Workbench search schema 中写入经过校验的 `settings: { path, provider? }`；
- `mask` 将地址栏投影为对应的 `/settings/*` canonical URL，且设置 `unmaskOnReload: true`；
- 打开 Dialog 使用一次 push navigation；Settings 内部切页和 Provider 选择统一使用 replace navigation，确保关闭只需返回一次；
- Esc、遮罩点击、关闭按钮调用 Router history back，恢复打开前的 Workspace、Session、右侧 Panel 与其他 search state；
- canonical `/settings/*` 仍是可独立匹配的真实路由，刷新、复制链接或新标签页打开时不得依赖 masked location state；
- Dialog 使用 shadcn/ui `Dialog`，必须提供 `DialogTitle` 和 `DialogDescription`，关闭焦点返回触发按钮。

### 4.2 ProviderCatalog

Provider 选择由 URL search parameter 保存：

```text
/settings/model-providers?provider=p1_<opaque-provider-key>
```

- Web 只透传 Server 返回的 opaque `providerKey`；
- 首次进入且没有 `provider` 时，选择列表中第一个可展示 Provider 并使用 replace navigation 写入 URL；
- URL 指向不存在的 Provider 时保留目录，详情区显示可恢复的 not-found 状态，不静默选择其他项；
- 搜索是本地视图状态，不写全局 Store，也不改变 URL；
- Provider 行至少展示名称、provenance 或认证状态摘要，禁止回显或模拟 Secret 长度。

## 5. Provider 详情线框

### 5.1 详情结构

```text
ProviderHeader
├─ 名称、Provider ID、provenance Badge
├─ 认证与可用状态摘要
└─ 能力驱动的次要操作菜单

ProviderAuthSection
├─ 认证方式 Field
├─ API Key / OAuth 动作
├─ 验证状态与最近结果
└─ 移除凭证动作

ProviderEndpointSection
├─ effectiveBaseUrl 只读或可编辑 Field
├─ API authoring subset Select
└─ 恢复默认 Endpoint 动作（仅 overlay）

ProviderModelsSection
├─ 模型计数、搜索、刷新与添加动作
└─ ModelGroup[]
   └─ ModelRow[]
      ├─ 名称、ID、能力 Badge
      ├─ 默认模型状态
      └─ 查看 / 编辑 / 删除动作
```

所有区域按 `ModelProviderCapabilitiesDto` 条件展示。不得为不支持的能力渲染可点击但必然失败的控件。

### 5.2 查看与编辑

- inherited 模型只读；
- overlay 模型允许编辑显式 override，并提供“恢复继承值”；
- owned 模型允许编辑与删除；
- “添加模型”和“编辑模型”使用 Dialog，表单使用 TanStack Form 的 `FieldGroup`、`Field`、`InputGroup` 和 `Select`；
- 表单只暴露 [模型服务详细设计](./settings-model-providers.md)第 7.3 节定义的 API authoring 子集；
- `compat`、`samplingParams`、headers、cost 和未知字段不进入首期表单，mutation 必须原样保留；
- 提交时主按钮展示 `Spinner` 并禁用重复提交；成功后关闭 Dialog，由 TanStack Query 失效并重新读取详情；
- `412` 配置冲突保留用户输入，展示冲突 Alert 并要求重新加载，不自动覆盖远端状态。

### 5.3 删除确认

Provider 或模型删除使用 `AlertDialog`，不能使用普通 `Dialog` 模拟确认语义。

确认内容必须包含：

- 将删除的 Provider 或模型名称与 ID；
- 删除对象的 ownership；
- 是否承载当前全局默认模型；
- mutation 的生效时机；
- 默认模型依赖存在时的 replacement 引导。

若服务端返回 `DEFAULT_MODEL_DEPENDENCY`，界面保持确认上下文并引导用户先选择 replacement；不得先删除后修复。只有 owned Provider 可删除；overlay 使用“移除覆盖”，文案不得写成删除底层 Provider。

## 6. 状态设计

| 状态                         | Provider 目录               | 详情区                                                |
| ---------------------------- | --------------------------- | ----------------------------------------------------- |
| 首次加载                     | 与最终行高一致的 `Skeleton` | 标题、表单和模型行骨架                                |
| 无 Provider                  | `Empty` + “添加本地提供商”  | 解释如何开始，不显示空表单                            |
| 搜索无结果                   | `Empty` + 清除搜索          | 保留当前已选详情                                      |
| 列表查询失败                 | `Alert` + 重试              | 不渲染失真的默认 Provider                             |
| 详情查询失败                 | 保留目录和选中项            | `Alert` + 重试，区分 not-found 与暂时失败             |
| refresh / verify 进行中      | 不阻塞 Provider 切换        | 对应按钮内 `Spinner`，保留已有快照                    |
| refresh 失败且存在缓存       | 状态摘要显示 warning        | `Alert` 说明继续展示缓存，不清空模型                  |
| mutation 成功                | 重新读取摘要                | Toast 简述结果和生效时机，再以服务端快照为准          |
| committed but unsynchronized | 不显示“安全重试”            | 持久 Alert，提示刷新 Provider 或重启服务              |
| Provider URL 无效            | 保留目录                    | not-found `Empty`，提供返回列表第一个有效项的显式动作 |

Skeleton、Empty、Alert 和 Toast 必须使用 `packages/ui` 的现有 shadcn 组件，不新建平行的状态组件体系。

## 7. 响应式行为

### 7.1 中等宽度

适用条件：`768px` 至 `1023px`。

- Settings 导航收进左侧 `Sheet`，由页面标题栏按钮打开；
- 模型服务保留 Provider 目录与详情两栏；
- Provider 目录默认 `264px`，详情占剩余空间；
- 模型行的低频动作收进 `DropdownMenu`；
- 不把桌面三栏等比例压缩。

### 7.2 移动端

适用条件：小于 `768px`。

- 单列展示；
- Settings 分类导航使用 `Sheet`；
- 没有有效 `provider` 时显示 Provider 目录；
- 选中 Provider 后导航到带 search parameter 的详情视图，并提供带文本的返回按钮；
- 返回只移除当前详情选择，不清除搜索词；
- 添加和编辑表单优先使用全高 `Sheet`；短确认仍使用 `AlertDialog`；
- 表单按钮在底部安全区上方保持可见；
- 不依赖横向滚动访问主要字段或操作。

## 8. shadcn/ui 组件映射

| 需求                   | shadcn/ui 组件                                   | 当前仓库状态               |
| ---------------------- | ------------------------------------------------ | -------------------------- |
| Settings 导航          | `Sidebar`、`Separator`                           | 已安装                     |
| 独立滚动区             | `ScrollArea`                                     | 已安装                     |
| 可选分栏调整           | `ResizablePanelGroup`、`ResizablePanel`          | 已安装                     |
| 搜索和带尾部动作的输入 | `InputGroup`                                     | 已安装                     |
| 表单结构               | `FieldGroup`、`Field`、`Select`                  | 已安装                     |
| 开关与状态             | `Switch`、`Badge`、`Tooltip`                     | 已安装                     |
| 模型分组               | `Collapsible`                                    | 已安装                     |
| 添加 / 编辑            | `Dialog`（桌面）、`Sheet`（移动端）              | 已安装                     |
| 加载 / 空态 / 错误     | `Skeleton`、`Empty`、`Alert`、`Toast`、`Spinner` | 已安装                     |
| 次要操作               | `ButtonGroup`、`DropdownMenu`                    | 已安装                     |
| 危险操作确认           | `AlertDialog`                                    | 开发时通过 shadcn CLI 补齐 |

实现时只从 `@octopus/ui/components/*` 消费这些 primitives。禁止直接修改 `packages/ui/src/components/`；缺失的 `AlertDialog` 必须使用官方 shadcn CLI 安装到 `packages/ui`，不得手工复制源码。

布局使用 `gap-*`、`min-h-0`、`min-w-0` 和语义颜色 token。业务视觉定制通过 feature wrapper 与 `className` 完成，不修改共享 primitive 的默认样式。

## 9. 键盘与可访问性

- 三栏按 DOM 顺序排列为导航、目录、详情；视觉顺序不得与 DOM 顺序相反；
- 搜索结果变化通过可感知的结果计数表达，不抢夺输入焦点；
- Provider 行使用链接语义，可在新标签页打开并保留 URL 状态；
- 图标按钮必须有可访问名称和 Tooltip，装饰图标设置 `aria-hidden`；
- Dialog、Sheet 和 AlertDialog 打开后由组件管理焦点陷阱，关闭时焦点返回触发器；
- 删除确认的默认焦点不得落在危险按钮；
- 状态不能只用颜色表达，必须同时有文本、图标或 Badge；
- 键盘用户可以访问搜索、Provider 列表、详情区和全部操作，且焦点环不被滚动容器裁切。

## 10. Feature 边界

```text
apps/web/src/features/settings/
├─ layout/
│  ├─ SettingsLayout
│  ├─ SettingsNavigation
│  ├─ SettingsMobileNavigation
│  └─ SettingsPageHeader
└─ model-providers/
   ├─ ModelProvidersPage
   ├─ ProviderCatalog
   ├─ ProviderCatalogItem
   ├─ ProviderWorkspace
   ├─ ProviderHeader
   ├─ ProviderAuthSection
   ├─ ProviderEndpointSection
   ├─ ProviderModelsSection
   ├─ ModelGroup
   ├─ ModelRow
   ├─ ModelEditorDialog
   └─ DeleteModelDependencyDialog
```

`features/settings` 拥有业务查询、mutation、路由和能力判断。`apps/web/src/components` 不得依赖 Settings DTO、Query hooks、route params 或 client store。服务端状态由 TanStack Query 管理；URL 可表达的选择由 TanStack Router 管理；表单由 TanStack Form 管理。

## 11. 实施验收

开始 Settings Web 实施前，开发者应能仅凭本文和已链接领域文档回答：

1. 当前视口应该渲染几栏，各栏由谁滚动；
2. Provider 选择、非法 URL 和移动端返回如何改变路由；
3. 哪些 Provider、Endpoint 和模型操作由 capability 与 ownership 决定；
4. loading、empty、cached error、conflict 和 partial commit 如何展示；
5. 模型编辑和删除确认何时允许、何时必须先替换默认模型；
6. 每个区域复用哪个 shadcn/ui primitive；
7. 哪些状态属于 Query、Router、TanStack Form 或纯局部 UI 状态。

实现完成后至少验证：

- `1440 × 900`、`1024 × 768`、`768 × 1024` 和 `390 × 844` 四种视口；
- 三栏/两栏/单栏切换没有内容溢出或重复滚动条；
- 键盘全流程、焦点返回和危险操作确认；
- reference screenshot 与最终页面在信息层级、密度和分栏结构上的视觉对照；
- light/dark theme 均只使用语义 token；
- `pnpm lint`、`pnpm typecheck`、相关 Web tests 和视觉回归检查通过。
