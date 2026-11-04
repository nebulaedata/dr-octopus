# Executor 验证状态与已知限制

更新日期：2026-11-02（补充工具策略重启生效验证；不代表发行验收完成）。本文汇总已完成开发、实际检查与尚未完成的交付条件，替代按日期累计的阶段报告。接口见 [架构入口](../architecture/executor.md)，发布门禁见 [交付](../architecture/executor-delivery.md#发布门禁)。

## Vite 配置原生加载（2026-11-02，通过）

配置中 product 导入补充 .ts 扩展名，Node 侧 noEmit 类型检查启用 allowImportingTsExtensions。默认配置加载及显式 --configLoader native 的 Renderer 构建均通过，缺少扩展名的兼容性警告消失；Node 侧类型检查、配置 ESLint 和 diff 检查通过。验证输出使用本批独立目录，未替换常规 dist；现存 chunk 大小警告与此项无关。

## 工具策略统一设置草稿与生效提示（2026-11-02，隔离应用回归通过）

策略选择、新建、复制、编辑和删除只更新设置页草稿；弹窗“确认”不持久化。策略与其他设置共用 diff、撤销及“保存设置”，改回原值清除未保存标记；忽略修订号及工具／策略列表的非语义排序，保留选中项、名称、成员增删的真实差异。移除独立策略保存 IPC，通过既有 saveSettings 校验策略修订号后一次 SettingsPublication 发布，过期草稿拒绝整个请求。保存不会改变运行中的工具集合，主题和窗口偏好仍按既有立即生效流程处理。五个区块统一使用 SettingsEffectBadge 的 setting → immediate/restart → 图标及文案映射，工具策略显示“保存并重启后生效”。

同日补充：设置页的“撤销更改”和“保存设置”合并为右对齐按钮组，未保存提示保留在左侧。SettingsField 直接消费页面用于 dirty 判断的逐字段 diff，为已修改且校验有效的输入／下拉显示浅警告色边框与背景，开关增加警告色外圈；错误字段保留错误色。保存、撤销或还原原值后清除高亮。Renderer 隔离构建、相关 ESLint、Renderer 类型检查及真实 policy UI 回归通过，检查了实际边框颜色变化、还原清除和按钮同排相邻；已复核本批桌面截图。

应用级 lint、typecheck 通过。runtime-manager、maintenance-ipc、tool-policy-draft、native/connection-settings、native/tool-policy 共 **17/17** 聚焦测试通过，覆盖统一发布、过期和并发请求、diff 回退、持久化及重启前后权限。包级 test 首轮 **289/290**；唯一失败是本次不必要地扩大内部 ConnectionSettings.read() 的返回字段，已恢复其既有契约，对应完整测试文件 **7/7** 复验通过；没有将未重跑的完整包套件记作全绿。

完整应用 build 在原生文件可写检查处因 computer-escape.node 占用失败。另建测试副本复用未修改的原生与 Runtime 资源，重新编译当前 Main、Preload、Renderer；不是完整原生重建或发行验收。该副本上 tool-policies.test.mjs **1/1** 通过，确认选择不写盘、切回原值、撤销、弹窗确认不写盘、待重启时拒绝丢弃脏草稿、显式统一保存、主题立即生效且 Runtime PID 不变、当前权限不变及重新启动后策略加载。

首两次界面运行在重新打开实例时因默认端口 19876 占用失败，诊断明确为 PORT_IN_USE／EADDRINUSE；统一保存使原先仅策略写盘的测试也开始持久化监听偏好。测试装配改为预先分配专属空闲端口，保留业务断言和原期限后通过。首次失败、诊断 JSON、最终回归及桌面／窄窗口截图按应用 AGENTS.md 存于本批本地验证材料；原运行实例及常规 dist 未替换，本次未验证安装包。

## Renderer 页面语义模块整理（2026-11-02，局部验证完成）

当前工作区将 Renderer 的状态、连接、设置分别整理到 `features/status`、`features/connection`、`features/settings`，外壳及跨页提示归 `features/layout`；复用展示组件归 `components`。路由仍为原来的 hash 根路由，查询、轮询、复制反馈与导航状态仍由外壳持有。设置页保持设备身份之后展示工具权限策略。

迁移前后均执行清空 Renderer 输出的 Vite 构建；迁移后应用级 lint、typecheck 通过。`connection-settings.test.mjs`（2 项）、`tool-policies.test.mjs`、`listen-failure.test.mjs`（2 项）、`transfer-settings.test.mjs`、`runtime-recovery.test.mjs`、`theme.test.mjs` 共 8 项最终通过。首次设置基线出现一次等待服务启动超时；迁移后同条件通过。恢复及主题首次因继承 `ELECTRON_RUN_AS_NODE=1` 而启动失败，清除测试进程环境变量后通过；保留首次失败，不修改测试期限或断言。

`desktop-overview.test.mjs` 在设置表单分隔线数量断言失败（预期 0，实际 1）。从暂存区恢复迁移前组件图并保留此前工具策略排序的隔离副本，重新构建后复现同一失败；本次未改动该测试或分隔线行为，三页导航回归不能记作完整通过。完整应用 build 被运行实例占用 `dist/native/computer-escape.node` 阻挡（`EXECUTOR_NATIVE_OUTPUT_BUSY`）；仅重建 Renderer，Main/Runtime/原生产物未重新构建。本次未执行全部原生测试或发行验收。

原始失败日志、环境修正后的复验、迁移前隔离对照及设置页截图保存在本批本地验证材料中，遵循应用 AGENTS.md 的验证材料目录规则；不作为已发布安装包的验收证据。

## 工具策略统一重启生效（2026-11-02，开发回归通过）

基于 bd1f501 的当前工作区，工具策略保存复用现有 SettingsPublication、设置写入锁、pendingRestart 与完整重启入口；已移除动态发布 IPC、运行时策略替换及重新应用按钮。服务启动时固定工具集合，工具概览使用启动快照。仅名称、工具顺序或未选中策略变化不要求重启；恢复原工具集合不清除其他配置导致的待重启状态。决定见 [ADR-0085](../adr/0085-executor-tool-policies.md)。

`pnpm --filter @octopus/executor typecheck`、`pnpm --filter @octopus/executor lint` 通过；针对源码执行的 `pnpm --filter @octopus/executor exec node --import tsx --test --test-concurrency=1 test/runtime-manager.test.mjs test/application-restart.test.mjs` 9/9 通过。首次 lint 报告新增测试的三处 curly 格式错误，修正后复验通过；相关修改文件的 Prettier 与 diff 空白检查通过。

首次 `pnpm --filter @octopus/executor build` 及同条件重试均在原生输出可写检查处失败：`EXECUTOR_NATIVE_OUTPUT_BUSY`，运行中的进程占用 `dist/native/computer-escape.node`。用户完整退出后重新构建通过，未强制终止日常实例或使用旧构建验证。保留 Vite 配置加载与 chunk 大小警告。

新构建上 `pnpm --filter @octopus/executor test` **288/288 通过**，包含真实 MCP 工具发现与调用权限在保存后不变、重启后放宽／收紧权限的回归；lint、typecheck 再次通过。真实 Electron 的 `tool-policies.test.mjs` **1/1 通过**，覆盖选择、新建、搜索、复制、删除、放弃、保存、统一待重启提示及重新启动后的策略加载；设置页与桌面／窄窗口编辑器截图已保存并检查。

共用设置流程的 `connection-settings.test.mjs` 与 `transfer-settings.test.mjs` 最终 **3/3 通过**。首次因环境变量 `ELECTRON_RUN_AS_NODE=1` 导致启动失败；清除后暴露两处旧断言：隐藏状态标记被要求可见、版本号写死为 0.0.1。测试启动现在自行清除该变量，改为断言实际状态文本并读取产品版本，未放宽业务断言和超时；复验确认监听配置与文件传输限额仍只在重启后生效。测试修改的 ESLint、Prettier 与 diff 检查通过。

构建、测试首次失败与复验日志、界面截图保存在本次 tool-policy-restart 本地验证批次。以上为当前工作区开发验证，未重新打包或进行独立电脑、签名及发行验收。

## 一键验收构建（2026-10-30）

基于 bd1f501 的当前工作区，根 `pnpm build:executor` 已串行完成缺失 Computer 资源装配、Chrome/Edge 插件构建、Executor 编译、缺失打包工具装配和验收打包。产物批次为 `0.0.4-unsigned-b0d69c69-da5f-4259-9635-1b88fd73e924`，productBuildId 为 `4240ed68cabe47864132aaf23f6c40a9cd7afa569561796b792159b0940a80b9`；安装程序 216811829 字节、ZIP 270982226 字节，已独立核对两者大小和 SHA-256 与 acceptance-artifacts.json 一致。

最终入口先构建插件及 shared，保证首次资源装配读取应用契约时已有共享依赖输出。隔离子进程回归覆盖缺失资源装配、已有资源复用、含空格/中文的产物路径，以及任一产品构建失败后不再打包；工程脚本检查合计 6/6 通过。`pnpm --filter @octopus/executor test` 284/284 通过，lint、typecheck、变更文件 Prettier 检查通过。日志保存在本次 installer-build 验证批次；首次构建仍有 Vite 配置加载与分包大小警告，未屏蔽。

本次仅验证工程编排和未签名产物生成，未执行新包安装、独立电脑断网首启、升级卸载或签名发行验收；既有发行门禁状态不变。命令与资源复用规则见[交付指南](../architecture/executor-delivery.md#日常重新构建与打包)。

## 浏览器录制与本地重放（第一阶段主流程开发验收通过）

[融合设计](../architecture/browser-extension-recorder.md)与 [ADR-0086](../adr/0086-browser-extension-recording-and-local-replay.md) 已接受方向，用户已授权在 `recorder` 分支实施第一阶段。当前工作区已接入录制、工具栏和记录查看，主流程开发验收已通过，专项与发行验收限制见下文；AI 编译与本地重放未实施。下表保留完整验收目标，具体已验证范围以本节证据为准，不能把局部通过提升为全部完成。

2026-10-27，Popup 调整为独立 `ExtensionPopup` 容器，连接 Tab 第一且默认选中；录制页独立，详情使用应用级 `NavigationBar`，保存为 default 实心 Button，删除为 destructive。已删除被用户指出的冗余常驻提示，旧 `RecorderPopup` 容器和入口中的 `Popup.tsx` 已移除并更新引用。视觉依据为入口 v2 / 详情 v3 加用户明确的 Tab 顺序和按钮变体修订，见[视觉登记](../../apps/browser-extension/DESIGN.md)（apps/browser-extension/DESIGN.md 附录 A）。

验证：shared 构建通过；扩展 Chrome/Edge 双目标构建及 23 份依赖许可收集通过；TypeScript 检查、lint、包级测试 31/31 通过。原连接 Popup 的 Chrome/Edge 隔离回归 2/2 通过；录制流程 Chrome/Edge 隔离复验 2/2 通过，覆盖默认连接页、进入录制、Popup 关闭后继续采集、暂停/继续、关联新 Tab、跨页停止、原值脱敏、工具栏事件排除、持久保存、重命名及导航/按钮样式。实际截图复核发现的 Shadow Root 边框/阴影初始值问题已在应用样式适配中修正，没有改共享 shadcn 源码。

首轮新增的删除按钮断言误用了现有 Button 未输出的 `data-variant`，两浏览器均在该断言失败；第一次修改未匹配格式化后的多行断言，复验仍失败。修正测试装配为实际渲染样式检查后，保留业务断言与原时限复验通过。日志保留在系统临时目录的 `octopus-recorder-ui-revision.log`、`octopus-recorder-ui-revision-recheck.log`、`octopus-recorder-ui-revision-final.log`；最终截图及 JSON 为 `octopus-recorder-MinyoS/evidence`（Chrome）和 `octopus-recorder-nRBHb2/evidence`（Edge）。测试使用专属 Profile、扩展副本和未注册测试 Host，未修改正式 Host 注册或日常浏览器数据。

2026-10-27，全部记录页 v2 获批后，已接入首页 5 条摘要、完整列表每批 20 条稳定游标/全量搜索、详情每批 50 条事件，以及详情返回时保留列表和滚动位置。新增 IndexedDB v2 索引采用非破坏性升级。双目标构建、类型检查、lint 和包级测试 31/31 通过；`test:recording` 的 Chrome/Edge 隔离测试 2/2 通过：126 条记录（含同时间戳）分为 20×6＋6 无重复无遗漏、首批之外搜索、返回列表恢复 300px 滚动位置、123 条事件按 50/50/23 读取；另用浏览器原生 IndexedDB 验证 v1→v2 保留原始会话及事件、删除边界记录后仍能继续、较新插入不污染旧游标链。证据为系统临时目录 `octopus-recorder-nBGZAb/evidence`（Chrome）、`octopus-recorder-lejCYc/evidence`（Edge）及 `octopus-recorder-pagination-final.log`。

2026-10-27，固定外框修订已接入：ExtensionPopup 固定品牌和 Tab；应用级 PopupPage 统一固定子页导航/操作区，正文复用 ScrollArea；首页、详情、全部列表与连接页不再滚动外层 body。空态统一 Empty，记录行增加 hover/active/focus-visible、pointer 和箭头反馈，开关合并为单条文案；没有引入 Jotai。共享 ScrollArea 首行未使用 React 导入触发插件类型错误，官方 CLI dry-run 无差异；用户明确批准后仅删除这一行，未修改共享组件 API 或样式。

本轮双目标构建与许可、插件类型检查/lint、shared UI 类型检查、31 项包级测试均通过。原连接 Popup Chrome/Edge 回归 2/2 通过；录制与分页隔离测试最终 2/2 通过，新增验证长内容滚动时品牌/Tab/NavigationBar 坐标不变、body 不溢出、实际 ScrollArea viewport 滚动、420px 短屏深色布局、底部删除可见、记录行悬停变色/键盘焦点和 Enter 导航、Empty 搜索无结果/清空恢复，以及替换 viewport 后仍保留返回位置。最终截图及结果 JSON：系统临时目录 `octopus-recorder-YSVK1G/evidence`（Chrome）、`octopus-recorder-LbmhtR/evidence`（Edge）；日志为 `octopus-recorder-wrapper-final-build.log`、`octopus-recorder-wrapper-final-e2e.log`、`octopus-recorder-wrapper-popup.log`。实际页面截图与已批准稿对照复核；短屏压缩正文高度是有意适配，固定区域不参与滚动。

2026-10-28，异常路径检查修复以下实现缺口：页面命令和事件提交重新核对权限与可用性；权限移除、冻结/丢弃通知触发参与范围复核，失去资格的页面停止采集且恢复权限后不自动加入；浏览器事件也检查全局字节预算；浏览器事件写盘成功后才推进计数/归因缓存；停止收尾写盘失败始终释放所属收尾锁，可以在存储恢复后再次停止；停止等待期间关闭最后一个 Tab 不再提前销毁会话；旧会话/世代的传输重试不继续发送。

新增受控 peer 测试覆盖权限撤回拒绝待提交批次、单参与页不可用时保留其他页面、冻结/丢弃后不自动重新加入、收尾存储故障后恢复、停止期间标签关闭、3 秒收尾超时后的部分保存及迟到拒绝、事件数/会话字节/全局字节限额、浏览器事件事务失败不提前推进。包级测试现为 41/41；构建、lint、typecheck 通过。

真实 Chrome/Edge 隔离验证新增：open Shadow DOM 按钮与输入采集、输入原值排除、iframe 内操作不采集且提示不支持、全量页面重载后重新绑定并继续采集、最后一个参与 Tab 关闭转中断，以及同一 Profile 正常关闭再启动后已提交证据保留且不自动续录。浏览器原生 IndexedDB 验证过期终态会话连同事件删除、过期但活跃的会话不被清理。最终连接与录制集成测试 4/4 通过，结果 JSON 明确记载 `restartKind` 为正常关闭/重开，不宣称崩溃测试。

首轮真实回归发现本次原子写入修改替换了页面对象引用，导致新关联页面身份未写回、停止操作被拒绝；修正为仅在提交成功后复制计数/归因字段，保留参与页身份引用，新增专项回归后原场景通过。原始失败：系统临时目录 `octopus-recorder-failure-e2e.log` 与 `octopus-recorder-ARyHd4/evidence`、`octopus-recorder-APHj6X/evidence`。最终日志为 `octopus-recorder-phase1-final.log`、`octopus-recorder-phase1-types.log`，构建日志为 `octopus-recorder-failure-build2.log`；最终截图/JSON 为 `octopus-recorder-vTrhkD/evidence`（Chrome）、`octopus-recorder-AmLR9q/evidence`（Edge）。所有验证仅使用专属 Profile、测试 Host 副本和合成数据。

2026-10-28，第二轮生命周期专项完成并发现/修复 BFCache 序号缺陷：缓存文档恢复时 Content 保留旧批次号，而 SW 当前文档进度已重置，导致新输入无法提交。`recorder.hello` 现在返回会话和权威 `lastBatch`，页面恢复时重新同步；本地 generation 隔离恢复前的传输重试、回包和 pagehide 收尾，避免旧异步操作改写新页面状态。新增单测确认恢复后可提交新输入；没有引入旧消息格式兼容分支。

真实验证范围：Chrome/Edge 均命中 BFCache（`pageshow.persisted=true` 且 documentId 恢复），恢复后的真实 Input 事件继续写入；两浏览器均通过设置页将本次测试扩展站点访问改为 ON_CLICK，确认 `permissions.contains=false` 后录制中断。测试不修改正式 Profile。两浏览器均验证无网页调试器附着时的 `tabs.discard`，没有隐式重载；以 `Browser.crash` 令本次独立进程异常退出，重开同一 Profile 后已提交事件保留且不自动续录。Input 输入阶段曾临时附着调试会话，历史导航、丢弃、冻结及状态拒绝检查前均已 detach 并断言 `attached=false`；不声称整个测试从未附着。

Edge 的浏览器诊断页 Freeze 操作及实际 frozen 标志/录制中断通过。Chrome 将诊断页重定向到 `chrome://debug-webuis-disabled/?host=chrome://discards/`，冻结子项明确记录 blocked，未关闭该保护、未使用页面调试器强制冻结代替。IME 使用 Chromium `Input.imeSetComposition` + `Input.insertText` 验证组合输入只生成一条脱敏记录，不等同于人工操作系统输入法验收。

首次 BFCache 新输入测试失败原因为产品序号缺陷，日志 `octopus-recorder-bfcache-input.log` 保留。其他测试装配失败也保留：崩溃重启时管理页 API 尚未就绪（`octopus-recorder-detached.log`）；Chrome 诊断页受限（`octopus-recorder-detached3.log`、`octopus-recorder-freeze-diagnostics.log`）；背景页浏览器 goBack 无可跳转条目，改为明确 `history.back()` 并要求真实 BFCache 命中（`octopus-recorder-detached4.log`）；Edge 站点权限使用 Fluent option，首次沿用 Chrome select 失败，随后实际展开控件并选择 ON_CLICK（`octopus-recorder-permission-real.log` 及 `octopus-recorder-edge-permission-*.log`）。未放宽产品断言或增加原等待期限来消除失败。

最终：包级测试 42/42、集成 6/6、Chrome/Edge 构建与许可、lint、typecheck 通过；6 项包含独立记录的 Chrome Freeze blocked 子项，不代表它已通过。最终日志为系统临时目录 `octopus-recorder-lifecycle-final-tests.log`、`octopus-recorder-lifecycle-final-build.log`、`octopus-recorder-lifecycle-final-types.log`。生命周期 JSON：`octopus-recorder-lifecycle-vGO4WR/result.json`（Chrome）、`octopus-recorder-lifecycle-325EWY/result.json`（Edge）；界面/IME/分页证据：`octopus-recorder-ULgd42/evidence`、`octopus-recorder-6qxOat/evidence`。运行入口为 `pnpm --filter @octopus/browser-extension test:recording-lifecycle`，复用仓库已有的 test-only 独立进程/CDP helper，不导入 Executor 生产实现。

2026-10-28，补充 Worker 回收与浏览器原生配额验证。通过管理页的 CDP ServiceWorker.stopAllWorkers 停止仅属于隔离 Profile 的 Worker，先确认旧 background target 消失，再请求状态唤醒新 Worker；Chrome/Edge 均保留同一录制 ID、继续接受页面新操作并正常停止保存。结果 JSON 的 `workerRecovery` 明确记录 `oldTargetRemoved/sessionPreserved/laterInputCommitted`。这验证已提交进度后的 Worker 替换，不把它扩大为所有在途批次时序均已验证。

配额专项未通过验收：在隔离 HTTP 夹具源通过 Storage.overrideQuotaForOrigin 将配额降到 1 字节，Storage.getUsageAndQuota 也报告 1，但原生 IndexedDB 仍接受有界约 11 MiB 随机数据写入，没有抛出 QuotaExceededError。首次断言失败日志 `octopus-recorder-quota-worker.log`、`octopus-recorder-quota-worker2.log` 保留；当前将无法诱发原生配额异常明确记录为 `quota.status=blocked`，恢复夹具中的数据与配额后继续独立 Worker 验证。不替换浏览器 API 伪造配额错误，不申请 unlimitedStorage，不尝试填满用户磁盘；也不宣称 HTTP 夹具源测试覆盖扩展源全部配额策略。

本轮仅扩充测试，未修改录制生产逻辑。Chrome/Edge 录制/分页/存储/重启集成 2/2 通过（每个测试的配额子项独立标记 blocked），lint 与类型检查通过。最终证据为系统临时目录 `octopus-recorder-howyAK/evidence`（Chrome）、`octopus-recorder-Lds2nE/evidence`（Edge）及 `octopus-recorder-worker-quota-final.log`；之前完整 42 项包级与 6 项集成的原证据仍有效且保留。当前未读取用户提供的模型密钥文件、未发起任何真实提供商调用。

2026-10-28，用户反馈真实 action 弹窗高度塌缩。新增真实 popup target 尺寸断言后，Chrome/Edge 均复现 360×32；原因是内容的 `max-height:100dvh` 与浏览器按文档推导初始 popup 尺寸形成循环依赖。为 Popup body 明确 600px 基础高度，应用框仍按实际 viewport 限制高度并保持正文 ScrollArea；两浏览器真实 action popup 均恢复为 360×600。先前“固定 viewport 的普通扩展标签页”通过不能代替该验收，本次补入真实 target 检查。

扩展回归同时复现组合输入重复记录：compositionend 提前 flush，加上失焦后的 change，可能将一次编辑记为两条。改为合并 compositionend 后的最终 input，并把已发生 input 的对应 change 仅作为编辑收尾，不再次产出事实；无前置 input 的 change 仍记录。未读取字段原值。首两轮失败保留在 `octopus-popup-height-scroll.log`、`octopus-popup-height-final.log`；最终原断言复验 4/4 通过，含两浏览器真实 Popup、短屏/固定导航/分页及 IME。证据：`octopus-popup-height-before.log`、`octopus-popup-height-regression3.log`、`octopus-recorder-MyGZNR/evidence`、`octopus-recorder-SbpUoR/evidence`。该修复未改变现有视觉方案，仅纠正实际布局与采集回归。

2026-10-28，连接页 v1 确认后实现固定元信息 footer：版本和安装实例左右排列，实例号缩略展示、完整值悬停可见，复制完整原值成功后显示 success 色 CheckIcon，1.5 秒恢复；失败提供可访问提示，卸载清理计时器。工具链 badge 使用 icon + text；异常标题/短时间同排，完整时间保留于 title/dateTime。长内容使用现有 PopupPage ScrollArea，footer 不参与滚动。

双目标构建、lint、typecheck、42 项包级测试通过；Chrome/Edge Popup 回归 2/2 通过，包括真实 action 尺寸 360×600、受控剪贴板完整值/成功复位/失败重试、图标徽章、时间同排以及 420px 长诊断内容滚动时 footer/品牌栏坐标不变。剪贴板验证替换仅存在于测试页，不写用户 OS 剪贴板；未把替身验证宣称为系统剪贴板权限验收。首次新增定位误认为嵌套 footer 隐含 contentinfo 角色，改为定位实际 footer 元素后原业务断言通过，日志 `octopus-connection-footer-tests.log` 与 `octopus-connection-footer-tests2.log` 保留。截图/结果 JSON：系统临时目录 `octopus-connection-footer-chrome-3DuDIZ`、`octopus-connection-footer-edge-QQvRWl`；构建日志 `octopus-connection-footer-build.log`。已复核深色成功态及浅深色短屏溢出截图。

2026-10-28，经用户确认将录制的 8 个运行模块整体迁入 `apps/browser-extension/src/lib/recording/`，同步 Worker/Content 入口、录制 UI、测试构建入口与样式路径。`recording-content.tsx` 保留 JSX 后缀，`browser-screenshot.ts` 保留且字节未变；没有旧目录转导出或双路径兼容。PageController 适配器仅将 noble SHA-256 导入从 sha256 模块改为 sha2 模块，固定依赖仍为 1.8.0，无锁文件或依赖升级。

迁移前后均使用空的 .output/.wxt 目录进行 Chrome/Edge 双目标构建。初始递归清理命令被自动审批拦截，改为将既有构建目录移动到独立临时备份保留；没有删除旧产物。shared 先构建成功，插件两轮构建均包含依赖许可。迁移前后包级测试均 42/42、集成均 6/6；迁移后 lint/typecheck/格式检查通过。逐文件字节检查证明 8 个模块除 recording-content 的两处跨目录导入外完全一致；适配器只变 hash 导入；旧目录及旧源码导入引用已消除。新旧 SHA 导出为同一函数对象，并与 Node SHA-256 的空输入、abc、确定性 4096 字节输入摘要一致；两目标 manifest/identity/许可清单语义完全相同。

基线日志：系统临时目录 `octopus-recording-move-before-build.log`、`octopus-recording-move-before-unit.log`、`octopus-recording-move-before-integration.log`；迁移后为对应 `octopus-recording-move-after-build.log`、`octopus-recording-move-after-unit.log`、`octopus-recording-move-after-integration.log`、`octopus-recording-move-after-types.log`。原产物与基线产物保留在 `octopus-recording-move-ffb0717b-9201-4fbf-a5cf-1b9eb9efe7be`，源码对照为 `octopus-recording-move-source-baseline.json`。原有配额诱发受阻与 Chrome Freeze blocked 等专项限制仍按下表报告，不因结构迁移的回归通过而提升验收状态。

2026-10-28，会话替换与在途批次专项：新增生产 RecordingContent 的受控传输回包测试，先复现旧 stop 成功会清除新浮条、旧 pause 成功会恢复旧会话、旧控制失败会污染新错误状态三个缺陷。现对控制回包/缺口失败补充 sessionId + generation 校验，hello 增加请求修订号拒绝旧回复；无生产者身份的终态通知先重新读取权威会话，不直接清除新 UI。8 项内容运行时专项覆盖这些迟到分支、丢失 ACK 后逐字相同批次重试和匹配 ACK 后清队列、旧批次完成不消费新会话事件。页面数据和录制协议未因此放宽。

DOMRecorder 在活动录制期间通过捕获 frame load 事件报告新加载 iframe 的不支持范围，不进入 frame 文档，也不新增 MutationObserver。Chrome/Edge 真实测试在开始录制后动态插入带嵌套 iframe 的页面，确认初始无 frame 缺口、插入后出现缺口、外层和嵌套 frame 内按钮均不进入事件记录。

真实在途写盘测试以隔离管理页的有限只读事务阻挡生产写事务，只在测试 Worker 中观察待提交事件 ID；确认 add 已被调用后停止该 Worker 版本。浏览器在快速重启时可保留/复用 target，测试原先等待 target 消失失败；诊断确认旧 evaluate 返回 `Service worker restarted`，改为验证旧执行上下文不可执行，并额外断言 5 秒写盘门闩在该时刻尚未过期，随后才解除。最终 Chrome/Edge 均以原事件 ID 恢复提交且仅一份。该测试修改仅存在于测试实例，未添加产品故障入口；它证明指定在途事务退出路径，不代表所有任意中断时序都已穷举。

本轮双目标构建、lint/typecheck、包级测试 50/50、录制集成 2/2 通过；原连接 Popup 与生命周期复验另有 4/4 通过（合计 6 项集成），日志 `octopus-recording-race-other-regressions.log`，生命周期证据为 `octopus-recorder-lifecycle-wxVQq2` / `octopus-recorder-lifecycle-WNFjOj`。录制证据：系统临时目录 `octopus-recorder-tT3o4M/evidence`、`octopus-recorder-6WsGyt/evidence`，日志 `octopus-recording-race-gate-proof.log`；首轮失败与诊断保留为 `octopus-recording-race-integration.log`、`octopus-recording-race-targeted.log`、`octopus-recording-race-probe.log`、`octopus-recording-race-context*.log`。原生配额 blocked、Chrome Freeze blocked 和其他未验证范围不因本轮通过而改变。原共享 ScrollArea 的未使用 React 导入再次出现在工作区，按此前针对同一行的明确授权重新移除，其他共享源码不改。未读取模型密钥文件或调用提供商。

2026-10-28，工具栏边界布局修复：Chrome/Edge 隔离页面先复现拖到右侧后浮层收窄、收起按钮换行；浮层改用内容固有宽度，并在自身尺寸或窗口尺寸改变时重新限制位置，拖动边界排除页面滚动条。保持已批准的展开/收起/暂停样式。600×600 视口左右边缘拖动、靠右收起后展开及缩至 520×600 的同行/宽度/可见性断言通过，截图人工复核通过。双目标构建、lint/typecheck、包级测试 50/50、录制集成 2/2 通过。证据在系统临时目录 `octopus-recorder-R5PEko/evidence`（Chrome）、`octopus-recorder-yJ0bDn/evidence`（Edge）；日志 `octopus-toolbar-after.log`。修复前失败日志 `octopus-toolbar-before.log` 及 `octopus-recorder-x8vp0K/evidence`、`octopus-recorder-jFWtFj/evidence` 保留。本次未实现工作流整理或重放，也不扩大其他验收结论。

2026-10-28，第一阶段补齐真实 Executor 互斥回归：`test/integration/browser-bridge.test.mjs` 通过生产 Native Host、Utility Runtime 和 MCP 调用，分别验证正式 Chrome 155.0.8059.85、Edge 156.0.4314.50。录制中和暂停时，带截图/纯 DOM 的快照及新建标签页均返回 BROWSER_BUSY，不返回图片、不改变活动标签或增加页面；browser_tabs 仍可读取。停止录制后真实截图和页面操作恢复；自动化已观察并持有页面时开始录制被拒绝，且不创建空记录。此处验证确定的先后顺序，不宣称同时启动竞态或任意未知在途结果已经穷举。

本轮未修改录制业务逻辑。测试装配更新：Electron 启动只移除测试子进程的 ELECTRON_RUN_AS_NODE；按权威 Runtime 状态等待就绪；通过当前设置页明确选择全部工具策略，不再假定默认只读策略包含操作工具；Edge 先验证导航清除遮罩，再等待关闭事件，不在关闭后的页面查询 DOM。原有连接恢复、页面操作、Worker 重启和扩展重启断言继续通过。

验证：shared、扩展双目标及许可、Executor 构建通过；Executor lint/typecheck、扩展包级测试 50/50、Browser Native/MCP 测试 8/8、完整双浏览器桥接集成 1/1 通过。最初缺失固定 Node 归档和搜索工具资源，分别通过已有 assemble:node / assemble:search 命令补齐；启动环境、旧 UI 定位、默认工具策略和关闭页面查询的首次失败保留，未扩大时限或放宽业务断言。证据归于 Executor 本地 browser-recording 批次 `20261028-144048-12297578`，遵循应用 AGENTS.md 的材料规则。使用隔离数据/Profile、唯一测试 Host 和合成页面，不改正式注册；未读取提供商密钥、未调用模型，未开始第二阶段。

2026-10-28，第一阶段并发与标签页边界收束：基于其他会话已暂存的工作区继续增量修改，未覆盖暂存内容。新增受控回归先复现移窗/跨站生命周期通知尚未处理时，旧 sender 的批次仍被接受。RecordingService 现在在分发时按当前 Tab 的窗口与站点核对已纳入范围，并触发失效成员复核；批次排队后再次核对范围，hello 也检查真实 Tab 当前归属，拒绝范围外页面。此修复不扩大跨窗口录制能力。

受控回归覆盖：20 个同时开始请求仅建立一个会话；Bridge 在 Tab 查询期间取得所有权时拒绝录制；停止 flush 期间保持互斥；20 次相同的 100 事件尾批次只提交 100 个唯一事件；排队期间移窗拒绝写入；替换旧 Tab 后保持其他参与页、不自动登记新 Tab。真实 Chrome/Edge 验证移窗后移回、HTTP 302 跳转范围外站点后返回，均中断并移除浮条，返回后的点击不增加记录、不自动续录。标签替换为受控通知测试，未宣称触发浏览器原生 onReplaced；并发测试为指定交错和有限负载，不代表长时间压力验收。

验收结果：扩展双目标构建及许可、lint/typecheck、包级测试 56/56 通过；双浏览器录制 2/2、实际 action Popup 2/2、生命周期 2/2 通过。截图复核了浮条靠边、固定外框、短屏详情、深色列表与悬停；深色截图初次捕获主题过渡帧，增加主题生效及行文字颜色检查后复验正常。用户明确反馈已在日常浏览器完成物理中文输入法、暂停/继续/停止与详情检查，未发现异常；这是用户人工验收反馈，与自动化证据分别记录。

首次失败保留：一次包测试早于构建许可输出完成导致 inventory.json 缺失，构建完成后顺序复验通过；移窗后测试点击未激活页面超时，显式激活测试页后通过；Edge 首轮录制页加载超时在后续两轮未复现，根因尚未确定，不以重跑成功抹除该现象。最终录制截图/JSON 在系统临时目录 octopus-recorder-pjZ2Um/evidence 与 octopus-recorder-xx2W2t/evidence，日志 octopus-boundary-ui-final.log；其余构建/检查/首败日志使用 octopus-boundary- 前缀保留。未调用模型、未进入第二阶段。第一阶段主流程按开发验收通过收束，剩余环境受限专项、长时间压力和发行验收继续明确保留。

| 范围            | 已验证内容                                                                                                                               | 仍待验证 / 实施                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 原有桥接        | 连接、暂停/恢复、握手与来源校验；原有路由/截图/引用单测及双浏览器 Popup 回归                                                             | 真实模型端到端专项                                         |
| 独立录制        | Host 不在线、Popup 关闭、暂停/继续与保存；用户人工全流程验收无异常                                                                       | 企业策略与长期使用                                         |
| Tab 范围        | 真实关联新页、重载、最后 Tab 关闭；受控无关页拒绝与显式加入                                                                              | 原生标签替换、复杂重定向链；移窗/返回与单次跨站 302 已验证 |
| 页面采集        | 普通输入/点击、open shadow roots、iframe 排除；浏览器 IME 组合；真实 BFCache 命中及恢复后新输入提交；动态/嵌套 iframe 缺口提示与采集排除 | 用户物理中文输入验收无异常；跨域 frame 复杂交互专项仍待验  |
| 权限及冻结      | 双浏览器真实设置页撤回权限；双浏览器无网页调试器丢弃；Edge Freeze；恢复不自动加入                                                        | Chrome Freeze 受诊断页限制 blocked；自然解冻恢复路径       |
| 存储及限额      | 受控写盘失败、配置限额/重复批次；真实 IndexedDB 升级/分页/过期清理                                                                       | 浏览器真实 QuotaExceeded / 物理磁盘满                      |
| 停止与恢复      | 受控超时/重试/停止时关页；真实重载、正常重启及 Browser.crash 后证据保留不续录；Worker 回收后恢复；在途写事务中断后原事件 ID 仅提交一次   | 更广泛并发压力与任意中断时序                               |
| 页面操作互斥    | 受控在途拥有权；真实 Chrome/Edge + Executor 双向互斥、截图/焦点拒绝及停止后恢复                                                          | 指定开始/停止交错已验证；未知在途结果与长期并发压力仍待验  |
| UI 与记录管理   | 固定外框、ScrollArea、Empty、浅深色/短屏、列表反馈、分页/搜索/返回位置、重命名                                                           | 更多辅助技术与长时间使用验证                               |
| 模型与编译      | 契约/存储及模型设置、Host 编译、审阅发布主流程已接线；受控验证通过                                                                       | 多轮稳定性、删除/重排界面、导入导出                        |
| 本地重放 / Host | 尚未实施                                                                                                                                 | Agent Host、Page Agent、参数输入、确认、结果验证与恢复     |
| 发布            | 双目标构建/许可与隔离 Profile 回归                                                                                                       | 发布包、商店、签名/企业策略、干净机器验收                  |

第一阶段主流程已通过开发验收及用户人工体验验收，但上述剩余专项或发行门禁未完成。受控限额不等于真实磁盘满；Browser.crash 和正常关闭分别报告；浏览器合成 IME 不等于物理 OS 输入法。第二阶段进度见下节；第三阶段未开始。

## 第二阶段开发状态

2026-10-28，用户确认开始模型设置、整理为工作流和参数审阅阶段。首批新增扩展私有 src/lib/workflow 下的契约、录制证据投影、业务校验及 WorkflowRepository；首批验证仅覆盖独立底层，后续接线结果如下，重放仍属第三阶段。

- 契约约束动作、参数、逻辑 Tab、来源事件、依赖和成功条件；模型 JSON 不接受 reviewed 等审批字段，审阅记录单独由可信 UI 提供。来源不存在/动作不匹配、站点扩大、变量断链、依赖倒置、遗漏主要操作均阻止保存；缺口和推断需独立审阅才能发布。运行时最终业务成功仍需第三阶段验证，不能仅依据本轮静态校验。
- 输入投影仅接受已停止/中断且完整读取的事件范围，移除真实 Tab/documentId 与原输入值等运行信息，二次应用脱敏；超限明确失败、不截断。首批编译预算为 1,000 事件、投影 JSON 256 KiB，流程最多 200 步/50 参数，后续编译任务接线时提供明确超限反馈。
- 独立 IndexedDB octopus-workflows v1 / workflows 保存经过投影的来源证据与草稿，避免录制过期后来源完全失去。原子比较 revision 防止迟到写入覆盖；发布绑定特定 revision，编辑后重新成为草稿并清除审批。初始上限 100 个流程，每个记录 1 MiB；不写入密钥，不改录制数据库。
- 单测 5 项覆盖投影、残缺/活动会话拒绝、业务引用和审阅门禁；真实隔离 Chrome/Edge IndexedDB 集成 2/2 验证并发更新仅一方成功、审阅拒绝不改版本、旧版本拒绝、编辑撤销发布以及刷新后持久恢复。扩展双目标构建/许可、lint/typecheck、全包测试 61/61 通过。日志位于系统临时目录 octopus-phase2-*.log。
- 首批视觉稿归档与测试时尚未取得 v3 批准，也未调用模型；随后用户明确确认 v3 并授权继续。v3 现为 approved，v1/v2 及 model-settings-v1 对应范围为 superseded，原图与提示词保留，权威登记见 apps/browser-extension/DESIGN.md。

2026-10-28，获批页面与编译主流程已接线：连接仍为默认 Tab；录制详情新增整理入口，工作流 Tab 提供模型元数据设置、连接测试、编译状态、列表、来源查看、变量名联动编辑、成功条件编辑及显式发布。编译在注册的 agent-host.html 非活动 Tab 运行，Popup 关闭不终止；API Key 只短暂转交并在 Host 内存使用，不写入 storage/IndexedDB，不交给 Content。Host/文档身份、一次密钥领取、迟到结果和并发任务均由 SW 校验。Worker 重启、Host 关闭/丢弃和有限超时标记中断，不自动重试。连接测试最多 16 输出 token；编译最多 12,000 输出 token，60 秒中止，响应体 1 MiB 上限。取消不承诺撤回已发送请求或提供商费用。

固定 ai 7.0.155、@ai-sdk/openai-compatible 3.0.80；使用 JSON-object 模式并显式附带 JSON 指令和 Schema，之后执行 Zod 与业务校验，重复消费同一操作事件也会拒绝。首次构建因 provider-utils npm 缺 LICENSE 失败，已从对应上游标签获取原文，增加精确版本/摘要校验及 LF 检出属性，双目标随包提供 34 份生产依赖许可。没有修改第三方运行时代码或绕过许可检查。

受控双浏览器工作流测试覆盖生成草稿、变量改名与保存、发布、关闭 Popup 后任务继续、取消、401 错误不自动重试、直接关闭 Host，以及密钥不落盘；原生 IndexedDB 并发/审阅回归继续通过。首次 UI 测试因 Base UI 复选框和隐藏 input 重复匹配失败，改用可访问角色定位；新增 Host 关闭场景先复现退出页抢先上报 TIMEOUT，现让后台统一记录 interrupted。终态存储失败也不再报告 completed。原连接 Popup、录制和生命周期共 6 项回归通过。最终双目标构建与 34 份依赖许可、lint/typecheck、包级测试 68/68 通过；工作流与原生存储双浏览器集成 4/4 通过，原有功能集成 6/6 通过。最终工作流证据为系统临时目录 octopus-workflow-e2e-Wwvxom/evidence、octopus-workflow-e2e-j9JPXH/evidence，包含模型设置、审阅和列表截图；日志 octopus-phase2-host-fix-e2e.log、octopus-phase2-final-_.log。所有前序失败日志保留于同目录的 octopus-phase2-_。

真实提供商验证严格分开：经用户原有授权读取其本机凭据文件，按发现结果选择 qwen3.5-flash；只发送合成数据。一次真实连接测试通过，一次真实编译返回 API 调用错误；首轮未保留状态码/响应体，因此不能断言该错误的具体上游原因。之后发现并补齐 JSON-object 模式所需的显式 JSON 指令与 Schema，受控回归通过，但尚不能宣称真实编译已通过；用户随后明确允许额外一次合成编译复验，已启动同一模型的单次请求，未重复连接测试。执行工具起初返回运行中的会话，但后续读取返回 Unknown process id，未能取回最终响应，且该次脚本未将结果单独落盘；本次结果标为未确认，不认定成功或失败，不因再次收到同一确认而重复发起可能计费的请求。后续真实复验应在发起前配置脱敏结果落盘，避免仅依赖临时执行会话。密钥不输出、不入仓库。完整步骤结构编辑、参数类型/来源编辑、导入导出和智能重放尚未实施，本轮不宣称第二阶段全部验收完成。

2026-10-28 21:01–21:02（Asia/Shanghai），用户再次明确授权单次真实合成编译复验。新增手动探针 test/integration/workflow-provider-probe.mjs，先创建 result.json，再执行模型发现及至多一次编译，各阶段原子落盘；不纳入自动测试，不记录密钥或原始提供商响应。qwen3.5-flash 模型发现 HTTP 200；生产 compileWorkflow 在原有 60 秒预算内未完成，返回 TimeoutError，复验失败且未自动重试，也未放宽超时。脱敏结果和日志保存于 Executor 本地 workflow-provider 批次 20261028-210020-67864ca8；result.json 已包含终态、源码摘要及单次请求计数。该结果只证明本次编译超时，不能推断提供商最终处理状态或费用，也不能证明编译通过。探针 ESLint/格式检查通过；生产代码未改，未重复运行无关业务测试。

2026-10-28，针对真实编译超时继续本地排查：核对锁定 AI SDK 适配器，确认自定义 providerOptions 会进入兼容请求体。当前仅对精确模型名 qwen3.5-flash 显式发送 enable_thinking=false，其他模型不附加该参数；保持 JSON-object + 显式 Schema、60 秒预算、12,000 输出 token 上限和零自动重试。上游 Qwen 深度思考文档说明此模型默认开启思考，但本次未再次调用真实模型，不能将配置调整直接判定为超时根因已解决。

手动付费探针新增不含正文/凭据的传输跟踪：请求字节数、JSON 模式/思考开关、收到响应头的耗时与 HTTP 状态、首字节、响应体完成/失败与字节数；区分请求前半段和响应体阶段故障，并将 TimeoutError/AbortError 标为 TIMEOUT。各阶段仍原子写入 result.json。3 项无网络单测验证脱敏、分阶段失败、取消及背压；双浏览器受控集成确认 Qwen 请求关闭思考、其他模型请求不带该字段。shared/扩展双目标构建与许可、lint/typecheck、包级测试 71/71、工作流与存储集成 4/4 通过。日志为系统临时目录 octopus-thinking-*.log，截图/结果为 octopus-workflow-e2e-28jwHS/evidence 和 octopus-workflow-e2e-2pmkRN/evidence。未增加新的付费请求，真实提供商编译状态仍待验证。

2026-10-28 21:44（Asia/Shanghai），用户明确授权修正后的单次真实合成复验。qwen3.5-flash 模型发现 HTTP 200；落盘诊断确认请求为 JSON-object、enable_thinking=false、非流式，6,190 字节，输出上限仍为 12,000 token。7,405 ms 收到 HTTP 200 响应头，7,408 ms 收到首字节，7,411 ms 接收完 2,385 字节响应体；本次没有超时。随后 AI SDK 返回 AI_NoObjectGeneratedError，探针记为 OUTPUT_SCHEMA，未产生通过校验的工作流草稿，真实编译仍未验收通过。只能确认本次传输完成，不能据一次结果认定先前超时的唯一根因已证明；具体 JSON/字段差异尚未记录。未自动重试。证据位于 Executor 本地 workflow-provider 批次 20261028-214441-5de85280 的 result.json/probe.log，包含源码摘要、单次请求计数和分阶段耗时，不含密钥、请求正文或响应正文。下一步优先补充不含字段值的结构化校验诊断并排查输出契约，不直接增加超时或更换框架。

2026-10-28 22:16（Asia/Shanghai），继续排查结构化输出：新增 workflowFailureDiagnostic，按实际 SDK 错误链区分 JSON 解析、Schema 校验和业务来源校验；仅投影最多 20 条错误码、Schema 白名单字段路径、数组下标、预期/实际类型与 finishReason/输出字节数，不保留字段值、未知键、原始正文、头或凭据。Host 现在将 SDK 结构化失败归类为 INVALID_OUTPUT，不误报为连接失败。4 项无网络诊断测试覆盖 JSON 截断、缺失字段/错误类型/枚举、未知键脱敏、诊断限额与业务来源失败；双浏览器受控测试补充 Schema 不合法时不创建/覆盖草稿、不自动修复重试。双目标构建/许可、lint/typecheck、75 项包级测试、4 项工作流/存储集成全部通过，日志为系统临时目录 octopus-schema-*.log。

在用户要求继续排查后，已先说明范围并进行一次相同两条合成事件的真实定向复验，没有重复连接测试或自动重试。qwen3.5-flash 模型发现 HTTP 200；7,034 ms 收到 HTTP 200 响应头，7,041 ms 接收完 2,233 字节响应，生产编译模块成功返回通过 Schema 和业务校验的草稿：2 步、1 个字符串参数 orderNumber、2 个源事件引用。证据为 Executor 本地 workflow-provider 批次 20261028-221647-b5493b2d，result.json 已保存终态和源码摘要。该轮只增加诊断与错误分类，未放宽 Schema、未改变提示词、未自动补字段；原始上次响应未保存，故不能反推上次具体字段问题或声称稳定性已证明。这是生产编译函数经 Node 测试进程访问真实提供商的最小样例通过；浏览器 Host 的端到端仍以受控提供商验证分别报告，复杂跨页、多轮稳定性和完整第二阶段验收仍待完成。

2026-10-29，第二阶段三标签页来源验证发现并修复：原校验允许同站点未录制起始路径、创建步骤指向其他页面、子页创建前被使用、同页 DOM 操作倒序，以及步骤输出仅凭数组先后而缺少真正依赖路径。现按记录证据绑定起始 URL 与创建步骤所属逻辑 Tab，拒绝关闭后的页面继续操作，并校验步骤输出的传递依赖。保留 DOM/Browser 来源和已有 causationId；只约束每页 DOM 子序列，不把所有事件的入库 seq 当作执行时间。起始 URL 在投影时按本地采集时间确定，不将绝对活动时间发送给模型；新增回归证明先入库的导航不会替换较早采集的起始页。缺少当前来源信息的旧草稿在保存/发布校验时拒绝，需从保留的原始录制重新整理，不自动猜测、重置或删除用户数据。

新增确定性跨页夹具覆盖 3 个逻辑 Tab、2 个允许站点、7 条操作和2个参数，9 项专项包含 42 种浏览器通知/DOM 入库交错的合法性检查。真实 Chrome/Edge 录制流程扩展到三页，受控提供商完整经过脱敏、Host 编译、两个参数、改名、审阅发布、取消、失败和 Host 关闭，2 条开页事实与因果关联传入编译器，两个输入原值均排除。首轮三页测试在后台业务页发点击时，Chrome 将新 Tab 的 openerTabId 记为仍处于前台的扩展管理页，录制器正确拒绝；保留诊断后，测试改为先激活真实操作页再点击，未放宽范围判断或时限。最终双目标构建/许可、lint/typecheck、包级测试 84/84、工作流/原生存储集成 4/4 通过。日志：系统临时目录 octopus-cross-tab-*.log；最终截图/JSON：octopus-workflow-e2e-e1oX9L/evidence、octopus-workflow-e2e-Karjqx/evidence；最初断言失败和错误 opener 诊断分别保留在 before/diagnostic 日志。

真实模型只追加一次合成跨页请求：qwen3.5-flash 返回 HTTP 200，15,539 ms 收到响应头，15,548 ms 完整收到 5,258 字节，生成 7 步、3 个 Tab（2 个派生页）、2 个字符串参数和 7 个源事件引用，通过当时的 Schema 与业务校验，无自动重试。证据为 Executor 本地 workflow-provider 批次 20261029-070855-d53c2dcd，按源码摘要保留。此请求发生在本轮最后的起始 URL 采集时间投影细化之前；最终该细化已通过本地与双浏览器受控回归，未再追加付费调用。本次不是多轮随机稳定性证明，也不是实际业务网站或智能重放验收。

2026-10-29，步骤/参数编辑细化：找回上一轮中断后已生成的四屏图，归档 [workflow-editor-board-v1.png](../design/browser-extension-recorder/history-manifest.md#docs-design-browser-extension-recorder-workflow-editor-board-v1-png) 与完整提示词，没有重复生成。新稿在 apps/browser-extension/DESIGN.md 登记为 pending review；现有 phase2 v3 的已批准范围不变，新编辑页面尚未接入。

独立底层新增 workflow-editing.ts：对显式的一组参数/步骤修改进行脱离原对象的整体校验，全部通过才返回新工作副本；参数改名同步步骤与成功条件引用，usedBy 从真实步骤绑定派生。协调改绑后可删除参数；已录制步骤不可直接删除，未被引用的推断建议可删除；重排仍受 DOM 顺序、Tab 创建/关闭和依赖规则约束；来源 ID、动作、Tab 及推断来源不可通过编辑配置改写。保存/发布仍需经过现有 Worker 权限与 Repository revision 校验，该辅助模块不新增外部命令。

9 项编辑专项覆盖原子失败不改原稿、变量/断言改名、重名/选择项/敏感来源错误、删除与改绑、不可改写来源或撤销强制确认、依赖破坏、推断建议删除与独立重排，以及步骤输出绑定需要显式依赖。shared 与扩展双目标构建/许可、包级测试 93/93、lint/typecheck 和格式检查通过；首轮 lint 的两个未使用解构绑定已改为显式复制后删除字段，未修改规则。日志保留于系统临时目录 octopus-editing-_.log、octopus-workflow-editing-_.log。本轮没有调用真实提供商，未宣称新 UI 或完整编辑功能已完成；需要先批准对应视觉范围再接入。

2026-10-29，用户确认 workflow-editor-board-v1 后，步骤/参数编辑子页已接入。按用户指定的 shadcn/TanStack Form 方案，使用仓库已有 @tanstack/react-form 1.33.5，将模型设置、工作流审阅、步骤及参数编辑统一为 useForm/form.Field/订阅状态，保留 Zod 与领域校验，不额外引入适配器。使用规范已写入插件 AGENTS.md。参数支持显示名称/变量名、类型、选择项、必填/敏感标记和来源；选择前序输出时显式补齐消费者依赖。步骤支持目标说明、语义定位、参数绑定、依赖及已有输出键，动作/页面/证据只读，必要确认不可关闭。

子页应用只改变工作副本，主页面保存才增加 revision；取消/返回对未应用或未保存修改分别确认。顶部 Tab 切换保留工作副本，新录制整理意图不会静默替换已打开的工作流。保存后清除旧审阅，前序输出绑定不会自动批准模型建议。关闭 Popup 后仅已保存内容可恢复，没有宣称未保存编辑可跨 Popup 生命周期恢复。删除/重排界面、导入导出及重放未在本轮接入。

本轮复现并修复旧 URL 自定义 refine 对空字符串/未输入完整地址抛出 TypeError 的问题，现返回校验失败；输入元数据和工作流 URL 两处均修复，防止即时校验中断。未放宽 HTTPS/来源限制。双目标构建含 40 份生产依赖许可，包级测试 96/96、lint/typecheck、工作流/原生存储双浏览器集成 4/4 及原连接/录制/生命周期回归 6/6 通过。新增表单转换单测覆盖 UI-only 字段不入库、隐藏配置清理和来源依赖联动。界面验证覆盖重名、空选项、敏感来源限制、未保存放弃、Tab 切换保留、应用不落盘、显式保存、版本/引用/审阅状态、前序输出选择、浅深色与 420px 短屏。所有测试仅调用本地受控提供商，没有读取真实密钥或新增真实模型请求。

最终工作流截图/JSON 为系统临时目录 octopus-workflow-e2e-fQmXug/evidence 与 octopus-workflow-e2e-XG6kVe/evidence；确认无未捕获页面异常或非预期 error 级控制台日志（测试故意触发的 401 与取消请求单独排除）。原始第一轮测试把 ScrollArea 根节点误作 region 定位，修正为实际可访问名称后原断言通过；未修改共享 ScrollArea、未扩大时限。滚动条几何检查确认其底部不越过正文、不覆盖操作按钮，外层 scrollY 为 0。失败日志 octopus-tanstack-editor-e2e.log 与 URL 复现 octopus-form-url-before.log 保留；最终日志为 octopus-editor-console-e2e.log、octopus-editor-accepted-_.log 及 octopus-editor-_-regression.log。

2026-10-29，完成真实提供商经生产浏览器 Host 的单次端到端验证。用户授权范围为 Chrome/Edge 各至多一次合成编译，首个失败即停止；实际两次均通过，没有自动重试。测试使用各自独立 Profile、扩展副本、未注册测试 Native Host 和自有合成订单页。模型发现 HTTP 200，qwen3.5-flash 编译均 HTTP 200；Chrome 156.0.8078.48 生成 2 步/1 参数/2 个源引用，Edge 156.0.4314.50 生成 3 步/1 参数/3 个源引用（含录制到的滚动）。两份草稿均通过生产 Schema 与来源业务校验。

真实链路覆盖录制、模型设置、Popup → Worker → Agent Host → 提供商、编译期间关闭/重开 Popup、任务完成、草稿改名保存增加 revision、显式审阅发布及 Host 释放；检查录制输入原值未进入草稿，密钥未出现在检查的 storage.local 和工作流记录中。已复核两浏览器发布态截图，固定标题/Tab/导航及正文滚动区域保持既有布局。该验证中的 Popup 由隔离扩展页面驱动，不替代此前真实 action 弹窗尺寸验收，也不代表物理鼠标/键盘人工验收。

证据位于 apps/executor/build/validation-evidence/workflow-live-host/20261029-125720-796cb6d0：chrome/result.json、edge/result.json 各保存单次请求数、浏览器版本、background SHA-256 和终态；对应 published.png 与浏览器日志一并保留，不保存密钥或原始提供商响应。手动入口 workflow-live-browser-probe.mjs 已通过格式/ESLint 检查；本轮重新构建 shared 和扩展双目标成功，生产实现未改，既有 96 项包级与 10 项受控浏览器集成结果按前述范围保留。前序真实调用失败证据不删除。本轮只证明两浏览器各一次最小真实链路成功，不证明多轮模型稳定性。第二阶段步骤/参数编辑的用户人工体验验收仍待反馈；删除/重排界面、导入导出和第三阶段重放尚未接入。

2026-10-29，按用户要求，模型服务地址统一接受 HTTP/HTTPS，不再将 HTTP 限于 localhost；Popup 字段、Worker 设置保存和任务启动共用同一 Schema。继续拒绝非法 URL、其他协议、URL 内嵌用户名/密码、查询参数及片段。提示和安装说明同步更新，布局不变。新增地址边界回归，并将旧的“拒绝远程 HTTP”测试改为验证远程/局域网 HTTP 可保存且可读回；首轮旧断言失败日志 octopus-http-tests.log 保留，最终 97/97 通过（octopus-http-tests-final.log）。shared/扩展双目标构建、lint/typecheck 通过。本轮未调用真实提供商，不扩大此前端到端或人工验收范围。

2026-10-29，用户批准 model-settings-model-list-v2 后，模型设置接入可搜索、可手动输入的共享 Combobox 和 default「拉取」按钮，API Key 调整到模型字段之前。元数据请求仅在显式点击时访问当前 base URL 下的 /models，绑定设置页生命周期；切换地址/密钥或卸载会取消，旧回包不覆盖新配置，不创建编译 Host，不持久保存候选或密钥。请求 15 秒超时、最多 1 MiB/2,000 个模型、不重试、不跟随重定向、不带 Cookie；只投影校验后的模型 ID。失败保留输入、允许重试或手填，首次进入不显示未触碰字段的错误。Enter 仅选择候选或保留手填值，不隐式提交模型任务。

本轮真实浏览器回归先发现 Combobox 失焦会清空未列入候选的手填值，已改为由表单统一持有输入与选择值，并保留同场景回归。短窗口下 scrollIntoView 可移动用于 action 初始尺寸计算的 600px 文档；仅设置 overflow: clip 不能解决，固定 body 又导致真实 action 高度回归。最终保持原 body 尺寸与样式，仅固定 ExtensionPopup 外框到视口：短窗口测试验证外框 top=0、品牌栏 top=16 和 footer 可见，而非把不可见文档的 scrollY 当作 UI 坐标。两浏览器真实 action 仍为 360×600。共享 UI 源码未修改。

最终 shared/Chrome/Edge 构建含 40 份许可，lint/typecheck、100 项包级测试通过；工作流/原生存储集成 4/4、真实 action/连接页回归 2/2 通过。新增交互覆盖搜索过滤、鼠标/键盘选择、手填/失焦、空列表、401 失败、显式重试、加载防重入、地址切换取消与旧回包隔离，以及浅深色和 420px 短窗口；截图复核确认浮层不撑开外框。测试均为本地合成服务，不读取真实提供商凭据、不增加真实模型请求。此前第二阶段人工编辑验收仍为待验收。

日志位于系统临时目录 octopus-model-list-accepted.log、octopus-model-list-final-unit.log、octopus-model-list-final-lint.log、octopus-model-list-final-types.log、octopus-model-list-final-popup.log 和 octopus-model-list-build6.log；accepted 日志列出各浏览器独立 evidence 路径，含 model-list-search.png、model-list-search-dark.png、model-list-failure.png、model-list-short.png 与终态 result.json。前序 e2e、visual、short-diagnostic、short-layout、popup-fixed 等失败日志按原名保留。模型列表首稿已 superseded，v2 为 approved；phase2 v3 的模型设置区域由 v2 替代，其编译/列表范围仍按 DESIGN.md 保留。

2026-10-29，按用户要求完成顶部 Alert toast、独立连接测试及本机密钥保存。连接测试现在由设置页专用 Port 请求后台 ModelSettingsService，使用一次最小模型请求验证真实文本响应；不创建编译 Host、不读取录制、不写 workflowJob、不跳转或自动保存配置。成功/失败在导航下方悬浮显示，表单位置不变；配置变化、顶部 Tab 离开、返回或关闭 Popup 取消所属请求，迟到结果不改新状态。30 秒超时与不自动重试有独立回归。编译继续使用已注册 Agent Host；传输配置抽取为 model-provider.ts 与探针共用，原结构化编译契约未放宽。

用户显式保存配置时，ModelSettingsRepository 将密钥独立保存在本机 local 区的 workflowCredentials；写入前限制为 TRUSTED_CONTEXTS，按规范化协议/域名/端口/base path 绑定，不同步、不进入工作流/日志。当前输入优先于已存密钥，测试输入不自动替换存储；重新进入只显示已保存、更换和清除，不回填明文。保存/清除写入串行，持久化失败保留旧值。真实扩展内容脚本通过 chrome.scripting 的 ISOLATED 执行上下文尝试读取凭据区被拒绝，Popup 的非秘密存储与工作流不含该合成密钥。

验证：shared 和扩展双目标构建含 40 份许可通过，lint/typecheck、107 项包级测试通过；模型设置、录制编译/编辑/发布与原生存储双浏览器集成 6/6 通过。其后在最终设置实现上增加 Chrome/Edge 正常关闭再启动同一隔离 Profile 验证，2/2 通过：重入显示已保存，无需重新输入即可发起使用原密钥的模型测试，随后明确清除成功；这是正常重启，不是崩溃恢复。原连接/action Popup 回归 2/2 通过，真实尺寸仍为 360×600。已复核深色成功/失败、浅色失败/已保存和 420px 短窗口截图；无未捕获页面错误或非预期控制台错误。所有请求均访问本地合成服务，没有读取真实账户文件或增加真实提供商请求；第二阶段用户人工体验验收仍未完成。

原首轮包级失败源于 Native Bridge 测试替身缺少新增 onConnect 事件，补齐替身后原断言通过。首次将新增设置流程合入长录制场景后，两浏览器触发既有 120 秒测试总预算；随后把设置验收拆为独立场景，保持原业务等待与测试总时限，6 项全部通过，没有放宽产品超时。原始日志 octopus-model-feedback-unit.log、octopus-model-feedback-e2e.log 保留。最终日志为系统临时目录 octopus-model-feedback-unit-final.log、octopus-model-feedback-split-e2e.log、octopus-model-feedback-restart.log、octopus-model-feedback-popup.log、octopus-model-feedback-lint-final.log、octopus-model-feedback-types-final.log 和 octopus-model-feedback-build3.log。最终设置/重启截图及 JSON：octopus-model-settings-IZo245/evidence（Chrome）、octopus-model-settings-yRzdYs/evidence（Edge）；编译/编辑证据：octopus-workflow-e2e-TiTTUD/evidence、octopus-workflow-e2e-46BBzZ/evidence。视觉目标为 model-settings-connection-feedback-v3，前两稿已 superseded，原图与提示词均保留。

2026-10-29，补齐 API Key 输入/更换态的显示/隐藏交互。新增功能内 ModelKeyInput，组合共享 InputGroup/InputGroupInput 与眼睛按钮，表单继续独占字段值；默认隐藏，切换不提交、不保存、不请求模型，鼠标切换保留焦点及 selectionStart，键盘 Enter/空格可操作。endpoint 改变或离开设置页后恢复隐藏；已保存状态不读取或回填原密钥明文。共享组件源码、后台密钥存储与请求协议均未改。

shared 与扩展双目标构建/40 份许可、lint/typecheck、107 项包级测试通过；Chrome/Edge 设置集成 2/2 通过，新增验证显隐值不变、光标保留、无隐式保存或模型请求、Tab/接口变化恢复隐藏、更换态默认隐藏，原保存/测试/重启复用与清除流程继续通过。已复核合成密钥明文态与隐藏态截图，无新页面或控制台异常。日志：系统临时目录 octopus-key-visibility-*.log；截图/JSON：octopus-model-settings-x0MYug/evidence（Chrome）、octopus-model-settings-F3txRk/evidence（Edge）。未调用真实提供商，未扩大第二阶段人工验收状态。

2026-10-29，按用户确认的方案完成公共 Box/全宽 ScrollArea 和标题栏整理任务入口。ExtensionPopup 外壳移除 padding，品牌、Tab、导航、正文和 footer 分别使用应用级 Box；正文 Box 位于满宽 ScrollArea 内，取消旧 pr-3，默认左右内边距 16px。连接、录制首页/列表/详情、工作流及设置/编辑页共用该结构，固定导航/底栏、滚动恢复和顶部 Toast 保持。没有修改共享 UI 源组件或引入全局状态库。

最近整理入口由正文整行按钮移到工作流标题栏、设置图标之前：进行中显示 spinner/整理中，终态为图标和可访问 Tooltip，失败/中断带状态点。仅带 recordingId 的整理任务可见；旧连接测试记录被 UI 排除但不删除，不新增任务历史或重放功能。已有查看进度、取消及进入草稿行为保留。

shared/扩展双目标构建含 40 份许可、lint/typecheck、107 项包级测试通过。Chrome/Edge 设置、真实 action/连接、录制/分页、工作流存储及编译/编辑集成共 10/10 通过。新增几何断言确认滚动视口 x=0、right=360、内部 padding=16px、外壳 padding=0，溢出滚动条位于最右侧；聚焦表单四边有至少 3px 可见空间。实测长内容滚动时品牌/Tab/导航/footer 不移动，短窗口与返回滚动恢复仍正常，真实 action 保持 360×600。使用真实存储中的旧连接测试夹具验证标题栏不出现任务按钮；已完成、进行中及中断的整理按钮均位于导航内并能进入对应任务。已复核焦点外框、录制长列表、旧任务隐藏空态及整理状态截图。

视觉稿 popup-box-task-toolbar-v2 按用户确认并要求开始开发的具体方案归档为 approved；首稿错误的滚动条范围已修正，原图保留并标记 superseded，旧录制外框稿对应范围同步标记替代。日志为系统临时目录 octopus-box-task-build.log、octopus-box-task-e2e.log、octopus-box-task-unit.log、octopus-box-task-lint.log、octopus-box-task-types.log；截图/JSON：设置 octopus-model-settings-8lQicf / icRCqY，录制 octopus-recorder-gHDBqq / v93GCS，工作流 octopus-workflow-e2e-n9HmPK / fQK6xw，均在各自 evidence 子目录。连接页证据为 octopus-connection-footer-chrome-bsPNSn 和 octopus-connection-footer-edge-jIMtVH。全部使用隔离 Profile 与合成服务，没有新增真实模型调用；用户人工验收和发行门禁未因此提升。

2026-10-29，按用户确认完成一键整理入口：点击录制详情的整理动作后，只读取本地配置/发送授权，配置齐全且已授权即进入编译；不预先调用连接测试。未配置进入设置并保留 recordingId。首次向当前 endpoint 发送时用现有 Dialog 展示配置快照，取消不发送，确认后后台记住脱敏契约版本 1 的授权；设置中可取消勾选并保存撤销，后续开始仍由 Worker 重新核对。开始任务不再隐式覆盖保存配置，授权落盘失败不创建 Host。配置改变、授权撤销和旧预检结果均不能绕过后台准入。

编译 Host 的错误分类现与连接探针共用安全投影：鉴权、接口/模型不存在和请求配置错误进入设置，保存并重试沿用同一录制；网络/限流/超时保留任务页并提供显式重试，输出校验失败也不跳设置。自动配置修复只处理用户正在查看的失败任务，每个任务不循环跳转、不抢占其它编辑页。任务保留可选的本地录制名称。重试重新读取配置及授权，不自动重试。UI 保留 Box、固定导航/底栏和顶部反馈，视觉范围以 workflow-direct-compile-v2 为准，未正确表达密钥状态的首稿已 superseded。

shared/扩展双目标构建及 40 份许可、lint/typecheck、110 项包级测试通过。新增 Chrome/Edge 一键整理专项 2/2 通过：未配置无请求；首次授权取消无请求；授权后重复入口直接编译；401 自动配置修复后继续相同录制；503 原页显式重试；无效输出留页；设置撤销和改 base path 后再次确认。每个浏览器恰好 7 次本地合成编译，无连接探针、自动重试或原输入值泄漏。已复核首次确认、直接整理、鉴权修复和临时失败截图。

原有设置/存储/编译编辑六场景首轮为 5 项通过、Edge 长编辑场景触发 120 秒测试总时限；原输出保留，未把它记作整轮通过。新增阶段耗时记录后，Edge 在原时限下独立复验通过（约 109.8 秒），未修改产品等待预算或放宽断言，首轮超时的唯一原因未确定。原失败日志 octopus-direct-regression.log、复验 octopus-direct-edge-recheck.log；其它日志为系统临时目录 octopus-direct-entry-e2e.log、octopus-direct-unit.log、octopus-direct-lint.log、octopus-direct-types.log、octopus-direct-build.log。新流程截图/JSON：octopus-workflow-entry-OuVEMG/evidence（Chrome）、octopus-workflow-entry-kJ7rXs/evidence（Edge）；原编译/编辑通过证据：octopus-workflow-e2e-bZiCqV/evidence 与复验 octopus-workflow-e2e-39oeVS/evidence。本轮没有调用真实提供商，没有提升第二阶段人工验收或发行门禁。

2026-10-30，修复校验诊断在 Host 边界丢失的问题：workflowFailureDiagnostic 原本已提取有限信息，但 Host 只发送 INVALID_OUTPUT；现在传递并严格校验诊断 envelope，随失败任务保存，任务页可折叠查看 JSON/结构/来源依赖阶段、具体字段路径、要求/实际类型和输出结束信息，并复制安全诊断。动态参数/页面/事件标识转换为数组位置，未知字段、原始值、SDK 正文/头和密钥不能进入协议或剪贴板。旧任务未保存的信息明确显示不可恢复。Repository 的来源复核失败也携带诊断，存储/容量失败不再一律标作 INVALID_OUTPUT。

按用户要求增加「检查并修复旧录制」：仅对当前失败任务关联的终态记录操作，完整读取后识别整批缺少 source 的已知旧格式，依据生产者事件分工补齐来源；混合/未知来源、unsupported、未知字段、缺失/重复/乱序或未知页面不自动修复。修复在单一 IndexedDB 事务内生成副本，不覆盖原录制、事实、时序或缺口；既有匹配副本复用，不匹配拒绝。失败任务保留原诊断并关联副本，修复操作不调用模型，只有点击「整理修复副本」才再次整理。录制删除确认行已改为右对齐，取消左、确认删除右。

shared/扩展 Chrome/Edge 双目标构建及 40 份许可、lint/typecheck、115 项包级测试通过。扩展双浏览器一键整理/诊断/修复专项 2/2 通过：schema 失败显示 steps[0].target.label、要求 string/实际 null；诊断复制不含输入、密钥或 endpoint；正常录制检查不改写；完整旧格式夹具出现 WORKFLOW_EVIDENCE_INCOMPLETE；另有录制进行时拒绝新建副本，停止后修复成功，原记录逐项不变，副本只补齐来源并改所属 sessionId；重复操作返回同一副本，修复阶段模型请求计数不变；明确整理副本后通过编译。删除按钮几何断言验证操作组右对齐及取消在左。复制使用测试页受控剪贴板适配，未操作用户 OS 剪贴板。

初轮开发检查发现新增诊断枚举与 SDK FinishReason 类型不一致、重复数组类型分支及测试中的未使用绑定，均已修正，原日志保留。最终日志为系统临时目录 octopus-repair-final-build.log、octopus-repair-final-e2e.log、octopus-repair-unit.log、octopus-repair-lint.log、octopus-repair-types.log；运行截图和 JSON：octopus-workflow-entry-H9Pqun/evidence（Chrome）、octopus-workflow-entry-u9OSZN/evidence（Edge），含 validation-details.png、legacy-repair-copy.png、delete-confirmation-right.png。未读取或修改用户日常浏览器记录，未调用真实提供商；当前用户截图中那次失败的根因仍须新诊断确认，不能因合成旧格式测试通过就认定它必然是旧数据问题。

2026-10-30，按用户反馈局部调整整理任务 UI：保存并展示发起时的提供商/模型快照，设置变更不改历史任务；旧任务缺失信息显示“未记录”，不回填当前配置。校验详情移入 destructive Alert 内，正常任务不展示。shared 与扩展双目标构建、lint/typecheck、115 项包测试及 Chrome/Edge 专项 2/2 通过，已复核截图。首轮新增断言误读测试请求 model 层级导致失败，修正为 body.model 后复验通过，原日志保留。日志为系统临时目录 octopus-task-ui-{shared,build,lint,types,test,browser,browser-final}.log；截图/结果位于 octopus-workflow-entry-BFBRlm/evidence（Chrome）和 octopus-workflow-entry-8lAL8J/evidence（Edge）。本轮仅使用本地合成提供商，未调用真实模型；未扩大旧录制修复范围。

2026-10-30，用户确认撤下旧录制修复能力：已移除任务页按钮/反馈、workflow.repair 命令、仓库副本创建与迁移实现；保留既有记录和历史元数据读取兼容。上述修复测试与截图为历史证据，不再代表当前入口。当前保留校验详情、复制诊断、原录制显式重试；回归同时确认退休命令被拒绝。shared/扩展双目标构建、lint/typecheck、112 项包测试通过。Edge 专项通过，Chrome 首轮未捕获短暂“已复制”状态，保持断言不变独立复验通过，未将首轮失败记为成功。日志为系统临时目录 octopus-remove-repair-*.log；截图/结果为 octopus-workflow-entry-bYK6e3/evidence（Edge）和 octopus-workflow-entry-gYmfWH/evidence（Chrome）。仅使用本地合成模型服务，未操作日常浏览器数据。

2026-10-30，整理历史接入完成：任务投影与有界历史分离，每次开始/重试保留独立ID，retryOf 关联前次；当前配置快照随新任务保存，旧失败及诊断不覆盖。受信本机存储保留200条终态及活动任务，20条游标分页、旧单任务幂等迁入、孤儿任务中断；旧连接测试不纳入历史。列表固定入口、空状态、加载/失败反馈和独立Separator；详情按ID读取，旧鉴权失败不跳设置，后台新任务不替换正在查看的旧任务。录制/产物删除及上次历史清理均有明确状态，返回历史保留加载范围和滚动。视觉目标 workflow-history-board-v2 已获用户明确确认，v1及旧最近任务入口已在 DESIGN.md 标记替代关系。

shared 与 Chrome/Edge 构建、lint/typecheck、116项包级测试通过；Chrome/Edge 一键整理/诊断重试2项、历史列表专项2项、拆分后的编辑器与生命周期4项均通过（共8项受影响浏览器回归）。历史专项以隔离存储45条合成任务验证20/40/45分页、无重复、滚动恢复、旧鉴权错误留页和来源/产物删除后的禁用反馈，已复核浅深色截图。生命周期回归验证旧详情不随新任务改变；全部模型调用使用本地受控提供商，无真实账号/费用。

初轮历史测试定位器同时匹配隐藏保留列表与详情，限定详情区域后通过；旧编辑器+生命周期长场景触及原120秒限制，且旧断言点击尚未刷新的首行，分别拆成独立编辑器/生命周期场景并按任务状态定位后通过。保留原断言意图，不提高时间限制；初轮日志保留，不记作成功。最终证据：octopus-workflow-entry-8gM0zS/evidence、octopus-workflow-entry-kg591W/evidence（一键整理）；octopus-workflow-history-Dc3PPI/evidence、octopus-workflow-history-M6J6dm/evidence（历史浅深色/删除/空态）；octopus-workflow-e2e-Kxykzd/evidence、octopus-workflow-e2e-DxzBpD/evidence（编辑器）；octopus-workflow-e2e-dS4kq0/evidence、octopus-workflow-e2e-og0jOg/evidence（生命周期）。日志位于系统临时目录 octopus-history-{shared,build-final,lint-final,types-final,unit-final,browser,focused,paging-final,lifecycle-final,tests-lint}.log。浏览器界面测试为隔离扩展页面，不冒充商店安装或日常浏览器人工验收。

2026-10-30，针对用户反馈真实录制多次整理失败进行只读根因排查。用户提供的任务诊断为 business 阶段：steps[3] 同时出现 WORKFLOW_SOURCE_ORDER 与 WORKFLOW_INVENTED_ACTION，events[2]/[6]/[7] 为 WORKFLOW_OMITTED_ACTION。它证明候选工作流已通过结构校验但来源映射不符合当前规则；未保存原始模型正文，不能从诊断恢复该次候选的具体动作和引用，也不能推断所有失败均为同一原因。

确认的实现缺口：架构第4节规定规则归一化并由程序处理顺序，实际 recording-normalizer 主要关联点击/导航，编译输入仍为逐条事件投影，动作/顺序/UUID引用由模型生成；业务校验又要求覆盖每一条click/input/select/key/submit/unsupported且保持DOM子序列。同一输入框暂停350ms以上继续输入会提交多个无值事件，缺少可用于安全跨批合并的稳定控件身份。DOMRecorder 使用 composedPath 首个Element生成label/role；点击按钮的内层span时不会上溯实际button，现代嵌套控件可能退化为“点击控件 / span”。这些是源码与合成浏览器复现确认的问题，但不足以将某一真实输出逐字段还原。

隔离无真实网络页面复现：Chrome 中以本地route.fulfill提供HTTPS合成页面，嵌套span按钮记录通用label，普通button记录正确label；同字段两次输入间隔450ms记录为两条input。独立合成8事件样本中，忠实候选校验通过；构造错误动作映射/顺序与遗漏，复现与用户相同的5项错误组合；省略一条聚焦输入框的click也触发OMITTED_ACTION。脚本与结果保留于系统临时目录 octopus-workflow-root-cause.mjs/json。首轮模拟页面使用非安全HTTP上下文导致randomUUID不可用、没有采到事件；改为隔离HTTPS合成页面后才取得有效证据，未将前轮空结果计作录制通过。未修改产品代码、未读取用户真实录制、未调用真实提供商。

现有合成提供商由 test/fixtures/workflow-provider.mjs 直接生成预期来源关联，验证了协议/持久化/校验/界面，不代表真实模型整理成功率。后续修复应优先补齐交互目标身份、保守规则归一化与事实骨架，由模型补充语义而非重建动作顺序/来源；保持危险动作、跨页因果和来源完整性校验，不因提高通过率而静默丢事件或放行无依据动作。真实模型质量需用明确授权的脱敏代表性录制另行验收。

2026-10-30，按用户确认方案实施 ADR-0087。源端由事件路径识别实际控件，增加文档内targetRef与编辑editRef；停止/失焦/独立动作关闭编辑边界，350ms只用于发送片段。工作流归一化仅合并明确同一文档/控件/编辑会话的连续input/select，保留原事件；程序以DOM子序列、因果链接及tab_open前置约束决定顺序，模型只获得短ID动作摘要，输出版本1语义注解，程序组装最终schemaVersion=1草稿。原始事件UUID、文档/控件身份和绝对捕获时间不发送给模型。未知/重复注解拒绝；缺失语义和控件不明确保留原动作并要求审阅，界面区分“待核对”和“模型建议”。旧工作流无需迁移，旧录制缺少新身份不猜测合并。新增assembly诊断阶段，程序装配失败与模型输出失败分别显示；事实不完整和限额错误不伪装成模型服务不可用。

工程验证：shared与Chrome/Edge构建、lint/typecheck通过；122项包级测试通过（其中核心19项涵盖注解乱序/缺失/重复/伪造动作、归一化边界、全部42种浏览器通知交错及安全诊断）。Chrome/Edge真实可信DOM事件专项2项通过：嵌套按钮名称、同字段跨批合并、同名不同控件不合并、blur/暂停边界、密码与敏感节点排除、字段值不进入证据；这是隔离HTTPS页面的生产模块测试。完整扩展录制2项、一键整理/诊断/重试2项、工作流存储2项、编辑器/生命周期4项均通过，共12项浏览器验证。模型响应仍为本地受控语义夹具，不据此声称真实模型整理成功率。

首轮DOM夹具未声明UTF-8导致中文乱码，修正夹具编码后通过；首轮录制分页断言比较点击前固定scrollTop，但浏览器点击前自动滚动7px，改为先滚入目标行再记录基准，保持返回位置精确相等的断言后通过。原失败日志保留，不把首轮失败计作通过。证据在系统临时目录：octopus-assembly-{focused,unit-final,capture,capture-final,browser,recording-focused,recording-final,delivery-build,delivery-lint,delivery-types}.log；录制截图octopus-recorder-41ZeM5/evidence与octopus-recorder-t7Qs0P/evidence；一键整理octopus-workflow-entry-lkN0Ie/evidence与octopus-workflow-entry-vylEkY/evidence；编辑器octopus-workflow-e2e-Aelx8m/evidence与octopus-workflow-e2e-m8P55e/evidence；生命周期octopus-workflow-e2e-0pcRFs/evidence与octopus-workflow-e2e-f3ppop/evidence。未读取用户真实录制、未调用真实模型。

真实质量验收仍待单独授权及当前接口确认：拟测试普通输入查询、嵌套按钮、同次编辑跨批、失焦后重填、同名不同控件、选择项、Enter/提交、同页导航、跨标签页、旧录制10类合成流程，各3次，最多30次请求且不自动重试。分别统计结构有效、事实来源完整、缺失注解、人工核对比例及语义质量，不能将待补充草稿计作完整整理成功；当前qwen3.6-flash-open的真实成功率尚未验证。

2026-10-30，用户明确授权最多30次合成编译，并确认使用此前MrToken JSON文件与qwen3.6-flash-open。官方模型目录HTTP200包含该精确ID；首次Python只读发现连接错误，Node生产传输随后成功，未把发现请求计作生成调用。以生产compileWorkflow的Node/tsx探针固定源码指纹，10类合成流程各3次，恰好30次模型请求，无自动重试或真实录制；不是浏览器Host直连真实提供商的端到端验收。

基线结果：25份有效草稿、3份旧控件信息不足的待核对草稿、2次结构校验失败。28份产出草稿通过来源覆盖与动作数量检查，没有出现先前SOURCE_ORDER/INVENTED_ACTION/OMITTED_ACTION错误。失败分别为nested-button第2次的successCriteria空数组，以及edit-after-blur第1次点击步骤parameter:null。客户端兼容配置未启用提供商级JSON Schema约束，SDK警告不等于已证明服务不支持该能力；本轮依靠提示词和本地Schema校验。

逐份审阅产出草稿发现：6份成功条件有无证据URL期望，2份元素期望写成true，1份使用未观察到的.order-list选择器，1份参数名称重复；报表页到达或核对按钮可见不能证明导出/核对完成。提交事件的旧submit→click映射还让回车提交多出潜在点击指令。因此“有效草稿”不等于语义验收或可直接执行，不能据此宣称整体可用或把人工核对草稿计入完整成功。

实测后已实施并离线回归：可选parameter:null等同省略；仍拒绝空成功条件；归一化版本2将submit保留为强制人工核对的观察，程序固定“不重复提交”的意图，不再映射额外click；提示词明确至少一个成功条件、禁止无依据URL参数/选择器和笼统true/false，区分页面可见与业务成功。未改写旧记录或旧草稿。新增测试经真实SDK解析合成null响应，并验证Enter/submit没有新增可执行click且仍需审阅。修正后shared/Chrome/Edge构建、lint/typecheck、125项包级与4项受影响浏览器回归通过；30次额度已用完，没有修正后的额外真实请求。

原始报告、28份最终组装的合成草稿及独立review.json已复制到 apps/browser-extension/build/validation-evidence/workflow-quality/d4697077-cf45-4cfa-a2fd-dcb0ddd2e908/，原临时目录同名保留；result.json保持基线原样，review.json单独记录语义检查、修正指纹及postCorrectionRealRequests=0。已扫描证据不含授权密钥，未保存提供商原始响应或认证头。新增手动入口workflow-quality-probe.mjs及十类workflow-quality-cases.mjs支持零网络dry-run和显式付费开关，不加入自动测试。后续真实质量比较需要新的调用授权；本轮不扩大第三阶段重放或发行验收结论。

修正后本地日志：系统临时目录octopus-quality-{shared,build,lint,types,unit,regressions,browser}.log；一键整理浏览器证据octopus-workflow-entry-iG9NZw/evidence（Chrome）、octopus-workflow-entry-heZjCc/evidence（Edge）。

2026-10-30，继续优化成功条件与参数可读性。新增workflow-quality.ts从现有脱敏记录生成验证上下文，并区分发布硬错误、未观察提案和有限页面检查。URL格式无效或元素可见目标为布尔占位值可留在草稿中编辑，但即使勾选审批也不能发布；合法未观察地址/选择器显示核对提示。文字匹配中的字面true/false仍合法，避免扩大误拦。原审阅表单直接展示字段反馈、修改清空审批，Worker独立复核；重复参数显示名按录制顺序编号，参数ID和绑定不变。

用户明确追加授权12次，沿用MrToken JSON和qwen3.6-flash-open。固定6类合成流程各2次，恰好12次请求，无自动重试、不含真实录制。结果12份草稿生成，4份未检出新增规则问题、8份需核对、0次解析/事实装配失败；其中1份网址条件阻止发布。该统计不是业务成功率。用同一规则离线重评原30次结果为13份规则未报问题、15份需核对、2次原始失败，不覆盖基线；两轮场景/次数不同，不宣称统计意义上的整体成功率提升。

逐份检查仍发现加载指示器/错误提示出现、页面地址不变、控件可见等不足以证明业务完成的条件；两组参数显示名曾使用内部input-N。实测后增加确定性标签回退到录制字段名再去重，并通过本地回归，未追加模型调用。当前主要限制是没有采集业务完成结果；暂不继续申请额度，应先设计明确的业务目标或完成证据输入。所有草稿仍需用户审阅，未开放重放或扩大业务执行验收。

最终shared/Chrome/Edge构建、lint/typecheck、132项包级测试通过，成功条件UI两浏览器最终复验2/2；此前同轮发布/存储回归4/4。初次单测与许可生成重叠导致inventory.json暂缺，构建完成后重跑通过；最后新增测试缺少花括号的lint问题已修正，原日志保留。修正后UI证据在系统临时目录octopus-criteria-ui-ohviik/evidence、octopus-criteria-ui-RNQbmq/evidence；日志octopus-criteria-{shared,build,unit,unit-final,browser,final-build,final-lint-fixed,final-types,final-unit,final-ui,post-regressions}.log。

本轮真实报告、12份组装的合成草稿、独立审阅与对比位于apps/browser-extension/build/validation-evidence/workflow-quality/6d23bb78-5bd5-4983-b6a8-2d70c79adc16/；原临时目录octopus-workflow-criteria-6d23bb78-5bd5-4983-b6a8-2d70c79adc16保留。result.json不改写；review.json记录代码指纹、语义限制、实测后本地修正及postCorrectionRealRequests=0。证据扫描未包含授权密钥，未保存原始提供商正文或认证头。工具增加--allow-paid-requests=12、--dry-run targeted和--rescore；这些手动入口不加入自动测试执行。

### 步骤就地核对实现验证

2026-10-30，按已批准方案2完成步骤详情固定页脚核对，移除重复清单，列表将待核对/已核对与模型补充/人工处理来源分开；总确认改为“已核对参数、成功条件”。部分核对随保存持久化，内容摘要绑定步骤、传递依赖、参数及成功条件；后台保存清除过期确认，发布独立拒绝旧审批。未增加真实模型请求或改变执行前确认。

shared及Chrome/Edge最终构建、lint/typecheck通过，138项包级测试通过。Chrome/Edge核对UI、成功条件UI、IndexedDB CAS/审批、原有编辑器和任务生命周期共10项浏览器用例通过；最终构建后核对UI再次2/2通过。覆盖取消、应用不落盘、仅核对保存、重开保留、关联修改失效、来源始终保留、发布与Worker拒绝过期确认，以及360×600明暗主题/360×420固定页脚。首次lint发现本次新增函数3处缺少花括号，修正后通过；未放宽断言或延长超时。

截图及结果保存在 `apps/browser-extension/build/validation-evidence/step-review/`（初次chrome/edge与final分别保留），最终构建和UI日志同目录。原有编辑/生命周期证据在系统临时目录octopus-workflow-e2e-CvK1lH、KlmuHN、cRJ9ex、Qlz1Oy各自evidence内。实现视觉复核见 [design-qa.md](../../apps/browser-extension/design-qa.md)。用户人工体验验收、真实模型语义质量、第三阶段重放和商店发布门禁不因此提升。

### 录制整理状态实现验证

2026-10-30，按用户确认的三态方案，录制首页、全部列表和详情统一展示待整理/整理中/已整理；详情整理按钮随状态变化，存在工作流时可查看最近更新的存续产物。状态查询以实际工作流来源与后台当前任务为准，不持久化额外整理标记，不以整理历史成功记录推断产物仍存在。

140项包级测试、shared及Chrome/Edge构建、lint/typecheck通过。新增Chrome/Edge界面回归2/2，原有一键整理与IndexedDB回归4/4；覆盖实时状态更新、整理中优先、失败/取消保留成果、重新整理新增草稿、产物删除和历史清理、查看工作流导航、缺口独立展示及360×600/360×420明暗布局。首次新增UI测试定位未排除隐藏列表，收窄到详情导航后通过，原失败日志保留；未放宽断言或超时。证据与日志在 `apps/browser-extension/build/validation-evidence/recording-workflow-state/`，截图复核见 [design-qa.md](../../apps/browser-extension/design-qa.md)。真实模型、日常Profile、第三阶段重放及商店发布未纳入本轮。

### 引导式整理实施验证

2026-10-31，用户在第2方向两张v2细化视觉稿获批后明确开始实施。已接入有界引导问题、逐题持久化、显式补充说明续问、完成判断选择、待回答/待确认历史、暂缓草稿保存及继续完善。工作流仍为JSON，没有自由聊天、Skill导出或本地重放。发送授权升级为包含录制与整理回答的版本2，旧授权不自动扩大范围。

基线25项聚焦回归通过；最终包级测试151/151通过，完整受控工作流浏览器套件22/22通过；最终小改后的引导UI/数据库专项4/4通过。shared和Chrome/Edge构建、扩展lint/typecheck、共享UI typecheck及新增RadioGroup lint通过。新增组件由官方shadcn CLI安装，未手改共享组件源文件。

覆盖已提交答案的Worker重启恢复、等待时Host释放、选项点击不请求模型、显式继续才进行第二次合成请求、暂不确定保存草稿后继续完善、原子最终工作流创建及重复完成幂等、双写CAS、v1数据库保留升级、未知目标/模型伪造人工完成方式拒绝、相关回答失效、独立roundId与请求预算；视觉检查360×600明暗及360×420固定页脚。原先历史/模型设置/录制关联状态/步骤编辑生命周期回归保留。

初轮CDP停止命令误发到browser session，改为page session并断言旧Worker目标已消失；之后真实界面定位到storage字段顺序导致JSON对象比较误判配置变化，改为字段/规范化endpoint比较并补回归。初次缺少共享Alert description的类型错误和局部花括号lint问题已修正。未通过加长时限或删除断言获得通过。

证据：apps/browser-extension/build/validation-evidence/guided-organization/run-20261031-9a175a2e/，包含原始日志、最终截图、source SHA256及result.json；完整原始截图目录路径保留在日志。实现复核见[design-qa.md](../../apps/browser-extension/design-qa.md)。没有真实提供商调用；真实提问质量、本轮用户人工体验、第三阶段重放及发行验收均未提升。

### 引导式整理旧路径清理验证

2026-10-31按用户要求清理新流程替代后的旧逻辑。删除编译器的无证据连接探测分支、服务的无录制任务模式、旧WorkflowRepository.create入口与其创建分支、停用修复字段、无消费者的界面回调和转发分支；收回9个只在所属模块使用的导出。参数删除/步骤删除与移动没有生产调用方，仅服务未接入的预留能力，本轮一并移除，保留当前更新操作。对照开工前快照，16个生产源文件净减少123行；该数值不是全仓死代码覆盖率。

当前启动必须带recordingId，Host结果必须带roundId；独立连接测试继续走设置Port。历史读取投影当前元数据，不回传未知存储注记，读取不删除原始记录；已保存录制、工作流、历史证据和真实数据库升级保留。旧的缺少诊断提示改为中性说明，不把所有无诊断失败误称为旧任务。

清理前38项聚焦基线通过；清理后149项包级测试通过，Chrome/Edge相关浏览器测试14/14通过（引导式整理、数据库、历史、独立连接测试10项，实际整理入口/录制关联4项）；shared及双目标构建、lint/typecheck通过。测试数量由151变为149：移除3个只针对删除/移动预留能力的成功用例，新增1个退役协议拒绝用例，原子编辑/来源/依赖及危险操作门禁验证保留。首次检查发现测试打包入口仍导出已收回的私有符号，以及基线.ts快照被类型检查纳入；移除无用测试导出、将原快照保留为.snapshot后复验通过，没有改tsconfig屏蔽产品源码。

证据位于apps/browser-extension/build/validation-evidence/workflow-cleanup/run-20261031-dc600c79/，保存原基线、源码前后差异、所有原始检查日志和结果摘要。未调用真实提供商，未改界面布局或生成新视觉稿，未删除原视觉/验证证据，未执行Git提交或发布。

2026-10-31，按用户截图要求将录制详情的查看工作流、重新整理、删除录制改为同一行，保留outline/default/destructive与原确认行为。shared及Chrome/Edge构建、lint/typecheck、149项包级测试和2项录制关联浏览器回归通过；360×420明暗截图确认三按钮同排且完整可见。证据在apps/browser-extension/build/validation-evidence/recording-footer-row/（bcM4m0为Chrome，mJ6jjT为Edge）；无真实模型调用。

2026-10-31，按用户要求统一Popup分隔线为独立Separator：工作流列表、步骤/参数列表、录制事件列表、公共导航及页脚均不再使用divide-*或单边border分隔，外层卡片边框保留。双目标构建、lint/typecheck、149项包级和6项相关双浏览器回归通过；隔离Chrome明暗多行工作流列表截图确认hover圆角不会弯曲分隔线。截图及日志位于apps/browser-extension/build/validation-evidence/separators/octopus-separator-1aVgFO/；未调用真实模型。

2026-10-31，按用户要求将列表item外间距统一为0。全部录制列表此前通过Fragment直接进入PopupPage的gap-4，导致条目与Separator两侧各多出16px；现增加独立零间距容器，其它记录/工作流/历史/步骤/参数/证据列表同样显式gap-0，保留item内部padding及分组标题。明暗真实Popup几何检查确认同组相邻行只相隔1px Separator，无额外留白。shared/双目标构建、lint/typecheck、149项包级和8项双浏览器回归通过；截图、geometry.json和日志位于apps/browser-extension/build/validation-evidence/list-spacing/octopus-list-spacing-tJrLP8/。

### 最近工作流、全部列表与统一行样式验证

2026-10-31用户确认三屏视觉稿并要求接入：最近工作流10条、查看全部进入搜索/20条游标分页。随后按用户要求调整列表外层py-2、Separator my-2、查看全部最右，以及已整理/已发布success绿色。交互行统一PopupListItem，不修改共享shadcn源组件；表单区块padding不受纯列表调整影响。

新增workflow.page协议，查询先匹配全集合，再应用updatedAt/ID排他边界和10/20条限额；cursor绑定规范化query。保留内部Repository.list供录制关联，删除原全量Popup workflow.list，更新实际调用方及测试。150项包级、10项相关浏览器回归通过；最终颜色修改后6项受影响浏览器复验通过，shared与双目标构建、lint/typecheck通过。45条数据覆盖20/40/45分页、同时间稳定顺序、尾页搜索、空结果、快速查询、返回保留查询/加载范围/滚动，以及保存重排后位置恢复。

首次UI断言将48px最小行高误当成52px上限，按现有字体度量改为核对8px padding/min-height48px及相对原64px收紧。返回位置失败经诊断确认手动恢复1708px后被原生滚动锚定拉回0；只在全部工作流正文禁用overflow-anchor解决，移除无效的临时捕获/调试改动，原位置断言保留并通过。未延长时限或放宽分页数量断言。

完整日志、截图、几何和源码摘要在apps/browser-extension/build/validation-evidence/workflow-lists/run-20261031-6b70d904/，原临时资料保留。视觉复核见[design-qa.md](../../apps/browser-extension/design-qa.md)。本轮没有调用真实模型提供商，未改变工作流实际可重放范围或发行验收状态。

### Skill Agent首批底座验证

2026-10-31用户确认新闭环方案并授权设计/开发。新增skill-organizer.ts只负责真实ToolLoopAgent的四工具适配及外部工具准入；尚未替换现有产品入口。8项SDK契约测试通过，Chrome/Edge受限CSP与IndexedDB消息往返2/2通过，应用包级测试158/158通过；shared及双浏览器构建、应用typecheck通过。初轮lint对模型边界故意移除原始异常cause报错，已在该边界用明确理由局部标注，最终lint通过，未关闭全局规则。

首轮测试揭示SDK的response.messages仅包含最后一步；已改用上游公开的累计responseMessages，并补齐已完成read结果和待答调用均保留的断言。模型是SDK MockLanguageModelV4或隔离浏览器内的受控实现，真实提供商请求为0。浏览器页使用script-src self与connect-src none；此结果不等同完整扩展Worker/Host会话恢复，也不证明供应商tool calling质量、Skill落盘或Page Agent Core重放可用。

证据：apps/browser-extension/build/validation-evidence/skill-agent/foundation-20261031-4514d6c7/，含两浏览器result.json及工程日志。新会话视觉三稿为pending review，未据此接入前端。剩余工作见Skill Agent方案开发进度。

### 统一 Skill Agent 可行性验证

2026-10-31，用户确认整理和重放统一 ToolLoopAgent，要求先技术验证/文档、视觉稿稍后。当前设计见[统一方案](../architecture/browser-skill-unified-agent.md)与 [ADR-0089](../adr/0089-browser-skill-unified-agent.md)。本轮只新增 `test/skill-replay-feasibility.test.mjs`，没有实现生产重放、改共享 UI 或调用真实模型。

- 新增 4 项真实 SDK + MockLanguageModelV4 契约测试通过：复现串行工具仍执行 ask 同轮动作；无 execute 的外部动作只返回意图；带配对拒绝/答案的序列化上下文可在新 Agent 继续观察；未知结果可作为真实工具结果保留且恢复消息不自动执行历史动作。
- 聚焦 Organizer/新小样/现有 BrowserRouter 共 20/20；扩展包级测试 162/162；lint、typecheck 通过。生产源码未变，未重复构建发行产物。
- 既有 `test:skill-agent` 10/10，包括 Chrome/Edge 受限 CSP、IndexedDB 保存与重建后的问答继续。这是普通隔离测试页，不是完整 MV3 Worker/Host 生命周期验收。
- 初次新小样 19/20：断言误将累计 toolCalls 的第一项当作末步动作，实际第一项是已完成观察。修正为按 toolCallId 定位，并断言累计观察仍存在后 20/20；没有放宽动作内容断言。设计因此明确排除账本中已有结果的调用。
- 官方 CLI 在正确 `-c packages/ui` 的 base-nova 上只读核对 Questionnaire/MessageScroller 成功；本地 @shadcn/react@0.3.1 声明包含单选、多选及 text/email/number/date 等输入和受控 props。首次未带项目路径时误用 new-york registry，返回 404；未据此安装或替换组件。CLI docs 未提供 MessageScroller URL，未编造链接。
- 官网浏览器捕获因内置浏览器不可用未完成，用户明确延期视觉。组件真实交互、TanStack Form 联动、焦点/滚动体验未验证；新 fields schema 与调度门禁也尚未接生产。

证据目录：`apps/browser-extension/build/validation-evidence/skill-agent/unified-20261031-a4c8/`，含包级 test/lint/typecheck 日志、Chrome/Edge result.json 和本次范围说明。SDK 测试中的浏览器结果是合成值；不证明 PageController 与本地 Agent 已端到端接通，不证明未知副作用的生产去重、模型理解质量或真实重放成功率。真实提供商请求 0 次。

### 2026-11-01：Skill 整理与重放实施及受控闭环

已接入统一 ToolLoopAgent、Worker/IndexedDB 会话、Native v4 Skills 文件域及批准的双 Tab/问答时间线。补充状态稿 skill-agent-additional-states-v2 获用户批准，v1 superseded；视觉登记以扩展 DESIGN.md 为准。旧复杂工作流运行入口、编译器、固定问卷和编辑发布逻辑已移除；保留用户旧数据与一次性历史摘要导入，不伪造旧消息。

- shared、Chrome/Edge 扩展与 Executor 构建完成；扩展/Executor lint、typecheck 通过。最终静态检查结果按本次工作区记录，不代表 Git HEAD，未提交或覆盖其他会话改动。
- 扩展旧全量 143 项通过后清理弃用工作流专属用例，保留有效录制/模型设置检查，现行全量 90/90。迁移保留输入编辑边界、脱敏、42种跨标签页通知交错的事实顺序与完整性断言。Skill Agent 专项 19/19（含双浏览器真实 IndexedDB、真实 SDK/合成模型、Questionnaire 多字段表单）。
- Executor 全量首次 282/288：6项失败来自 Native 测试握手固定 v3。按批准的 v4 更新测试握手，保留不兼容版本拒绝断言；聚焦 Native Bridge 7/7，随后原完整范围 288/288。真实原生 Skill 文件检查包含安装隔离、路径越界、junction、同名保护、保存回执幂等与手改快照。
- 设置回归4/4；录制回归4/4；实际 action popup 2/2，Chrome/Edge 均为360×600。录制首次失败因旧 Tab 名称，修正定位后保留采集、暂停、关联标签页、重开和脱敏断言复验通过。
- 新 Native E2E 使用本地合成提供商、唯一 Host、隔离 profile/project：录制→整理提问→保存技能→校验目录打开请求→手改SKILL.md→重读→重放提问→填写/查询→观察→打开同站点回执页→观察并关闭→结果。Chrome/Edge 均通过，查询各执行1次，额外回执页最终已关闭。
- 同轮提问与动作、重复答案（包括动作尚未返回时）、旧世代、预算、取消、未派发动作与中断只读结果、未知占用恢复/空闲探测/落盘失败保留锁已有回归。模型失败或空工具轮次释放重放占用；保存重试清除旧错误；重新整理保存失败不替换原关联。

原失败保留：Questionnaire未注册原语导致提交被阻断；点击已选Tab未退出设置导致探针未取消；目录打开测试过早读取异步回执；合成模型按标签文字错选label而非input导致OUTCOME_UNKNOWN。分别修正应用组合或夹具，未放宽查询次数、权限与身份断言。最后一项同时确认未知结果未继续执行查询。

证据按 browser-skills/20261101-<UUID> 批次保留，首次完整成功批次5b82e616，清理后143e895f，跨页补充1384ffce；原错误批次均未覆盖。shell.openPath在Main完成目录校验后由测试拦截，因此只证明正确目录派发，不证明Explorer人工体验。重放结果保留verification=unverified；本地合成模型可验证调度与PageController链路，不能证明真实模型规划质量。

真实提供商调用0次，未读取真实密钥；此前付费额度不沿用。真实模型工具选择/质量、物理中文输入法、实际Explorer打开及本轮人工操作体验仍待独立验收；复杂网页和发行/商店/独立电脑门禁不提升。

### 未发布旧工作流数据清理

用户随后明确取消旧测试数据兼容。删除旧历史导入、历史类型/诊断 Schema、只读分支与旧摘要提示；不再尝试恢复旧工作流。安装/更新事件删除旧工作流库与 workflowJob/workflowHistory，Skill 会话库版本3升级删除已导入历史及 migrations store，保留当前会话、技能关联、录制与模型配置。此决定取代上一节“保留旧数据并导入摘要”的处理方式，原测试结论仍作为当时证据保留。

隔离 Chrome/Edge 的真实 IndexedDB 回归同时植入旧摘要与新版会话/关联，验证仅旧记录及旧数据库被删除，并继续验证 CAS、重复答案及保存关联。Worker 更新事件用例验证仅删除指定旧存储键，凭据与录制配置保留。当前用户浏览器的数据清理在重新加载新构建后执行；未通过离线文件操作修改日常浏览器 Profile。 本轮 shared 与 Chrome/Edge 构建、扩展 lint/typecheck 通过；单元回归91/91、Skill专项19/19通过，未调用真实提供商。

### 会话 ScrollArea 与连接时间线修正

按用户反馈，将 Skill 会话的 ScrollArea.Viewport 通过公开 render 属性与 MessageScrollerViewport 合成为同一个 DOM，复用共享 ScrollBar，保留 MessageScroller 锚定和回到最新。节点使用连续细线并顶部对齐；当前问题直接渲染在原提问节点，移除空头像与独立问卷块。工具详情随正文滚动，不另建原生滚动区。共享 UI 源组件未修改；扩展直接声明仓库已使用的 @base-ui/react 1.8.0 组合依赖。

Chrome/Edge 隔离界面测试2/2：单滚动视口、共享滚动条、19节点连接线、短窗固定footer、问卷提交、回到最新；浅深色截图人工核对通过。完整Skill专项21/21、扩展单元91/91、双目标构建/许可证、lint/typecheck通过。材料位于扩展build/validation-evidence/skill-timeline；是合成组件界面验证，不使用真实模型。原会话稿的滚动/无连线区域登记revision required，其余批准范围继续保留；本次是用户直接指定的局部样式修正，不宣称新视觉稿已批准。

### 录制详情整理入口状态

按用户要求区分“开始整理 / 继续整理 / 查看整理”，分别使用Sparkles、StepForward、FileText。已有会话通过显式sessionId进入SkillPage并仅发送skill.get；完成态不再因查看而创建新任务，重新整理移到完成会话的明确按钮。终态与活动任务选择覆盖旧中断记录不能覆盖新完成记录。

Chrome/Edge入口回归2/2，覆盖首次、运行、待答、保存、中断、失败、取消、完成及图标；进入已有任务不发送skill.start，明确重新整理才发送一次。界面改动沿用已批准录制详情布局，不涉及待审阅的时间线卡片重设计。构建、lint、typecheck通过，Impeccable定向检测无发现，未调用真实模型。

### 时间线节点与日期控件细化

按用户要求将节点由32px缩至20px、图标12px并重对齐连接线。日期字段采用现有shadcn Button/Popover/Calendar组合，中文locale通过已锁定date-fns 4.4.0直接依赖提供；表单继续由TanStack Form管理YYYY-MM-DD字符串，不转UTC，不改共享源组件。

Chrome/Edge日期与时间线聚焦4/4：节点宽度20px、日历单选/清除、Enter打开/Esc关闭及焦点返回、360×460边界、上海/洛杉矶同日期提交、表单错误与输入保留。截图首次发现测试夹具遗漏生产data-color-theme属性，修正夹具后重新核对浅深色；产品主题代码未改动，初次截图保留。构建/许可证、lint/typecheck、扩展单元91/91通过，Impeccable定向检测无发现，真实模型调用0次。材料位于扩展build/validation-evidence/skill-date-picker。

### 中文技能名称与可修复诊断

2026-11-01 直接通过用户浏览器的只读会话界面取得首次失败validate_skill输入：中文混合显示名称被旧英文slug正则拒绝，仅返回SKILL_SCHEMA_CUSTOM。原始输入在修复后未改名称即可通过结构校验；未重跑用户任务、未执行真实网页业务操作。

共享browser-skills使用锁定yaml 2.9.1解析frontmatter，name支持中文、英文、空格与标点（非空单行、最多120字符），description支持引号/多行文本（非空、最多2000字符）。目录仍绑定安装实例与skillId。新增固定诊断码与安全解释，区分缺少元信息、YAML、name、description、未声明引用、重复项和站点范围；模型工具Schema及指令明确显示名称契约，错误消息保留到下一次修正请求。没有放宽站点/路径限制、增加预算或自动重试旧任务。

- shared完整12/12，扩展单元91/91，Skill专项23/23；新增中文/混合名称、引号、多行描述、CRLF、重复键、别名拒绝、错误分类与Schema说明验证。
- Chrome/Edge受控SDK测试增加缺少元信息→具体诊断返回→修正为中文名称→校验/保存的往返；Native文件/Bridge聚焦11/11，中文带引号名称及多行描述真实读写通过。
- 完整Native E2E中文名称场景在Chrome/Edge通过，覆盖录制、提问、保存、手改重读、重放提问、查询与跨页打开/观察/关闭，查询各执行一次。
- shared/扩展/Executor构建及相关lint/typecheck通过。扩展许可证脚本补收workspace共享依赖yaml，双产物清单均包含相应许可证。

保留原失败批次：2a882cf7因YAML Node入口在Electron ESM产物中dynamic require(process)失败；临时ESM适配仍不适用于沙箱Preload，5c60e298未建立preload API。最终Executor构建使用YAML公开exports.default通用模块，保持原有ESM/CJS及沙箱边界，未修改第三方源码或加入运行时补丁。17793414已完成中文技能保存，但统一状态文案使测试过早选中即将隐藏的历史返回按钮；改为具体导航栏定位后，03f976b6完整双浏览器通过，未放宽业务断言。

原始输出保留在browser-skills各独立批次，构建日志归skill-chinese-name。此次实际提供商调用0次，受控通过不替代真实模型输出质量验收。更新需同时重启新版Executor和重新加载扩展；原失败会话仍保留原诊断，用户明确重试才创建新任务。

### 2026-11-02：浏览器优先保存与离线闭环

设计与故障规则见[离线方案](../architecture/browser-skill-offline.md)。整理提交默认由IndexedDB事务保存完整快照、内容摘要、录制关联和tool result后完成；Native仅用于显式保存到目录、打开目录和读取手改文件。重放优先遵循关联来源；缓存降级需确认具体skillId/内容摘要，创建会话与关联校验同事务，当前会话固定快照。磁盘缺失/格式/权限错误不静默降级，写盘失败保留浏览器副本。

- 扩展单元93/93，Skill专项25/25，另新增副本完整性/ZIP内容用例2/2。双浏览器真实IndexedDB测试覆盖既有磁盘关联补缓存、存储配额失败事务回滚、保存重试不调用模型、旧回执不能覆盖新关联、旧副本不能创建新运行。
- 受控服务测试覆盖无Native整理与运行准备、显式写盘失败、回执丢失后同ID查询恢复（实际创建1次）、手改重读更新缓存、缓存确认/过期拒绝、无效磁盘文件不回退、重新整理不覆盖原文件。
- 离线UI在Chrome/Edge验证真实ZIP下载、两个固定文件名、未附加配置密钥、未连接禁用写盘、缓存提醒与取消零运行、确认后来源提示。短窗和浅深色截图已核对；复用既有Button/DropdownMenu/Dialog/Alert，未恢复被用户否决的卡片稿。
- 实际Native E2E先暂停连接，完成录制→整理提问→浏览器保存→ZIP导出→离线重放；再恢复连接→显式保存到目录→打开目录请求→手改→重读→再次重放/跨页操作。Chrome和Edge均通过，离线及在线查询各执行一次。批次a9f5baab与最终105297e0保留；前一批沿用旧测试目录日期前缀，后者已按Asia/Shanghai日期归档。
- 模型设置回归4/4。录制UI回归2/2；录制语义初次2项失败来自旧测试把内部归一化证据当作模型输入。将原生产read_recording投影原样提取到recordingToolPage，测试直接调用该边界且保留隐私/事件完整性断言后，语义复验2/2。未改DOM录制行为。

Chrome/Edge构建及许可证完成（新增fflate随包），扩展lint/typecheck通过；本轮未修改Executor运行协议或文件服务，Native完整链路仍使用此前成功构建。shell.openPath继续在Main验证后由测试拦截，不代表人工Explorer验收。真实模型调用0次，用户任务未自动重试。初次新增UI夹具的字符串转义错误已修正后复验；测试成功不提升真实模型质量或商店/独立电脑门禁。

### 2026-11-02：本地重放目标可见性

用户反馈未看到真实页面操作。源码确认本地重放固定DOM-only快照，而路由仅在screenshot=true时激活标签页，故操作可能发生于后台已有Tab。现在本地run的browser_snapshot不论是否截图均激活目标Tab，恢复最小化窗口并聚焦；Native DOM-only读取仍保持被动行为。复用既有PageController，没有新建页面执行引擎。提示词明确无匹配页时打开允许的起始URL。

聚焦路由12/12，覆盖本地DOM-only激活/聚焦、Native被动观察、无权限先拒绝；扩展构建及类型检查通过。没有重跑用户业务或调用真实模型。此次是路由受控验证，尚不作为用户本次失败任务的实际tabId、动作结果或模型预算数值取证。预算保持整理12、重放min(20,skill.execution.maxModelCalls)，未修改或自动重试已执行动作。

## 当前状态

### 工具权限策略

2026-10-21，Executor 设置新增默认只读、全部与逐工具自定义策略。选择后直接热应用，系统策略不可修改，可复制为自定义；编辑弹窗包含分类、搜索、当前筛选全选、复制/删除及放弃修改确认。工具发现过滤策略，MCP 调用入口再次拒绝缓存的禁用工具；不改变已有授权、在途调用、本机紧急停止或既有传输地址生命周期。实现见 ADR-0085。

原目录构建因运行实例占用 `dist/native/computer-escape.node` 被拒绝，未终止该实例或覆盖其资源。独立源码副本使用 `node scripts/compile/build.mjs` 完整构建通过，包含全部原生目标、Main、Preload、Runtime、Renderer；最后的页脚布局调整以同一 Vite 配置重新构建 Renderer。包级 lint/typecheck、格式和差异检查通过，副本执行包级 test 281/281 通过，零失败、零跳过；新增回归覆盖持久化、策略默认值、注册目录一致性、缓存调用拒绝、同会话热切换、在途调用完成、过期修订拒绝、受信 IPC 及应用确认丢失。

真实 Electron 的策略交互与原有进程/IPC 边界回归 6/6 通过，最终样式调整后策略交互原条件复验 1/1 通过。截图检查覆盖 1487×1058 桌面与 560×700 窄窗口；修正名称换行、半选显示、窄窗口分类导航、列表横向溢出及桌面页脚布局，最终截图与边界断言通过，无页面脚本错误。使用隔离测试数据，验证系统策略不可编辑、自定义新建/搜索/复制/删除、脏草稿放弃、热应用和重启保留。

首次副本构建缺少插件依赖入口及离线 Computer 归档，补齐已有依赖映射与归档后完整构建通过；最后独立 Renderer 命令首次触发 pnpm 对副本依赖状态的安装预检并拒绝，改用已装配的 Vite API 和同一配置构建通过。原始失败、复验、源码摘要、视觉复核报告和截图保留在约定的 tool-policies 批次，未放宽测试断言或原有期限。未更新原目录 dist，未生成安装包或提升独立硬件、签名及干净机器发布门禁。

### 地址刷新图标与 Tooltip

2026-10-21，将地址刷新操作改为标准 icon 尺寸按钮，使用现有 Tooltip 显示「刷新本机网络地址」，保留同名 aria-label、禁用状态与刷新处理。Renderer 独立构建、聚焦 ESLint、Node / Renderer 类型检查以及原网络选择集成烟测通过；截图和烟测同时确认纯图标、方形尺寸、鼠标悬停和真实 Tab 键聚焦提示。首轮烟测补充显式 tooltip 语义角色，随后将不触发键盘焦点可见状态的程序化 focus 检查改为真实 Shift+Tab / Tab，原期限验证通过；材料保存在约定的 refresh-address-tooltip 批次。未重建或替换运行中的原生资源。

### 内网地址自动发现与显式选择

2026-10-21，Executor 0.0.4 未提交工作区以可刷新的本机网卡 / IPv4 下拉列表替代手动输入。Main 通过具名 IPC 提供符合现有私有 / VPN 策略的地址；合并重复 IP 的网卡名称，不返回 MAC 等无关元数据。刷新保留当前选择和草稿，失效地址保留并标注；空列表和读取失败提供恢复提示。Main 保存前重新读取网卡，拒绝已不属于本机的地址；本机模式不依赖地址发现。配置格式、授权和保存后完整重启规则不变。

原目录的 `pnpm --filter @octopus/executor build` 因运行实例占用原生文件而被预检拒绝。独立工作区使用同一 `node scripts/compile/build.mjs` 完整构建通过，包含全部原生目标及 Main、Preload、Runtime、Renderer；本次变更源码与构建副本逐文件字节比对一致。包级 lint/typecheck、格式及差异检查通过，聚焦发现 / IPC 回归 4/4 通过。

对新构建副本执行包级 `pnpm test` 首轮 277/278 通过，唯一失败是验收工具组装找不到副本中的 `executor-delivery.md`；补齐它及同一工具需要的 `executor-computer.md` 原始文档后，原断言、原期限复验该项 1/1 通过，不重跑已通过的其余测试。10 项不同的真实 Electron 回归覆盖地址选择、单地址不自动选择、刷新保留选择、空列表、读取失败、保存前失效复核、关闭内网访问、两类监听失败、实际网络 MCP、桌面布局以及进程 / IPC 边界。既有集成首轮 6/7，因副本缺少原有插件输出而无法打开 Edge 插件目录；补齐相同 Chrome/Edge 输出后，该桌面回归复验 1/1 通过。未放宽业务断言或增加原有测试期限。

构建日志、首次失败、复验日志、源码摘要及桌面 / 560px 窄窗口截图保留在约定的 network-addresses 批次。未修改正式用户配置或终止原运行实例，未更新原目录 dist，未生成安装包、执行签名或独立电脑验收。

### MCP 监听失败原因与处理引导

2026-10-21，Executor 0.0.4 工作区新增有界监听诊断，贯通 Runtime → Main → Preload → Renderer，保留应用错误码、系统错误码、失败阶段和端点。状态页直接说明地址不可用、端口占用或系统拒绝的原因及对应设置；入口定位「设置 → 服务接入」，明确保存后完整重启。此类失败不开放数据重置，不改变用户配置、监听回退或防火墙策略。

`pnpm --filter @octopus/executor test` 275/275 通过，聚焦监听与监管回归 12/12 通过，包级 lint/typecheck 通过。独立目录重新编译 Main、Preload、Runtime、Renderer；两项真实 Electron 监听失败回归和原有授权数据恢复回归共 3/3 通过，覆盖具体原因、错误复制、重试后诊断保留、设置定位及桌面/窄窗口布局。未修改正式数据。

标准 `pnpm --filter @octopus/executor build` 首次因运行实例占用 `dist/native/computer-escape.node` 被预检拒绝；未关闭或强杀该实例。独立应用复用了既有未改动的原生及私有资源，不作为完整原生重建、安装包或发行验收。集成首轮因继承 `ELECTRON_RUN_AS_NODE` 无法启动；移除测试子进程的该变量后，初始断言又早于初始化完成且窗口未激活导致轮询未刷新。夹具改为显示其自有窗口并在已有 30 秒初始化预算内等待失败生命周期，保持业务断言后复验通过。诊断、编译记录与截图保存在约定的 listen-failure 验证批次；正式安装包尚未更新。

### 状态页故障提示与工具概览

同日继续调整工具详情弹窗：复用已有 shadcn Empty 原语、标题同行状态、非空清单单处计数，并默认折叠文件传输使用说明。完整构建、包级 lint/typecheck、client-setup 与 runtime-recovery 两项真实 Electron 集成通过；检查空清单截图和已有清单、说明展开/折叠、关闭焦点返回与窄窗口溢出。此轮证据在约定的 tool-empty 批次中；上述变更不改共享原语源码。

2026-10-21，工作区将启动故障提示调整为中性面板：单次说明、主操作重试、默认收起的技术详情，保留安全复制与确认后的备份重置。五项工具概览统一「已就绪／未就绪」，具体连接、后端与清单状态放入详情弹窗，浏览器弹窗可进入桥接管理。未更改运行时、授权或重置契约，未生成新安装包。

Executor 完整构建、包级 lint/typecheck、267 项基础与原生测试通过，零失败、零跳过；四项真实 Electron 集成（runtime-recovery、client-setup、computer-access、desktop-overview）通过。截图检查覆盖 1040×760、720×560、错误详情展开/折叠及暗色故障提示；恢复回归覆盖安全复制、取消确认、原始数据与备份保留及真实服务恢复，无页面脚本错误。

首次构建因运行实例占用原生模块失败，用户完整退出后复验通过。首轮集成受继承的 ELECTRON_RUN_AS_NODE 与缺失本地私有资源阻挡；基础/原生首轮为 206/267，其中资源缺失产生 NODE_DIRECTORY_INVALID 等错误。清理该环境变量、使用仓库既有命令装配固定 Node、Computer 和搜索资源后，按原断言和期限复验通过。首次失败、诊断与后续成功分别保存在约定的 runtime-recovery-ui 验证批次，不覆盖原始日志；这些结果不提升干净机器或正式发行门禁。

### 发布升版后的版本契约回归

仓库 v0.0.17 / Executor 0.0.4 的 Tag 源码为 `3cf4c849f983f71bc1bc2e7919d8f400cdadd76c`。[远端首次验收](https://github.com/nebulaedata/dr-octopus/actions/runs/39209488240)完成 Executor 267 项测试、实际 ZIP 六项交付测试、构建、lint 和 typecheck，全部通过。未签名产物 productBuildId 为 `1e346ec8bb09389b72344caee4ad93be797baa4448a416a70e45fdb8a92d296c`；EXE/ZIP 的公开下载 HTTP 200、长度和 GitHub 摘要均与 CI 预检记录一致。签名、干净机器和独立硬件门禁维持原状态。

本次同时修复 Web 子目录 Turbo 配置覆盖根版本输入的问题：0.0.16 曾命中 0.0.15 的缓存键 `973b19a8f332af03`，导致页面版本和 Executor 下载链接滞后。修复后 0.0.17 使用缓存键 `524da531e9ebeb54`，实际版本文件均纳入输入；发行归档 SHA-256 为 `549a8560478dab042a73465481f05998714aff1b74b54e83281627d90e91729d`。归档的“关于”页、版本标识均为 0.0.17，下载链接指向同一 Release 的 Executor 0.0.4，并与浏览器实测字节一致。Web 287 项、CLI 86 项和桌面/手机四项浏览器回归通过。CLI 首轮一项 dry-run 在并行构建期间超时，原命令、原期限复验 86/86 通过；首次记录与归档核验结果保存在约定的 release-v0.0.17 批次。

最终交付为仓库 v0.0.16 / Executor 0.0.3，Tag 源码为 `01c26c8d943335bf2d65a7b1036f9ebce37fb42f`。[远端第二次验收](https://github.com/nebulaedata/dr-octopus/actions/runs/39202386109/attempts/2)完成扩展 22 项、Executor 267 项、实际 ZIP 六项交付测试，以及构建、lint、typecheck；均零失败、零跳过。0.0.3 的 productBuildId 为 `5b2e3232337973442cd365abb7be37a3bb72836ad1c14c8c8d7091e194fd6234`。Release 的未签名 EXE/ZIP 已核对公开下载 HTTP 200、文件长度及 GitHub 摘要与 CI 离线预检记录一致。公共 npm 的 latest 为 0.0.16，隔离全局安装后的命令版本与帮助验证通过。

v0.0.16 的[首次远端验收](https://github.com/nebulaedata/dr-octopus/actions/runs/39202386109/attempts/1)为 266/267：2 GiB 下载记录已传完全部字节，但最终返回 TRANSFER_FAILED / cleanupPending。原因仍未确定。本地单项复验通过，同一 Tag 的第二次远端完整验收也通过；复验保持相同期限和断言，开启 Actions 调试日志。首次失败、单项诊断及第二次 CI 日志/预检报告分别保留在约定批次，不用后续通过将首次失败定性为已确认的环境问题。

2026-10-19，仓库 v0.0.15 将 Executor 从 0.0.1 升至 0.0.2 后，[首次远端验收](https://github.com/nebulaedata/dr-octopus/actions/runs/39199423303)出现 7 项失败：备份清单仍限定 0.0.1，阻断备份和启动恢复。升版前的本地 264 项通过没有覆盖该条件；升版后的原条件本地复现同样 7 项失败，原始输出分别保留。继续检查发现最终产品清单、离线脚本和 HTML 标题也存在固定版本。

修正后备份校验跟随当前产品版本，便携清单验证格式并将版本绑定到 productBuildId，离线预检额外核对清单与产物版本一致，窗口标题由同一产品契约生成。新增回归通过编译输入模拟 0.9.7，实际完成原生备份和恢复，且拒绝其他产品版本；不修改工作区版本或放宽备份兼容策略。23 项聚焦回归、完整 267 项测试（零失败、零跳过）、构建、lint、typecheck 已通过。新生成的 0.0.2 unsigned 产物 productBuildId 为 `6e21249a5399c01e3d3739c4e4eae880df5d15534b51cc9a44c66c6558e243da`，离线预检、解包目录与实际 ZIP 的 8,265 文件完整性验证均通过。实际 ZIP 的六项非交互交付测试与构建版 Electron 六项集成（含故障恢复 UI）均通过。原始材料保留于约定的 release-v0.0.15 验证批次；这些检查不构成干净机器或签名发行验收。

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

### 2026-11-02 扩展执行限制验证

新增独立执行限制设置，默认整理50/重放100、范围1–500；预算耗尽经确认追加。`test/execution-limits` 对应实际入口为 `test/integration/execution-limits.test.mjs`，已纳入 `test:settings`。Chrome/Edge验证非法值拒绝、独立保存、刷新恢复。服务测试验证新会话读取设置且存量任务预算不受设置修改影响；领域测试验证追加保持消息及已完成工具、不接纳重复追加或未知副作用。

本次扩展单测97/97、Skill Agent测试27/27、设置测试6/6；lint/typecheck通过；shared与Chrome/Edge完整构建通过。生产组件设置截屏在扩展build/validation-evidence/execution-limits（受控页面，不是完整插件人工验收）。未调用真实模型，未据此宣称提高轮数能解决所有业务失败。

### 2026-11-02 Popup与原生侧边栏验证

新增 `pnpm --filter @octopus/browser-extension test:window-panel`：隔离Profile加载正式构建副本，仅将Native Host替换为测试名称，模型请求仅发送本机合成HTTP服务。真实Chrome/Edge原生SIDE_PANEL通过，不以普通Tab模拟面板。验证Popup继续存在、实际录制详情入口打开会话、跨Tab保持面板、SDK提问与回答、关闭面板中断在途模型请求、重新打开不自动调用、显式继续保留答案、多窗口只读/拒绝抢占、正常Tab伪装面板被拒绝。重放实际创建所属窗口业务Tab，使用现有PageController观察合成网页，结果引用该观察并保持业务结果unverified。

初次验证发现SIDE_PANEL的runtime.getContexts.windowId为-1，Port.sender不含documentId；使用页面内history.replaceState添加hash也不会更新sender原始URL。现方案通过唯一查询参数的实际导航固定文档URL，查询SIDE_PANEL上下文建立注册，窗口由面板windows.getCurrent取得；不能回退为任意同源扩展Tab可执行。多窗口隔离、正常Tab拒绝和关闭恢复测试在修复后通过。共享CSS产物名由popup变为style，受控UI测试夹具同步修正后通过。

证据：扩展 `build/validation-evidence/skill-panel/` 的Chrome/Edge截图及result.json记录实际浏览器版本、合成模型请求数和验收范围；`build/side-panel-*.log`记录构建/回归。小窗口360×460保持单一滚动视口、当前问题和底栏。98项单元测试、27项Skill Agent测试及原Popup两浏览器回归通过。此为受控模型与合成网页验证，未使用真实模型额度，不代表真实模型质量或商店安装验收。

侧边栏最终实测版本：Chrome 156.0.8078.74、Edge 156.0.4314.58；每个浏览器6次本机合成模型请求，包含一次有意挂起后关闭面板取消的请求，真实付费模型调用0次。全局设置回归6/6通过。

### 2026-11-02 会话历史迁入window-panel

真实Chrome/Edge侧栏验收通过：Popup移除历史按钮，查看整理定位最新创建记录；window-panel列表包含整理/重放，类型筛选、47条记录跨3页无重复、游标跨筛选拒绝、按最近活动排序均已验证。查看列表/旧会话不调用模型，原任务持续运行且可返回；在列表关闭重开保持列表。受控重放仍使用真实PageController，合成模型请求次数不因历史查看增加。

单元测试98/98、Skill Agent回归27/27通过；针对最新整理入口、重复重放与终态新建会话的Chrome/Edge补充回归4/4通过，lint/typecheck及双浏览器构建通过。实际截图位于扩展build/validation-evidence/window-panel下的history-running与conversation-history文件；本次仅复用已确认列表/详情样式，没有新增或恢复视觉候选稿。所有模型请求使用本机合成服务，无真实模型计费。

本次Popup回归首次遇到浏览器“Could not find an active browser window”环境错误；原日志保留在conversation-history-popup-tests.log，独立串行重跑Chrome/Edge 2/2通过，记录在conversation-history-popup-retry.log。没有修改产品逻辑规避此错误。

### 2026-11-02 Questionnaire自行说明与window-panel设置同步

实现系统级自行说明：选择题提供其他选项，日期/数字/邮箱/文本提供不适用入口，说明输入使用共享QuestionnaireInput。Worker对当前字段、非空说明、长度和总答案大小作校验，按原问题工具结果持久化；测试覆盖必填字段修正、未声明字段拒绝、空/超长说明拒绝、单选/多选/日期UI及SDK下轮收到说明，无自由聊天入口。

配置统一于window-panel，Popup设置按钮/路由移除。模型/授权/密钥及执行限制分别有保存版本，受控并发写只允许一个成功，过期写返回SETTINGS_CONFLICT。真实Chrome/Edge两窗口验证未修改表单同步，脏表单保留输入并提示，加载远端或明确保留本地草稿后再保存。模型公共快照仅含hasKey，不含密钥正文。普通设置组件测试使用隔离扩展副本中的生产设置组件，专门验证密钥/目录/连接测试；真实SIDE_PANEL注册与跨窗口同步由test:window-panel验证，不把普通Tab当面板通过。

单测100/100、Agent回归28/28、设置回归6/6、原生侧边栏2/2通过，lint/typecheck及Chrome/Edge构建通过。证据位于扩展build/validation-evidence/window-panel下的settings-conflict截图，及skill-date-picker下的other-answer截图。全部模型调用为本机合成服务，没有使用真实模型额度。当时 lib/workflow 尚未迁移，其代码承担模型服务和录制依据构建，并非旧 DAG 执行引擎。2026-11-03 经用户确认，模型能力迁入 lib/model-settings，录制依据迁入 lib/recording，原目录移除；职责划分见[统一方案](../architecture/browser-skill-unified-agent.md)。迁移前 Chrome/Edge 构建及聚焦回归 21/21 通过；迁移后双目标构建（含许可证）、lint、typecheck、单测 128/128，以及双浏览器录制语义、整理/重放服务、选择语义与模型设置集成回归 8/8 通过。模型请求使用受控服务，未提升真实模型或发行验收状态。

### 2026-11-02 设置统一保存验收

移除独立ExecutionLimits表单与保存协议，模型/授权/密钥更换/轮数由唯一保存配置按钮一起提交。单测100/100、设置UI6/6及原生侧边栏2/2通过，lint/typecheck和Chrome/Edge构建通过。覆盖一次写入全部配置、非法轮数不写任何字段、持久化失败保留旧配置与输入、重开恢复轮数、整份配置跨窗口同步和草稿冲突。截图位于扩展build/validation-evidence/execution-limits/*-unified-save.png。首轮旧测试因填写轮数后滚动位置改变而失败，明确回顶后验证原有toast位置，日志分别保留于unified-settings-ui-tests.log和unified-settings-ui-retry.log；没有修改产品滚动行为规避检查。

### 2026-11-02 会话诊断复制

Chrome/Edge生产时间线组件回归覆盖会话错误、不同工具调用和校验错误的复制目标定位、校验路径脱敏、密钥/接口/业务输入排除。通过受控Clipboard API验证成功、失败和重试反馈，未声称完成系统剪贴板人工验收。错误卡片截图位于扩展build/validation-evidence/skill-timeline/*-error-copy.png。完整扩展构建、lint/typecheck通过。

### 2026-11-02 无工具回合根因与修复

只读复制扩展IndexedDB并按用户提供的会话ID核对：终态SKILL_NO_TOOL出现在第9次模型调用，最后已保存的是页面观察，之前的填写/点击回执均已完成。旧processTurn在保存模型回复前抛错，最终回复无法补回。原始本地读取报告位于扩展build/session-no-tool-report.json与session-no-tool-observation-report.json（不提交），数据库副本已删除；合成复现脚本保留为build/reproduce-no-tool.test.mjs.snapshot，记录修复前普通text-only/stop回复导致失败且未持久化的行为。

修复后Host提交标准化finishReason；Worker先持久化响应，再判断工具/纯文本/空输出/截断/过滤。每会话最多2次纠正请求且计入原模型预算；整理合法工具恢复常规流程，重放纠正SDK及Worker均拒绝页面副作用。原SKILL_NO_TOOL任务显式继续时进入相同受限流程，重放需重新观察，未自动重放真实业务。

单测105/105、Agent回归33/33通过，lint/typecheck、shared及Chrome/Edge构建通过。覆盖保存回复与结束摘要、正常纯文本修复到submit_skill/finish_run、空/推理-only/截断/过滤/未知结束原因、纠正次数序列化、模型预算耗尽、未知副作用、旧会话继续、新调用ID也不能绕过重放纠正限制。原生侧栏使用本机合成服务额外加入text-only完成回复，验证恢复到有证据的finish_run且不重复页面操作；证据在build/no-tool-fix-*.log与build/validation-evidence/window-panel。真实模型工具选择质量未调用验证，不据此承诺所有模型/业务流程均成功。

### 内置智能体原生 SDK 循环（2026-11-02）

2026-11-03 预算停止改为 Worker 检查点回传累计预算与任务停止状态，移除 SDK 硬编码 500 轮上限；请求前的持久预算检查继续保留。Chrome/Edge 生产服务集成 2/2 通过，确认 2 轮预算只执行 2 次请求准备、最后工具结果完整落盘且正常退出 SDK，最后一轮成功完成保留 completed。包级单测 128/128、双目标构建与许可证、lint、typecheck 通过；均为受控模型，未提升真实模型或发行验收状态。

同日补齐生产 Host 回归：skill-service 集成的连续多步路径直接调用 runBuiltinAgent，保留真实 SDK 与 OpenAI 兼容模型适配器，仅在 fetch 和浏览器 API 边界提供确定性响应，不再手写 Runtime 停止逻辑。Chrome/Edge 2/2 通过，覆盖预算耗尽走 host.end 而非 host.failed、最后一轮 finish_run/submit_skill 成功落盘、最后一轮提问保留 waiting_user、回答后保持已用预算且不发超额请求，以及追加预算后保留账本并继续完成。构建期间仅在测试打包副本移除生产 Host 的停止更新，两浏览器均在预算正常停止断言失败，证明测试能捕获该行回归；生产源码未作变异。本次双目标构建与许可证、包级单测 131/131、lint、typecheck、测试格式及 diff 检查通过。证据：apps/browser-extension/build/budget-host-mutation.log（预期失败），budget-host-build.log、budget-host-unit.log、budget-host-lint.log、budget-host-typecheck.log（正常检查）。本次未调用真实提供商或真实业务页面。

按 [ADR-0091](../adr/0091-browser-builtin-agent-native-loop.md) 将通用模块迁移为 lib/builtin-agent。删除 processTurn/每步 launch 调度，工具配置绑定真实 execute；SDK 自行迭代、处理工具结果和评估停止条件。Worker 保留整轮准入、持久预算、权限、问答及工具账本。onStepEnd 保存 SDK 规范 response messages；自然纯文本结束不再由 Worker 自动重启。finish_run 不要求模型提供内部工具调用 ID，由运行时绑定最新观察或明确关闭回执；连续相同工具错误三次停止。

已核对官方文档与固定 ai@7.0.155 源码。SDK 能力用例 11/11，纳入包级单测 116/116；验证原生 execute 多步、工具结果进入下一模型请求、外部提问序列化续接、自然结束、预算停止、失败完成回执与 hasToolCall 区别、整轮执行前回调、串行非提问屏障的负例、工具异常回传、审批停止、检查点顺序和 AbortSignal。

Agent 回归 33/33；其中 Chrome/Edge 生产服务用例另外执行真正连续多步的 read_skill → snapshot → finish，确认一个 Host 世代、规范会话保存和 Skill 内容进入上下文；缺少观察时连续三次 finish 错误有限停止，持久配置为 2 轮时只调用模型 2 次，重复答案不创建第二执行者。

原生侧边栏 2/2：隔离的已安装 Chrome/Edge + 本机合成提供商，每浏览器 9 次请求（包含被关闭面板中断的请求），验证待答保存/重开、设置往返、跨窗口拒绝与普通 Tab 冒充拒绝。重放由 SDK 连续调用 read_skill → open_tab → snapshot → click → snapshot → finish，真实 PageController 页面按钮计数为 1；没有额外 Agent Tab。证据：扩展 build/builtin-agent-panel-with-click.log、build/validation-evidence/window-panel/*-result.json 及页面截图。此结果证明合成模型驱动的真实页面链路，不代表真实模型规划质量。

设置回归 6/6、真实 action popup/连接回归 2/2，shared 构建、扩展 Chrome/Edge 完整构建（含许可证）、lint、typecheck、diff 检查通过。日志：build/builtin-agent-build.log、builtin-agent-service.log、builtin-agent-settings.log、builtin-agent-popup.log。初次适配暴露快速回答时旧 Host 尚未结束的竞态，已修复为关闭旧世代后启动新世代；旧测试中每步更换 epoch、自动 text-only 恢复的假设已按新契约更新。原始失败见工具输出，另有 build/builtin-agent-first-failure-summary.json 明确标记为摘要，而非原始日志。

全部请求使用确定性模型或隔离本机合成服务，真实模型调用 0 次。没有访问真实业务、没有修改用户录制/技能数据或正式 Native 注册；真实模型的工具选择、复杂技能重放成功率与人工体验仍需独立验收。未改变视觉稿批准状态。

### 内置智能体真实模型验收（2026-11-02，授权最多 30 次）

用户追加授权最多 30 次真实模型调用，沿用外部 MrToken JSON 与精确模型 qwen3.6-flash-open。GET /v1/models 确认存在此 ID；真实模型生成请求恰好 30 次，HTTP 200 为 30 次，maxRetries=0，无网络或任务自动重试。密钥仅在 Node 转发进程内，隔离扩展只持有本机代理地址，不把真实密钥写入仓库、浏览器 Profile、参数或报告。请求发出前将次数落盘；代理硬拒绝第 31 次转发，即使结果未知也不归还次数。

使用当前 Chrome/Edge 产物的隔离副本、真实 SIDE_PANEL/Worker/ToolLoopAgent/PageController；仅替换副本中的 Native Host 名称以避免正式注册。测试输入为两条合成录制事件（填写订单编号、点击查询），不是用户真实录制；页面为本机合成订单查询页面。通过结构化问题工具提交合成答案/自行说明，不使用自由聊天或固定模型工具序列。

| 浏览器/阶段 | 真实请求 | 结果 | 独立观测 |
| --- | --- | --- | --- |
| Chrome 整理 | 6 | completed，技能校验/浏览器保存成功 | 模型读取录制、自主提问，生成中文名称“订单状态查询”及 order_number 文本参数 |
| Chrome 重放 | 12 | completed，finish_run 已执行 | 读取真实生成的 Skill，打开页面、提问、观察/填写/点击/再观察；编号为 000123，结果“订单000123：待处理”，queryCount=1 |
| Edge 重放同一技能 | 12 | cancelled，不能计为完整闭环通过 | 实际查询同样成功、前导零保留、queryCount=1；第 30 次请求在途时被测试脚本提前取消，模型随后返回 finish_run，但未执行 |

Edge 取消是本次测试脚本的额度边界错误，不能归因于产品停止逻辑，也不能把模型返回 finish_run 当作已完成。保留原 cancelled 会话和请求回执。脚本已移除“第 30 次请求刚预留就取消”的逻辑，改为只由代理拒绝第 31 次转发并等待在途响应结束；没有为修复脚本额外调用真实模型。报告中的 testHarnessIssue 明确标记该问题。用完 30 次额度后未继续真实测试，Edge 最终完成仍待新的授权验证。

观察到的效率问题：整理重复请求已读完的下一页，首次问题遗漏 allowDefer 后被 Schema 拒绝并自行修正；Chrome/Edge 均曾在用户回答后先尝试填写，被 SKILL_OBSERVATION_REQUIRED 拒绝，随后自主重新观察再完成填写。被拒绝的填写没有操作页面。没有出现 SKILL_NO_TOOL 或持续 finish_run 失败循环；此结论只覆盖当前单一合成查询场景，不证明复杂业务成功率。

证据：扩展 build/validation-evidence/builtin-agent-live/authorized-30-20261102/report.json（30 个真实请求的结束原因、工具名称、usage、源码 SHA256），generated-binding.json（合成产物），以及各浏览器会话 JSON。原始状态保留，全部为合成数据，不包含密钥。测试入口 test/integration/builtin-agent-live.mjs 必须显式提供外部 --key-file，默认测试命令不会触发付费调用。本轮只增加测试入口并修复其边界处理；lint、Node 语法及 diff 检查通过，没有更改生产 Agent 行为或用户数据。

### 提问策略默认值与已恢复诊断（2026-11-02）

只读稳定复制用户指定会话5543c4cc-4694-4913-a3c6-951b0878249a：第3次模型提问缺少allowDefer，被拒绝为SKILL_TOOL_INPUT_INVALID；第4次补齐后已接纳，status=waiting_user、session.error为空。SDK规范消息中的原始错误长文本被复制组件误归类UNCLASSIFIED_ERROR，时间线仍将历史错误显示为危险提示。值脱敏证据为扩展build/session-question-schema-report.json；原数据库未修改，临时副本已删除。

修复将省略allowDefer默认false，显式非法值仍拒绝；真实SDK校验cause链仅提取安全代码/路径，通过认证Host协议保存到账本。UI和复制诊断使用相同调用身份的账本优先，不以SDK错误正文充当领域码；有后续已接纳/已回答问题才折叠显示参数已纠正，错误历史不删除、不重写SDK上下文、不伪造旧记录缺失诊断。

单测120/120、Agent回归33/33、原生侧边栏2/2通过（侧栏日志为build/question-diagnostic-panel.log）。生产服务Chrome/Edge覆盖缺省allowDefer实际通过SDK、非法required字段仍拒绝并保存fields.0.required路径。双浏览器时间线覆盖已纠正折叠/当前表单、复制稳定码/recovered/安全路径、重复失败不误判、敏感SDK正文不展示或复制。截图位于build/validation-evidence/skill-timeline/*-question-corrected.png；日志为build/question-diagnostic-ui.log和question-diagnostic-agent.log。shared及Chrome/Edge含许可构建、lint/typecheck通过。本轮真实模型调用0次，不修改用户录制/技能/会话数据；这次原会话经重新加载扩展后可按其持久账本正确展示，无需重跑整理来修正历史提示。

### 优惠券选择语义丢失与 incomplete 终态分析（2026-11-02，未修复）

只读稳定复制用户指定重放de257815-dd8f-4511-9edc-ec8d172ce2c8及其录制343d70b3-cbae-4be2-bb68-5db054658fd2，临时副本读取后删除，不打开业务页或调用真实模型。脱敏报告为扩展build/session-replay-observation-report.json与session-coupon-evidence-report.json。

录制共有6个事件、无已记录缺口。第4个事件明确点击“内部使用”优惠券，第5个是同一input控件的input事件；这些内容完整存在于来源整理会话775ea040-3ae1-4c59-a9ba-6ca408ee5235的read_recording结果。因此不能将本次遗漏归因于原事件没有采集或证据没有发送。现有事实没有input type/checked语义，radio变化被统一映射为input → fill；模型随后将优惠券标签中的有效期误解为用户填写日期，并提问“是否保留有效期输入步骤”。用户选择“否，跳过有效期输入”，没有授权删除优惠券选择。

实际生成的8fdd2f27-46cc-4358-a112-24f9d3ce3ad0技能没有“内部使用”约束，workflow.evidence仅引用action-1、action-2、action-6，遗漏选券相关action-4/5，却仍保留可选有效期参数。当前校验只检查结构、站点范围与引用是否存在，不能发现这种关键选择遗漏或业务语义改写。原录制有信息、表达不精确，整理理解错误，校验漏检共同造成失真；没有证据证明单纯更换模型即可解决。

当前库保留的该录制两次重放（68eab5ee取消、de257815失败）都使用同一份缺券技能。最新重放在填入数量后曾因未重新观察被拒绝一次browser_click，后续确实重新观察、成功点击“立即充值”并取得新快照；没有选择优惠券，页面显示原价待支付，最后finish_run(outcome=incomplete)，代码将其映射为failed，session.error为空。这次终态不是SKILL_OBSERVATION_REQUIRED持续未恢复、模型次数耗尽或SDK循环失控；复制的是中途工具错误，且目前已纠正投影只覆盖提问参数错误，未覆盖页面观察恢复。

上述是定位证据，不是修复或业务验收。后续修复需保留有限技能架构，同时明确选择控件类型/选中状态、区分优惠券元数据与可填写字段、检测关键选择语义遗漏、在提交业务动作前核对Skill要求的关键选项。已保存的失真技能不会因代码更新自动修正；应在修复后另建并核对新技能，继续保留原产物与证据，不覆盖用户文件。

### 选择意图修复方案的前置验证（2026-11-03，整体门禁未通过）

用户要求先验证、通过后实施。本轮仅增加独立探针 `apps/browser-extension/test/integration/choice-semantics-feasibility.test.mjs`，不修改生产源码、用户录制、技能或会话。执行命令：在扩展目录运行 `node --test --test-concurrency=1 test/integration/choice-semantics-feasibility.test.mjs`。探针直接打包生产 DOMRecorder、normalizeWorkflowActions、validateSkillCandidate 和固定版本 PageController；安装版 Chrome、Edge 使用临时隔离上下文与被路由到本地合成 HTML 的 synthetic.test，无真实业务请求。实际 ToolLoopAgent + MockLanguageModelV4 每浏览器两次受控响应调用生产校验器，真实模型请求为零。测试证明下述事实和反例，不证明模型规划质量。

| 验证点 | 实际结果 | 对原方案的约束 |
| --- | --- | --- |
| 单选框旁附日期说明 | 实际 recorder 将单选变化记录为 input，归一化为带 parameterId 的 fill | 必须在源端区分控件类型，不能靠日期文本判断是否可填写 |
| 原生单选/复选、ARIA switch 结果 | 上游默认快照包含 checked / aria-checked，可看到结果改变 | 这部分有真实观察依据，不必另造页面执行器 |
| 同步、异步自定义开关 | 捕获阶段读到旧 ARIA 状态；下一任务可读到同步结果，却仍早于 80ms 异步结果 | 不能把 click 时或固定延迟读取当作已完成选择；意图、观察结果和未知必须分开 |
| preventDefault 的复选框点击 | 捕获阶段 checked=true，下一任务回滚 false | 不能将捕获阶段的暂态记录为用户最终选中 |
| 原生单选下拉和多选下拉 | 改变 selectedIndex / selected 后，默认快照中的 select/option 行相同 | 当前文本快照不足以支撑所有选择控件的确定性核验；不得宣称通用已验证 |
| 模型完全遗漏选择 | 受控模型提交无 evidence 候选，生产校验通过 | 结构校验缺少覆盖要求 |
| 模型引用选择但正文明确反向要求 | 受控模型提交含 action-1 引用、正文却保持另一选项，生产校验也通过 | 仅补引用覆盖检查仍然不够，引用不是语义一致性证明 |
| 同页状态在两次观察之间改变 | 单选状态变化后文本快照变化 | 观察只证明观测时状态，不能保证后续派发时仍成立 |
| 普通 button 的关键操作 | type=button 的“继续”直接增加合成提交计数 | 不存在仅凭 type=submit / 按钮文案完备识别业务提交的通用规则 |

两个浏览器探针均通过，含四次受控 SDK 响应；这里“通过”表示成功复现上述正例和反例，**原修复方案的整体实施门禁仍未通过**。原始合成事实、标准快照与结论在 `apps/browser-extension/build/validation-evidence/choice-semantics-feasibility/{chrome,edge}.json`。无密钥、真实账户或订单数据。后续实现须将缺陷基线断言替换为修复后的回归要求，不能把“确认旧行为存在”的测试作为修复成功证据。

修订方案的验证要求：

1. 源端记录有限的控件语义与有依据的选中结果，保留未知；不承诺任意自定义控件同步完成。名称与说明没有明确 DOM/ARIA 边界时保留原标签并标记不可拆分，不用启发式剪掉日期或价格。选择元数据沿现有脱敏契约处理，不能因为新增 option/group 字段而泄露原本不发送的值。
2. 将可机器表达的选择意图作为有来源的约束保存，来源选择不能仅由模型自填一句“已覆盖”解除。模型可参数化、合并或请求省略；省略与用户答案的对应关系由持久问题身份及明确作用域约束。引用检查只是一部分，不能证明自由 Markdown 的语义正确；Skill 文本和已保存约束冲突必须保留不确定性，不伪造已验证。
3. 优先验证上游公开配置/API 能否补齐下拉状态；当前探针只验证默认配置，未证明其他公开 API 均不可用。不改私有字段、不复制 Controller、不扩大上游补丁。确实无法观察的类型明确进入未知/提问，不能默认为已满足。
4. 必须明确有限的提交边界如何与实际派发动作绑定，且模型不能换一个普通 click 绕过约束。在这个契约和反例测试完成前，不承诺“所有关键提交都会被自动识别并阻止”。最近快照并不提供跨事件循环的原子性；方案须明确可提供的保障与剩余页面竞态。
5. 补充实际会话问答续接、作用域越权、脱敏、重复选项跨组、跨页/截断观察、默认选中无事件、过时证据和无语义控件的回归。现有受控响应只注入两个候选反例，未证明真实模型能准确生成约束，也未验证修复后的全链路。

本轮结论是修订后继续验证，不进入生产实施。此前 30 次真实模型额度已用完，新的模型质量验收须另获授权；不能把 Mock 的预置候选当成真实模型成功率。

本轮检查：新增双浏览器探针 2/2、扩展单测 120/120、扩展 lint/typecheck、探针 Prettier 与 git diff --check 通过。没有生产源码或打包入口变更，未重建发行产物；新探针直接打包当前源码，不以旧扩展包证明新行为。

### 选择意图修订方案：付费对照与来源规则原型（2026-11-03，继续验证）

用户允许按需付费验证，本轮自限最多12次。`test/integration/choice-intent-live.mjs --live --key-file <外部密钥文件>`先发现确切模型 qwen3.6-flash-open，再由真实 ToolLoopAgent 调用工具提交候选。请求在发送前持久预留，maxRetries=0，无未知请求重试，硬上限12；密钥只从授权外部文件读取，固定目的地 https://api.mrtoken.cn/v1，不使用文件中的 url，不进入日志或报告。实际12次全部HTTP200，用完本轮自定上限后没有继续付费请求。

六个合成情境各比较一次旧表示与带类型/组/选项/观察状态的新表示，任务与用户答案相同。覆盖优惠、配送、取消勾选、下拉区域、跨组同名和未知异步开关。**这不是现有生产整理服务与修复服务的 A/B 测试**：两组均使用同一个实验性 propose_skill 契约和提示，差别只有合成录制表示；新表示由夹具构造，尚未证明实际 recorder 会输出它。所有候选与 usage 保存在扩展 `build/validation-evidence/choice-intent-live-20261103/report.json`。未访问真实账户或操作业务页，未测试实际重放成功率。

| 情境 | 旧表示的实际问题 | 新表示的实际结果 |
| --- | --- | --- |
| 优惠旁含有效期、用户说不填写日期 | 把有效期当输入，未保留原优惠选择 | 明确选择原优惠，无日期参数 |
| 配送旁含服务时间 | 将配送当输入，来源和组未保持 | 保留组、选项、来源，无额外输入 |
| 取消推广邮件 | 正文理解取消，但结构化标识改写且多造参数 | 保留未选中状态，仍多造一个文本输入，严格验收失败 |
| 区域旁含维护日期 | 仍生成日期参数 | 保留区域选择，不生成日期参数 |
| 两组均有“标准” | 正文能区分组，但来源改为 input-1 | 组与来源均保留 |
| 异步开关最终状态未知 | 没有澄清 | 仍把未知写为 selected，needsQuestion=false，失败 |

初始评分漏掉“非日期的多余输入”，修订评分后新表示为 **4/6 完整契约通过，5/6 保留选择来源/组/状态**；初始评分保留在 initialAssessment，没有删除或重跑失败候选。旧表示六项都未通过严格结构化契约，但部分正文理解正确，不得据此宣称旧模型业务成功率为0%。两组每场景仅一次、不构成统计成功率或模型排名。第12次即使 question 文案非空，needsQuestion=false且状态被改为selected，仍判失败，不能把“写了一句疑问”当实际请求用户决策。

为验证确定性边界，新增独立 `test/choice-contract-feasibility.test.mjs` 原型8项：Host从事实生成选择要求；模型遗漏不删除；跨组同名不合并；状态false与unknown分开；未知必须由绑定来源/决策种类/版本的真实答案解决；错误作用域、过期或自由文本不能授权省略；说明文字不能伪装任何可填写输入；重复/未知来源拒绝。8/8通过，但原型仅在测试中，不导入生产，不代表生产问答/事务已经接通，也不保证Markdown无矛盾或页面业务结果正确。

双浏览器公开API探针扩展结果（新证据写入 choice-semantics-feasibility-v2，保留第一轮报告）：即使 includeAttributes 加上 selected/aria-selected/value，原生select的运行时选择变化仍未出现在快照相应行；原生multiple select连续调用公开selectOption两次，返回均success但最终仅选第二项。Chrome/Edge均复现。未访问私有selectorMap、未修改第三方依赖，也没有把测试页的DOM读取接口提供给智能体。

修订契约记录在[统一方案](../architecture/browser-skill-unified-agent.md#录制选择意图与执行约束)。结论：明确的数据语义有收益；额外参数和unknown改写必须由来源规则约束，而非继续叠提示词。完整实施门禁仍取决于源端采集、持久问答和重放闭环验证，本轮不把局部原型或付费小样当完整通过，未修改生产代码。

检查：128项单测（含8项规则原型）、Chrome/Edge公开API探针2项、lint、typecheck、修改的测试文件Prettier及diff检查通过。12次请求报告总token为9743；未获取账单，不推算实际金额。无生产源码/入口变更，未重建发行产物。

### 选择要求的持久链路与真实重放验证（2026-11-03）

新增 `test/integration/choice-chain.test.mjs`。默认不调用模型；以隔离Chrome/Edge上下文执行真实DOMRecorder、RecordingRepository、SkillSessionRepository、BuiltinAgentService、ToolLoopAgent、BrowserRouter、PageControllerAdapter和PageController。扩展browser API由测试peer提供，调用实际Router/Adapter并执行页面DOM操作；不是安装扩展、真实Worker进程或Content消息接收器的验收。页面仅为本地响应的synthetic.test，未访问日常Profile或真实订单。

受控路径：真实点击“优先配送”并创建合成发货单 → 原始事件保存到IndexedDB → 正式read_recording → SDK提问 → reload重建服务后恢复waiting_user → 正式skill.answer → 保存正确的受控候选 → reload → 正式read_skill读回完全相同的SKILL.md和workflow对象 → Router/Controller观察、选择、再观察、提交、再观察、finish_run。Chrome和Edge均验证页面仅提交一次且express=true。答案幂等；同一提交ID改答案拒绝；过时版本新提交拒绝；新的候选超出录制站点时拒绝保存，原技能关联保持；操作后未观察就再次点击被拒绝且没有额外提交。正确候选由测试提供，**不是新整理算法自主生成**；源端仍把单选变化记为fill，保留缺陷断言，不以成功重放掩盖它。

本轮付费自限20请求，通过环境变量CHOICE_CHAIN_LIVE_KEY指定授权外部密钥文件才启用。先调用只读models发现，再持久预留每次生成请求；maxRetries=0，不重试未知生成请求。首次只读发现TLS失败后再次发现成功，该故障未发送生成请求。本轮实际13次HTTP200：正常选项9次、选项不存在4次，共74957 tokens；不推算金额。剩余7次未使用，未为了通过而重跑失败模型场景。调用账本为扩展build/validation-evidence/choice-chain-live-20261103/requests.json。

| 场景 | 实际模型/页面结果 | 验收 |
| --- | --- | --- |
| 选择要求只存在workflow.evidence，Markdown没有写出选项名称 | qwen3.6-flash-open读取完整技能，观察实际页面，选择优先配送，唯一提交express=true，最后finish_run completed | 此合成正常路径通过，证明JSON被模型实际参考 |
| 同一技能，页面移除优先配送，仅剩普通配送 | 模型观察后声称看到了两个选项，对普通配送label的索引调用browser_select(optionText=优先配送)；会话进入outcome_unknown，页面提交数0 | 未通过：没有在缺少目标时主动提问。不得把“没有错误提交”当正确恢复闭环 |

真实SDK由生产createBuiltinAgent创建，模型请求经Node绑定代理发往MrToken，密钥不进入网页。只改传输peer，不改系统提示或工具描述来让测试通过。正常技能的workflow.evidence使用现有允许的kind/targetHint描述选择，并未接入新的结构化来源契约。正常报告为chrome-replay.json（首轮原文件），失败报告为chrome-replay-unavailable.json。后续脚本按场景输出chrome-replay-available.json，未覆盖或重跑首轮原文件。

缺失选项错误又用受控工具输入在Chrome/Edge复现：真实快照没有该选项，标签被当作select目标；当前适配层将操作失败归为未知结果并停止。报告为build/validation-evidence/choice-chain/{chrome,edge}-unavailable-baseline.json。受控探针断言确认当前错误边界，不意味着该行为已修复；期望仍是派发前识别不适用操作，并由智能体提问/明确未完成。两个浏览器无实际业务提交。

这轮缩小了根因：存储、read_skill传递和有限页面执行能保留并执行正确要求；源端选择表达与整理规则仍待接入，重放还存在目标幻觉及工具适用性缺口。不得仅因JSON包含要求就假定页面满足；也不能取消未知副作用保护让模型继续盲试。正式实施前的完整语义门禁仍未通过，本轮仅增加验证，不修改生产行为。原失败保留；没有追加模型请求来替代尚未实现的语义边界。

### 派发前工具适用性原型与真实纠错（2026-11-03）

本轮沿用上轮20次总额度剩余7次，累计请求14–20均HTTP200，未发送第21次。新增test/fixtures/tool-target-probe.mjs与4项单测，只对受控快照样本试验工具类型准入：身份匹配的已观察label/radio不准调用browser_select，选择控件不准当文本填写；旧快照、不同文档和歧义行不作能力推断。原型通过现有Host工具账本的invalid准入路径拒绝派发，未修改正式源码。**文本快照包含页面可控内容，该解析器不是可信能力表，禁止直接作为生产安全或权限检查上线。**

受控Chrome/Edge链路中，强制复现错误browser_select后，在实际派发前得到已持久化拒绝，session仍running，后续可进入waiting_user，reload仍保留同一问题，提交次数为0。日志choice-chain-preflight-controlled-final.log，证据choice-chain/{chrome,edge}-unavailable-preflight.json。首轮测试装配误用了小写诊断码，被Host协议拒绝；改为合法大写码后才通过，原装配失败日志保留，未放宽正式协议。

真实模型复验分两部分，使用相同生产提示与PageController，只在实验Host的record回调加入原型：

| 请求 | 场景 | 结果与证据 |
| --- | --- | --- |
| 14–17 | 从头运行缺失选项场景 | read_skill → tabs → snapshot → ask_user_question，waiting_user，提交0次。没有请求错误工具，所以原型没有实际拦截；不能据此将成功归因于预检查。chrome-replay-unavailable-preflight.json |
| 18–20 | 先由受控模型准确播种上次错误（读取技能/标签页/快照/错误select，共4步、无付费），经原型拒绝后交给真实模型续接 | 模型改用click点普通配送label，同时声称在点优先配送；重新观察后才承认目标缺失，又尝试滚动查找。3次付费续接内没有提问或结束，提交0次。第21次转发被测试额度门禁拒绝，不能描述为产品预算失败或无限循环。chrome-replay-unavailable-recovery.json |

第二场景的测试断言失败保留在choice-chain-recovery-live.log；报告中的LIVE_RUN_FAILED来自测试总额度封顶，页面没有提交。原型确实挡住了错误工具类型，但**相同错误业务意图可换成类型合法的click继续执行**，单测显式保留这个反例。不能把3次续接未完成扩大为模型永远不会恢复，也不能把无业务提交视为完整恢复通过。

当前验证结论：工具适用性检查只能补充已有观察/身份保护，不能代替来源选择要求与实际页面目标的对应。修复不能以“预检查通过”作为业务正确性证明，也不应继续付费盲测或叠加按钮名称规则。本轮仍未将原型接入产品；完整选择语义方案未通过，用户正在修改的预算/停止条件保持原样。

### apply_choice 有界选择阶段原型（2026-11-03，限定范围通过）

用户重新授权付费验证，本轮自限新增20次，账本独立于已用完的前一批20次。新增测试原型test/fixtures/choice-tool-prototype.mjs、单测test/choice-tool-prototype.test.mjs及双浏览器/可选付费入口test/integration/apply-choice-poc.test.mjs。默认只跑受控测试；显式环境变量APPLY_CHOICE_LIVE_KEY指向授权外部密钥文件才允许真实请求。固定MrToken目的地、先发现确切模型、请求发送前持久预留、无自动重试；未知请求同样占额度。

原型的requirementId读取创建时复制并校验的group/option/role/checked，模型不能传入替代选项、状态或元素索引。按group+option+role唯一匹配；零匹配返回unavailable，多匹配返回ambiguous，不可用/未知返回unknown；已有正确状态不重复点击。执行后必须再次观察；失败或结果丢失进入outcome_unknown并禁止再次执行，不以工具返回success代替业务状态。普通click/fill在整个选择阶段始终拒绝；这验证的是有界阶段的统一准入，并没有验证通用重放中的任意动作分类。

**关键适配范围：**原型的控件语义由固定合成页面的DOM oracle提供；实际操作调用未修改的公开PageController.clickElement，元素索引来自同次公开快照。适配器有固定页面的DOM身份、组、角色、状态重检，但不是已接入生产的观察契约。现有PageController公开BrowserState只提供文本状态，不能把本次fixture oracle伪称为它的结构化能力；也不能把文本解析器当可信元素映射。未修改共享协议、录制器、Worker或正式智能体工具。仅覆盖原生radio/checkbox，没有宣称通用自定义组件或原生多选下拉已解决。

受控验证：Chrome/Edge各覆盖11种情境，包括正常选择、取消勾选、缺失、同组重名、禁用、观察后名称变化、观察后跨组移动、页面取消点击、动作回执丢失、SDK错误工具绕过后提问、同轮提问与操作。已满足时重复调用不多点；另一组同名控件保持不变；未知动作不自动重复；原始工具不能绕过；SDK onLanguageModelCallEnd看到同批问题后，操作即使排列在问题之前也不执行，问题优先状态持续到本轮结束。原型不提供真实持久问答恢复，已有服务持久化测试与此原型分别报告。

| 真实模型场景 | 请求数 | 结果 |
| --- | --- | --- |
| 要求的选项存在 | 2 | apply_choice → finish_run，真实页面仅点击目标一次 |
| 要求的选项缺失 | 2 | apply_choice返回unavailable → ask_user_question，页面零点击 |
| 同组同名两个候选 | 2 | apply_choice返回ambiguous → ask_user_question，页面零点击 |
| 要求取消复选框 | 2 | apply_choice → finish_run，真实页面取消勾选，未重复切换 |

本批实际8次HTTP200，共7132 tokens，剩余12次未使用。模型qwen3.6-flash-open，四个情境每个仅一次，不作统计成功率承诺。模型只收到合成workflow.choices，由测试提供正确要求，不代表源端录制/自动整理已修复。此处finish_run仅结束选择阶段，不代表订单、支付或完整任务成功。付费请求发生在追加同轮问答防护前；这些真实响应均为每轮单工具，没有发生问答混批；混批防护是随后双浏览器受控验证，未虚称为真实模型覆盖。

证据在扩展build/validation-evidence/apply-choice-poc-20261103：paid-20.json保留8次请求和4项实际结果，chrome-controlled.json/edge-controlled.json保留受控情境。日志apply-choice-controlled-first.log、apply-choice-controlled-final.log和apply-choice-live.log；4项单测另验证未知/冲突要求拒绝、模型不能改写参数、外部对象修改不能重定向已创建要求、动作后观察失败阻止重复操作。

结论：在可信语义绑定与有界选择阶段前提下，“提示词+requirementId工具+统一准入”这部分PoC通过。生产接入仍缺少可维护的控件语义/索引对应、从录制到workflow.json的来源要求、以及选择阶段与导航/输入/提交的权限交接；不能将本次限定通过提升为完整整理/重放验收。下一步应解决适配契约及集成，而非再次用同一合成情境花费模型额度证明已覆盖的行为。

本轮检查：扩展单测136/136、双浏览器受控测试2/2、真实模型四情境所在测试1/1、lint、typecheck、三个新增测试文件格式检查通过。仅增加测试原型和PoC记录，没有生产构建入口变化，未重建发行产物。

### 录制选择与 apply_choice 正式接入（2026-11-03）

用户确认进入开发并逐层验证。本节是正式源代码实现，区别于此前仅测试原型的记录。契约见[录制选择意图与执行约束](../architecture/browser-skill-unified-agent.md#录制选择意图与执行约束)，用户说明见扩展INSTALLATION.md的“录制选择与重放确认”。未修改packages/agent、共享shadcn组件或上游PageController代码，也未改动用户正在调整的Agent停止条件。

实现内容：

- DOMRecorder保存inputType与control元数据，原生选择input/change归为select，归一化版本3投影为choice，不分配文本参数。点击标签解析到真实关联控件；Tab/滚动不改写选择结果。名称读取排除嵌入字段、option列表与敏感子树，保留真实说明而不按日期/金额关键词猜测。跨组同名和取消勾选保持独立；同一路由不同操作阶段的冲突选择拒绝静默合并。
- 校验器按录制和已确认决定生成workflow.choices；模型省略引用或choices字段也不会删除要求，保存用规范化候选并再校验数量、字节和站点范围。inputs必须指向实际fill来源，原生number/email/date还检查参数类型。未知选择须显式澄清，错误或虚构来源不能通过。
- choiceDecision通过现有问答CAS、幂等和持久化链路。Worker生成明确作用域的确认文字，记录presentedQuestion，只有approve=yes应用。普通“忽略日期”或解释回答不删除选择。整理决定写入新技能；重放决定只修改本次executionChoices，原技能快照、内容摘要和磁盘文件不变，改变要求会清除对应旧应用回执。
- 本地apply_choice通过原BrowserRouter/Content所有者路由，绑定最近观察的tab/document/controller/snapshot及技能要求。按DOM语义唯一定位，再用同一个PageController的公开interactiveBlacklist在同步beforeUpdate建立单目标索引。原生隐藏checkbox/radio可使用真实关联的可见label，随后检查实际input状态；没有生产使用PoC的文本索引授权解析器或fixture DOM oracle。普通索引排除选择目标；当前页面未满足要求时阻止普通点击。作用域失效拒绝操作，派发后不确定沿用outcome_unknown，不重复点击。
- 原生单选下拉读取实际selectedOptions，唯一定位显示标签后调用公开selectOption并核对；重复文本、无法唯一定位、需要改变多选下拉以及不能直接取消的radio明确拒绝。模型完成声明仍为unverified业务结果，不承诺网页事务原子性。
- 缺少控件类型/选择事实的旧录制不自动修复；整理及对应旧技能重放给出重新录制提示。没有删除旧数据或覆盖手改文件。原有保存失败保留绑定、文件回执与手动编辑读取机制继续使用。

正式链路覆盖：真实DOM录制 → RecordingRepository入库 → 正式read_recording → 问答与reload恢复 → submit_skill自动补齐选择 → 技能重读 → 正式apply_choice → 真实Router/Adapter/PageController操作 → 页面提交计数与状态 → finish_run。Chrome/Edge均通过。Skill候选正文由受控模型给出，但选择要求来自真正录制并由正式校验器补齐，已不再由测试手工伪造选择语义。扩展API transport仍为隔离peer，不能冒充真实商店安装验收。

针对边界的回归包括：日期解释不影响选择、改写/遗漏选择及虚构参数拒绝、显式选择确认重开后保留、冲突/重复答案、用户拒绝后继续阻止提交、明确批准仅本次跳过后可以继续且原技能不变、重新整理失败不换绑定、动作后必须观察、普通点击不能跳过要求、同组重名、另一组同名控件不受影响、无ID的原生控件、隐藏input的label激活、复选框取消与重复应用不切回、原生下拉label和文本不同、来源缺口和包限额。

| 验证 | 结果与范围 |
| --- | --- |
| shared构建与协议测试 | 13/13通过，包含false状态、错误URL不抛异常、角色状态不符、重复要求ID |
| 扩展单测 | 最终147/147通过（choice-production-unit.log）；包含正式选择来源和两种模式的确认规则 |
| 双浏览器选择/录制/服务链路 | 早期10/10通过；最后新增临时决定与隐藏控件的聚焦4/4通过（choice-final-scoped-decisions.log、choice-hidden-controls.log） |
| 时间线、问答与核心链路 | 首轮综合20项中18通过、2项时间线失败；新增历史展示直接读取缺失账本造成空白，已改为可选访问。保留choice-ui-integration-delivery.log；修复后聚焦10/10及后续12/12通过（choice-ui-fix-and-chain.log、choice-final-integration.log）。没有宣称原综合首轮全绿 |
| 模型设置、技能列表/文件UI、原生window-panel | 上述综合运行中Chrome/Edge对应项通过；没有改动其业务入口 |
| Executor技能文件 | 5/5通过，包括新choices写入/读回、手改workflow.json改变快照、同操作ID重试不覆盖手改内容（choice-executor-json-roundtrip.log） |
| 静态检查 | shared和扩展lint/typecheck、Executor类型检查与所改文件测试lint通过；没有将其当作原生安装验收 |
| 构建产物 | shared、Chrome/Edge及配套Executor构建通过；扩展两目标各生成46份生产依赖许可。不发布、不更改用户Profile。Executor保留既有大chunk提示，未以本次功能改动扩大到拆包优化 |

本批真实模型预算：承接前一节20次上限中的剩余12次，本实现阶段使用10次（累计18/20），全部HTTP200，共64639 tokens；剩余2次未使用，无自动重试。账本仍为build/validation-evidence/apply-choice-poc-20261103/paid-20.json，场景前缀integrated-；此前8次原型请求保留。

- 正常重放9次：使用正式createBuiltinAgent、Worker服务与Controller，选择只在JSON中，Markdown未写选项名；实际apply_choice成功，唯一一次页面提交选择正确，finish_run完成。证据integrated-chrome-replay-available.json，日志choice-implementation-live.log。
- 缺失恢复1次：先用4个受控SDK步骤读取技能/标签页/观察并取得正式apply_choice的unavailable结果，再让真实模型续接；模型请求ask_user_question，页面0次提交。不能把这1次描述成从头到尾全部真实模型。证据integrated-chrome-replay-unavailable-choice.json，日志choice-implementation-live-unavailable.log。
- 隐藏label、临时用户决定与最后的输入类型/展示保护补充由受控测试覆盖，未再次付费复测；真实模型整理质量本阶段未重新全量评测，不能声称所有录制均成功。

当前交付边界：支持已测的明确原生选择与受控确认闭环。复杂自定义控件、原生多选修改、跨阶段冲突选择仍会询问或拒绝；保守点击保护可能需要用户协助完成前置展开。旧缺信息录制需重录；已生成错误技能不会自动被重写。实际用户业务页、物理手动体验与商店/独立安装仍需人工验收，不能以合成通过作无限范围承诺。

收尾补充：最终源码再次通过双浏览器录制、原生选择适配和完整会话链路6/6（choice-final-recording-replay.log），含敏感关联标签不采集、普通label点击不误判跨阶段选择；post-build类型检查与lint通过。界面历史可在账本暂缺时正常显示。Executor本次完整构建日志为choice-executor-build.log；原失败日志与修复后日志分别保留。

### 整理会话可选清理技能（2026-11-03）

用户确认采用单个默认未勾选的「同时删除本次生成的技能」。当前工作树实现包括会话 revision/epoch 检查、所属 generation 的本地导出意图、按生成 ID 清理对应 binding/cache、独立 Native `skills.delete` 协议及固定文件句柄删除。删除默认行为与录制保留规则不变；历史会话不误删当前新技能，未结束重放引用时拒绝清理。

验证环境为 Windows、独立临时文件目录和隔离 Chrome/Edge 页面，不使用用户录制或真实业务页面、不调用付费模型。工作树包含用户已有未提交改动，本记录不代表独立 commit 或已安装产品验收。源码/产物以本次 shared、Chrome/Edge、Executor 构建为准。

| 检查 | 命令 / 范围 | 结果 |
| --- | --- | --- |
| 构建 | shared build → browser-extension build；executor build | 通过；插件两目标各 46 份依赖许可；保留现有大 chunk 告警 |
| 静态检查 | 三个包的 lint、typecheck | 通过；首次插件 lint 的 4 个测试花括号错误已修正，原失败输出保留 |
| 单元与协议 | shared test；browser-extension test | 14/14、147/147；删除请求拒绝任意路径与调用方 installationId |
| 本地文件 | Executor `test/browser-skill-files.test.mjs` | 8/8；手改定义删除、重复删除、安装/技能隔离、额外条目与 junction 拒绝、暂存清理 |
| Native 回归 | `test/native/file-publication.test.mjs`、`test/native/browser-bridge.test.mjs` | 14/14 |
| 双浏览器集成 | `session-deletion`、`skill-service`、`skill-session-storage` 三个 integration 测试 | 6/6；默认未选、取消重置、失败保留勾选与会话、重放无勾选项、旧代删除保留新绑定、离线浏览器清理、本地失败重试、过期 revision 与在用技能拒绝 |

日志及失败态弹窗截图归本地验证批次 `skill-deletion/20261103-implementation`；Chrome 截图已检查文字换行、选项说明和右对齐取消/确认按钮。没有把截图标为新视觉稿。当前未做日常已安装扩展到真实 Executor 的人工删除验收；文件服务和 Worker 分别通过真实 Native / IndexedDB 测试，服务测试的文件往返为受控 peer，不冒充完整 Native Messaging 实机链路。

删除跨文件与 IndexedDB 不承诺原子回滚；本地失败可能已删除部分固定文件，浏览器副本与会话保留以便重试。额外用户文件和链接须手工处理，不做递归删除；部署此功能需重启新版 Executor 并重载新版扩展。

### 重放页面恢复规则验证（2026-11-03，正式修复未实施）

触发诊断为同一重放会话先收到 browser_navigate / SKILL_OBSERVATION_REQUIRED、再收到 browser_snapshot / FORBIDDEN_PAGE，最后 SKILL_NO_PROGRESS。诊断缺少具体权限拒绝分支，因此不能认定用户会话实际发生了哪一种窗口、站点或浏览器权限问题；本次验证只证明可复现的通用机制，不伪装为已取得该会话完整原始数据。

本轮仅修改测试和本记录，未改变运行时准入、Router、提示词或已安装扩展。没有新架构目录、没有用户网站关键词或优惠券特判。验证批次为本地 `replay-recovery/20261103-validation`。

**受控验证**：`pnpm --filter @octopus/browser-extension exec node --test test/navigation-recovery-feasibility.test.mjs test/browser-router.test.mjs test/skill-replay-feasibility.test.mjs` 共 23/23。真实生产 Session / Router 配合隔离 Browser API peer，导航放行仅由测试原型模拟；真实 SDK 使用 MockLanguageModelV4，不算真实浏览器端到端。

- 复现现有观察门禁阻止导航；原型仅豁免不依赖元素索引的导航，导航后观察标记仍为 true，点击/输入/选择仍须新观察。
- 允许站点内导航能够经过现有 Router；跨目标站点和从越界标签页导航仍被拒绝，不因豁免观察而扩大权限。
- 站点、窗口、scheme、隐私模式、浏览器权限五种原因全部在页面消息发出前拒绝；恢复条件后必须重新观察。
- 问答优先、未知效果、模型协议恢复阶段均不能被导航豁免绕过。
- 权限缺失阶段采用 SDK activeTools 限制，并由 Host 再次校验工具；即使受控模型请求隐藏动作，也没有页面副作用。外部提问结束当前 SDK 调用，不继续轮询拒绝页面。

首次新增 Router 测试错误地携带 Native connectionId 到本地请求，两个测试被严格 Schema 拒绝；修正测试 peer 后 17/17 通过。原输出 baseline-prototype.log 保留，修正后 baseline-prototype-fixed.log 保留；未放宽生产 Schema。后续 SDK 恢复工具验证 6/6，合并验证23/23，相关测试 eslint 通过。

**付费验证**：用户允许使用付费模型，本轮自行设置最多9次请求，实际9次（3场景×3次），qwen3.6-flash-open，maxRetries=0；外部密钥文件、合成业务、正式 createBuiltinAgent 和 SDK、多步生命周期的测试 Runtime、合成工具结果。没有真实网页动作、没有持久问答、没有正式权限恢复状态接入，因此只验证模型工具选择，不代表完整重放。

| 场景 | 实际工具序列 | 结论 |
| --- | --- | --- |
| 允许站点内导航 | navigate → snapshot → finish_run | 通过此合成恢复路径 |
| 当前页越界 | open_tab（允许站点）→ snapshot（新 tab）→ finish_run | 通过此合成恢复路径 |
| 浏览器权限撤销 | tabs → open_tab（被测试执行门禁拒绝）→ read_skill，预算内未收束 | **未通过**；单靠错误提示和下一步建议不足以约束模型 |

初版 live harness 的 safe 字段仅表示 generate Promise 正常返回；SDK 会把 execute 异常转换为工具错误，所以不能据此判定场景通过。保留原 paid-recovery.json / paid.log，并增加 paid-assessment.json 按工具轨迹及终态重评为2/3。已修正测试脚本为捕获被拒绝的工具、要求终态且无拒绝，未再次计费重跑。

**修订后的候选修复**：按具体拒绝原因给出恢复能力。允许范围内可导航但仍限每轮一个副作用，禁止自动重试未知导航；越界/窗口不匹配只选择合法目标或打开允许起始页；权限缺失只提供 ask_user_question 与 finish_run(incomplete)，Worker 同步强制限制。用户声称已恢复不是权限凭据，答案持久化后仍须重查实际权限、重新取得观察。诊断保存有限拒绝原因、tabId 与脱敏 origin，禁止完整含参数 URL；重复失败保留根因，不靠增加轮数或放宽授权消除错误。

该修订目前只通过受控门禁验证，尚未付费复测，也未验证 Host 重建、持久问答恢复、真实 Chrome/Edge 页面与正式 Native/UI 链路。原简化方案不标记整体通过，正式开发前须把这些恢复状态的测试契约补齐；不能把此轮2/3付费结果写成全部通过。

### 重放页面访问恢复正式接入（2026-11-03）

用户随后同意边开发边验证。本段为上述验证阶段之后的实现结果，保留原9次付费验证及失败结论，不将其改写为全部通过。

正式改动限于扩展重放：`page-access.ts` 提供有限原因及 origin-only 诊断，Router 保留旧传输错误码和原有权限边界；Session 放行无旧元素引用的导航，SDK 与 Worker 共用访问恢复工具集合，权限缺失只允许询问用户/报告未完成。访问状态保存在 IndexedDB，会话回答不清除它；Host 每轮准备重新检查浏览器权限，实际恢复后仍须新观察。错误卡片及复制诊断读取权威工具账本中的有限拒绝信息。录制、技能生成结构与 Executor 本轮未修改。

| 检查 | 结果与范围 |
| --- | --- |
| shared build → 扩展双目标 build | 通过；Chrome/Edge 各保留46份依赖许可；原有大 chunk 告警仍在 |
| 扩展 test / lint / typecheck | 155/155；lint/typecheck通过 |
| Router 与 Session 重点回归 | 包含导航后观察、越界拒绝、五种访问原因、权限工具白名单、未知副作用/问答保护；正式 Session 回归替代原测试专用导航豁免 |
| Chrome/Edge 正式服务 | 2/2；正式 ToolLoopAgent、Worker、IndexedDB 和 Host 重建配合 Browser API peer。确认模型请求中仅含 ask_user_question/finish_run；故意返回隐藏 open_tab 被 Worker 拒绝。回答“已恢复”但真实权限 false 时继续受限，权限 true 后新快照及完成通过 |
| 持久存储与问卷 | Chrome/Edge各通过，共4/4；新 Repository 能读到拒绝状态，现有事务、问答与表单行为回归通过 |
| 时间线界面 | 首次Chrome通过、Edge因构建尚在清理 `.output/edge-mv3/assets` 而ENOENT，属测试启动顺序错误；构建完成后同一测试2/2通过，首次失败日志保留 |
| 真实模型权限恢复复测 | 新设最多3次，本次实际1次；正式 createBuiltinAgent 接收合成 Runtime 的持久拒绝投影，qwen3.6-flash-open直接 ask_user_question，无页面动作请求。连同前阶段共10次付费请求，无自动重试 |

正式服务新增用例首次沿用了前一预算测试的2轮限制，在提问前耗尽；将该独立恢复用例设置为20轮后通过，未改变生产默认预算。首次 implementation-service.log、修正后 implementation-service-fixed.log、最终 final-integration.log（7/8，含Edge产物竞态）、final-ui-after-build.log（2/2）、final-unit.log、final-build.log、final-types.log、final-implementation-lint.log 均归原本地 replay-recovery 批次；新增付费记录为 paid-permission-implementation.json/log。单独复测未重写原 paid-recovery.json 与 paid-assessment.json。

交付边界：已验证正式代码的受控服务/持久问答/SDK恢复链路与真实模型工具选择；浏览器API peer不等于已安装扩展的真实权限弹窗验收，合成模型工具结果不等于真实业务页面成功。原用户会话只提供错误摘要，未补造其具体 FORBIDDEN_PAGE 原因。重载新扩展后重新运行可得到具体拒绝原因；旧技能的站点遗漏若实际存在仍需据新诊断修正，不自动放宽allowedOrigins。

### 真实中断会话取证与拒绝结果序列化修复（2026-11-03）

用户再次报告 browser_snapshot / SKILL_INTERRUPTED_READ。通过只读复制日常 Chrome 的扩展 IndexedDB，在独立临时 Profile 中读取指定会话，未运行用户技能、未操作业务页面、未改写原始数据库。复制前后检查源文件元数据一致，临时 Profile 随检查结束清理；报告仅包含生命周期、工具类型和有限错误码，不包含页面文本、密钥或完整业务URL。复用源码检查工具为 `test/inspect-session-lifecycle.mjs`；原始投影记录归本地 `session-interruption/20261103-investigation`。

**实际记录**：read_skill、browser_tabs、browser_open_tab 已完成；第4次模型调用为 browser_snapshot。消息索引8首先保存 `Error: SKILL_STORAGE`，索引9随后追加 `SKILL_INTERRUPTED_READ`；会话层 error 实际为 `SKILL_OUTCOME_UNKNOWN`，epoch已变化。最初复制的单个工具诊断没有携带该会话层错误。不能将其解释成用户关闭面板或 PageController 返回读取中断。

**发现并复现的缺陷**：新增 PageAccessError 构造时显式传入 optional 字段 undefined，Zod optional允许其存在，但下游 skillToolResult 的 z.json 不接受 undefined。scheme/private 拒绝缺少 origin，打开标签页时的拒绝可缺少 tabId，均会触发这一问题。拒绝结果写入事务失败后工具留在 dispatched；SDK收到被统一转换的 SKILL_STORAGE 并准备下一轮时，未决工具保护触发 SKILL_OUTCOME_UNKNOWN；中断逻辑又写入 SKILL_INTERRUPTED_READ。原始底层拒绝信息已因写入失败丢失，无法从旧记录断定究竟是哪一个拒绝分支；但正式服务注入旧对象形状，在 Chrome/Edge 完整复现相同错误链。

修复为构造诊断时省略不存在的字段，而非保留 undefined；复制诊断增加单独的 sessionError，避免只见派生工具错误。没有放宽权限、跳过严格 JSON 校验或增加模型预算。新用例覆盖五种缺字段/含凭据URL形状的严格JSON往返；正式服务分别测试旧对象复现中断和新对象正常保存拒绝、finish_run(incomplete)收束，验证没有遗留 dispatched。

- Chrome/Edge 正式服务复现与修复验证2/2；扩展全量单元156/156；shared及扩展双目标构建通过，各46份依赖许可；lint/typecheck通过。
- 只读取证工具首次lint因finally内throw失败，改为校验目标后清理且不覆盖原异常，复测通过；原失败记录保留。
- 本轮未调用付费模型。证据包括 session-lifecycle.json、reproduction-and-fix.log、unit.log、build.log、lint.log、lint-fixed.log、types.log，均位于上述本地批次。
- 前一轮验证漏掉了 optional字段缺失的错误路径，局部成功不能代表所有真实页面恢复。此次修复证明序列化与错误收束缺陷已关闭，不承诺用户实际页面没有其他访问拒绝；旧记录丢失的原因不补造。

### 无参数工具说明与复制状态恢复（2026-11-03）

读取技能绑定当前会话，查看标签页使用当前任务允许范围，两者工具输入本来就是空对象。本次仅将对应空参数卡片替换为范围说明，其他参数与返回值保留原展示。诊断复制成功显示1.5秒后恢复按钮文案，复制开始、诊断切换与卸载时清理定时器，旧异步回调不能覆盖新状态。

shared及扩展Chrome/Edge构建、扩展lint/typecheck通过。真实隔离双浏览器界面测试2/2，覆盖两类空参数说明、剪贴板失败后重试、成功状态自动恢复及第二次真实调用剪贴板桩。证据归本地 `session-copy/20261103-fix` 的build.log、browser-test.log、types.log、lint.log。本轮无付费模型调用，未改变工具权限或执行协议。

### 打开就绪与动态frame观察修复（2026-11-03）

用户确认继续同时验证打开标签页的就绪等待与frame限制。本轮未访问用户Gmail、未发送邮件、未调用付费模型，不把隔离场景通过描述为Gmail业务验收完成。

**修复前复现**：新增 `test/integration/dynamic-frame-replay.test.mjs` 使用真实PageControllerAdapter/固定上游Controller和独立Chrome、Edge页面。先观察主页面，再插入同源frame，使旧引用正确返回TARGET_CHANGED；加入跨域和同源嵌套frame后再次观察，原collectScopes抛FORBIDDEN_PAGE，两个浏览器均失败。首次输出before.log保留，不改写为通过。

**正式修改**：

- browser_open_tab与browser_navigate共用就绪等待：循环检查tab.status及接收器握手，完成后再次核对URL和加载状态，返回就绪URL/title。等待文档切换时允许重新进行无副作用身份检查；已创建/导航后失败不重新派发，保留OUTCOME_UNKNOWN。等待不能证明后续SPA不再变化，原引用检查继续生效。
- collectScopes沿用上游对不可读取iframe的不透明处理，不再仅因其存在拒绝整页观察；可访问同源嵌套文档在8层、128根、100,000元素限制内记录身份。跨域内部内容未读取；文字快照说明未读取的子页面。旧文档替换后引用继续拒绝。
- 含不可读取frame时拒绝截图，以免无法遮蔽其内部敏感内容。没有通过忽略文档身份、开放跨域或修改上游库来消除错误。

**验证结果**：

| 范围 | 结果 |
| --- | --- |
| Router定向测试 | 17/17；未完成加载不返回成功、就绪后才握手、返回最终URL；加载中关闭/越界跳转不重复打开 |
| 真实Controller合成表单 | Chrome/Edge 2/2；旧scope拒绝后新观察成功，真实按钮/字段操作完成一次本地表单提交；嵌套同源按钮实际点击一次，替换其文档后旧引用拒绝；跨域内部文本未泄露，截图被拒绝 |
| 隔离侧载正式扩展 | Chrome/Edge 2/2；实际window-panel、生产SDK/Worker/Router/Content/PageController配合受控模型，页面含延迟400ms外部脚本、跨域frame和嵌套同源frame。模型收到的打开回执title已是脚本加载后的值，随后真实观察、按钮操作和结果链路通过；不涉及真实邮箱 |
| 构建与静态检查 | shared及扩展Chrome/Edge构建通过，各46份许可；扩展lint/typecheck通过 |
| 扩展全量单元 | 158/158 |

证据归本地 `frame-readiness/20261103-fix`：before.log为原失败；after.log为初次修复后2/2；browser-integration.log为增加嵌套身份及真实扩展加载验证后的4/4；router.log、unit.log、build.log、lint.log、types.log记录检查。受控模型不等于真实模型在复杂页面上的稳定选择；真实Gmail任务的完整发送流程仍未验收。

### 适配层过度限制审查与精简（2026-11-03）

用户同意精简重复iframe判断，并要求独立审查其他限制。详细分类见[浏览器页面适配层限制审查](browser-page-adapter-review.md)。本次删除独立8层iframe门禁、标题一致性条件；普通无选择约束的动作改用已观察根身份集合检查，允许无关新增/重排根，保留文档替换/移除拒绝；无选择需求的beforeUpdate不再重复遍历根。collectScopes更名collectAccessibleRoots，仅承担隐私、录制选择与文档身份需要的遍历；总遍历预算仍在。

固定上游源码实际使用selectorMap中的元素ref，没有替扩展承担任务、窗口或文档身份，因此没有删除这些职责。选择约束/截图仍要求完整根覆盖；普通点击前置选择限制、load complete等待、全局根移除使主页面重新观察、60秒快照期限及部分前置错误归类列为候选，没有宣称都已解决。

验证：真实Controller在Chrome/Edge针对标题变化、新增根、9层同源嵌套、嵌套文档替换、跨域隐私及一次合成提交的测试2/2；选择约束回归2/2；构建后的真实隔离侧载扩展Chrome/Edge回归2/2；全量单元158/158，shared与扩展双目标构建、扩展lint/typecheck通过。无付费调用、未操作真实邮箱。

证据归本地 `adapter-review/20261103-refine`，包含adapter-tests.log、installed-panel.log、unit.log、build.log、lint.log、types.log。上一阶段“新增同源根使旧主页面动作拒绝”的断言本轮有意修订为不阻断；文档替换仍拒绝，原历史记录保留。此结果是适配层回归，不等同于真实Gmail发送验收。

### 打开主文档就绪与已知回执修正（2026-11-03）

用户的新重放在第3次模型调用browser_open_tab进入OUTCOME_UNKNOWN。只读复制指定会话确认前两步为read_skill和browser_tabs，未进入观察或点击；工具结果仅保留error，缺失已创建tabId及等待失败原因。因此不能从旧记录还原具体是超时、跳转或接收器问题。审查确定旧代码在tabs.create成功后仍要求status=complete，且把所有后续就绪失败包装成OUTCOME_UNKNOWN，丢掉已确认的创建回执。

**前后对照**：同一window-panel集成夹具加入14秒的无关图片资源，保留400ms主文档脚本、嵌套/跨域frame、真实生产SDK/Worker/Router/Content/PageController。在构建新代码前运行旧侧载产物，Chrome/Edge均从预期completed变为outcome_unknown，首次installed-before.log保留。新构建同一夹具2/2通过，并断言第一个观察请求发出时慢资源尚未结束，证明不是加大固定等待。

修改内容：

- 就绪依据改为已提交的合法主文档URL、无待提交不同URL、受信document-end接收器握手及文档身份复核。不再等待全页资源load complete；就绪探测不补注入，未有静态接收器时有界等待。
- 浏览器已确认create/update后，就绪失败返回已知tabId、applied回执与有限readiness原因，包含必要的安全access投影；不伪称目标业务完成，也不自动重新创建/导航。权限原因仍写入持久访问恢复状态，SDK/Worker工具限制继续生效。
- 模型指令明确使用回执tabId继续观察或询问，不把not_ready当成重新打开的理由。没有浏览器确认回执的真正未知结果仍保留保护。

验证：Router 19/19，含loading时接收器已就绪、重定向、关闭及缺接收器超时不补注入/不重复打开；全量单元160/160；新侧载Chrome/Edge实际扩展链路2/2；正式服务已知打开但权限未就绪→持久问题链路2/2，账本保持completed和tabId；shared/扩展双目标构建、lint/typecheck通过。首次focused lint因包装错误缺cause失败，补齐后通过，保留原日志。

证据归本地 `open-readiness/20261103-investigation`：session-lifecycle.json、installed-before.log（0/2）、installed-after.log（2/2）、router-test.log、service-receipt-test.log、unit.log、build.log、lint-focused.log、lint.log、types.log。本轮无付费模型调用、未访问用户Gmail、未发送邮件。现有未知会话不自动补造tabId或改写状态；该真实旧记录的具体等待原因缺失，仍不宣称Gmail完整发送已经验收。

### 页面等待配置与连续超时（2026-11-03）

用户确认默认每次15秒，连续3次超时才报错，并在window-panel可配置。新增等待策略契约、执行设置字段和设置页分组，仍使用现有TanStack Form/shadcn控件及唯一「保存配置」。秒数范围1–60，次数1–5；创建会话时固定策略，现有任务不因全局设置保存而重置。

同一个打开/导航请求在Router内部连续等待，每次超时进入下一窗口，不重复派发打开/导航、不增加模型调用，任一次就绪即返回。全部窗口超时后仍保存已知tab回执，将会话明确标为failed/PAGE_READY_TIMEOUT；权限拒绝和页面关闭等已知错误不按网络慢进行三次等待。SDK步时限为模型60秒余量+完整等待预算+5秒，看门狗另留30秒（不短于原90秒），避免较长等待被旧60/90秒边界提前终止。该设置只用于内置重放，Native Bridge保留原独立策略。

验证材料归本地 `page-wait-settings/20261103-implementation`：

- 单元163/163，包含默认15/3、无效范围拒绝、SDK预算公式、连续三次超时回执计数、第二窗口就绪不再等待第三次、整个过程只创建一个tab。缩短为1秒窗口的确定性用例用于验证轮次；没有用付费模型等待45秒。
- 设置页Chrome/Edge2/2：默认显示、修改20秒/4次、唯一保存、持久化/刷新、跨窗口冲突保护；后补0秒/6次不可保存的边界用例复测。浅深色设置页截图检查完成，沿用原设置样式。
- 正式SDK/Worker/IndexedDB服务Chrome/Edge2/2：最终PAGE_READY_TIMEOUT使会话失败、保留已知tab回执、不进入outcome_unknown、不额外发起模型请求；会话保存15/3策略。
- 构建后的真实隔离侧载Chrome/Edge2/2，shared和扩展双目标构建通过，扩展lint/typecheck通过。长达最大5分钟的真实网络等待未另做硬件计时验收，预算协调由统一公式和生命周期回归覆盖。
- 首次单元测试有2项旧断言只期待organize/replay两个字段，与新增默认字段不符；更新断言并增加实际配置持久化检查后163/163。原unit-first.log和unit-fixed.log分开保留。

主要日志为build.log、unit-first.log、unit-fixed.log、integration-first.log、settings-boundaries.log、installed-panel.log、types.log、lint.log。本轮无付费调用，未访问真实邮箱或发送邮件，不将此功能测试提升为Gmail发送业务验收。

### 重放等待重试单行文案（2026-11-03）

用户调用impeccable并选定单行提示：首次「等待页面就绪… 1/3」，后续「页面尚未就绪，重试中… 2/3」。分母来自实际任务配置；保留工具标题及可折叠参数，仅当前dispatched工具在running状态显示中性Marker状态行。状态使用role=status/polite，尊重减少动态效果；完成/停止/失败时不保留运行中的提示，不追加虚构模型消息。

Router在真实等待窗口开始时发送观察回调，Worker按会话epoch、运行状态、工具调用ID和dispatched状态将waitProgress保存到账本，随后发布界面刷新。回调不发起模型请求，不改变等待策略；迟到回调不能修改已结束任务。显示元数据的保存/发布失败不把已确认的页面操作转成未知效果。前端没有自设计时器来推算次数。

验证证据归本地 `retry-copy/20261103-implementation`：

- 原有Router等待回归增加真实1→2与1→2→3回调断言；全量单元163/163。
- Chrome/Edge正式服务回归2/2：每阶段元数据持久化且任务仍running，超时后迟到进度不改revision，原有模型调用数不增加。
- Chrome/Edge组件回归2/2：1/3、2/3、配置5次时3/5，终态隐藏、浅深色、360×460及200%缩放；截图检查完成。界面首次放大检查失败，查明旧测试仅加载popup固定360px样式，漏了实际window-panel的100%自适应样式；保留integration.log和zoom-inspection.log，按实际产物补齐样式后ui-correct-styles.log通过。没有通过放宽溢出断言掩盖问题。
- 构建后真实隔离侧载Chrome/Edge回归2/2（final-ui-panel.log含组件与侧载共4/4）；shared/扩展双目标构建、扩展lint/typecheck通过。impeccable机械检测design-detect.json为空发现列表；没有把检测结果当作视觉验收替代。
- 合成组件截图保存于既有skill-timeline证据位置（wait-retry-dark/light/zoom），用于验证状态行，不作为整页新视觉稿或真实业务任务截图。原视觉世界、等待预算及权限边界未改。

本轮没有付费模型调用，没有操作真实邮箱；以上验证范围是重试进度的真实性、生命周期及呈现，不是Gmail业务发送验收。

### 展开工具卡片高度与局部滚动（2026-11-03）

用户指定展开会话卡片使用最大高度及ScrollArea。JsonContent复用共享ScrollArea，最大内容视口为min(20rem,40dvh)，短数据不固定高度；无参数工具说明保持原自然高度。只改工具参数/返回JSON的展示，未修改共享UI源码、工具数据、问答或执行策略。会话主视口仍唯一；本次按用户指示增加卡片内部的局部滚动，不再用全局“只有一个scroll-area-viewport”的测试断言否决该行为。

Chrome/Edge真实浏览器组件验证2/2：360×460深色、420×900浅色长JSON高度受限，无横向溢出；滚轮先滚卡片且外层位置不动，卡片底部滚轮可衔接外层，聚焦视口后PageDown有效；短JSON高度低于100px且没有内容溢出。截图经过检查，均为合成数据，不保存用户原始Gmail截图。独立只读布局评估建议320px/40dvh上限及保留原生滚动衔接，已落实。

shared/扩展Chrome+Edge构建、扩展lint/typecheck通过；impeccable布局检测返回空发现列表。本轮只做相关界面回归，没有新增模型调用。日志归本地 `payload-scroll/20261103-implementation`，运行截图沿用skill-timeline的bounded-payload-460/900文件，既有其他状态截图保持其原来源，不作为新的批准视觉稿。

### 录制标签夹带预填正文修复（2026-11-03）

独立审查发现普通字段label.textContent会夹带嵌套textarea初始文本，用户澄清影响范围后按P2确认修复。本次只修这条标签采集缺陷，不包含同次审查的Popup恢复和文档级scroll问题。dom-recorder的关联标签及按钮文字统一调用control-semantics中的readLabelText，保留原有aria-label/placeholder优先级与最终文本脱敏；缺少有效标签使用原通用名称。不改历史录制、不发起真实模型调用。

新增Chrome/Edge真实受信录制事件用例覆盖：预填textarea点击和编辑、普通关联标签中的敏感/可编辑子节点、按钮敏感子树、公开价格说明、显式名称/占位优先级及过滤为空的回退。检查源端facts和recordingToolPage模型证据均不含合成PRIVATE标记。修复前两条新用例均失败，修复后含既有选择/输入语义回归共4/4；不是仅检查中间字符串函数，也不声称运行真实模型或验证完整业务重放。

shared及扩展双目标构建、扩展lint/typecheck通过，全量单元163/163。原始before.log、after.log、unit.log、build.log、types.log、lint.log保留在本地 `recording-labels/20261103-fix`。此修复针对预填文本节点及明确敏感子树，不泛化为普通input实时value或所有密码内容曾被采集。

### 浏览器插件连接页最近一次连接（2026-11-04）

用户选择 [连接页方案 1](../design/browser-extension-recorder/connection-status-summary-v1.png) 后，Popup 默认展示最近一次成功握手时间，并将历史异常移入折叠的连接诊断。Worker 在成功握手时写入本地时间，心跳、断开与暂停不改写该记录；实时连接状态仍由当前 Worker 会话判定。无成功记录时显示“尚无连接记录”。视觉稿批准与本次代码实现分别登记，不把合成连接截图当作真实 Host 往返。

验证：shared 构建、扩展 Chrome/Edge 双目标构建与许可收集、扩展 lint/typecheck 均通过；包级测试 166/166、Chrome/Edge 弹窗集成 2/2 通过。新增 Worker 测试覆盖成功握手、心跳不改时间、断开和 Worker 重启后仍保留记录；弹窗测试覆盖深色 360×600、历史异常默认隐藏与展开、固定页脚和可滚动到达的操作按钮。截图与设计稿对照记录位于本地 `apps/browser-extension/build/validation-evidence/connection-status/20261104-option1-3/`；连接成功态由测试受控 Worker 回包模拟，不代表日常 Profile、正式 Host 或商店安装验收。

2026-11-04，用户确认当前连接页实现符合要求，连接页界面验收成功。此结论限于本次页面与交互，不提升浏览器 Host 或正式发布门禁。

### v0.0.18 Windows Executor 发布门禁失败及重启测试夹具修复（2026-11-04）

GitHub Actions [Windows Executor 发行运行 41815523786](https://github.com/nebulaedata/dr-octopus/actions/runs/41815523786) 在 `v0.0.18`（源码 `c8fdcd8`）的验收任务中失败，发行附件任务因此跳过。原始日志显示 Executor 测试 313 项中通过 311 项、失败 2 项，均位于 `test/application-restart.test.mjs`：开发模式测试仍期待普通临时 `userData`，但 Main 已使用开发 Profile；开发监管测试的 `applicationApi` 模拟缺少现行启动路径调用的 `hostBundleSchema.parse`。原失败属于测试夹具与开发启动契约不一致，不作为 Executor 发行验收通过的证据。该运行的日志和任务状态保留在 GitHub Actions。

在后续 main 源码上，重启测试使用隔离临时开发 Profile、补齐应用 API 模拟，并等待首个子进程产生以消除固定 20 次事件循环轮询的时序竞态。验证命令：`pnpm --filter @octopus/executor exec node --import tsx --test --test-concurrency=1 test/application-restart.test.mjs`（4/4），`pnpm --filter @octopus/executor test`（313/313）、`pnpm --filter @octopus/executor lint`、`pnpm --filter @octopus/executor typecheck` 均通过。这些本地结果基于修复后的 main 工作树，不追认旧标签的失败，也不代表新标签的 Windows CI 或最终发行附件已验收；后续发布仍须观察对应新标签的工作流结果。
