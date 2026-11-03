> 历史实现复核：以下记录对应 2026-10-30 至 2026-10-31 的旧工作流界面，保留原日期、失败及证据路径，不作为当前视觉目标或当前代码通过证明。当前规范见 [DESIGN.md](DESIGN.md)，当前验收见[验证矩阵](../../docs/poc/executor-validation.md)。本次归档未重新执行这些测试。

# 最近/全部工作流与列表样式复核

2026-10-31 · final result: passed（本地受控验证）。用户确认[三屏视觉稿](../../docs/design/browser-extension-recorder/history-manifest.md#docs-design-browser-extension-recorder-workflow-recent-all-compact-v1-png)后接入，并继续指定py-2、Separator my-2、查看全部最右、成功状态绿色；这些文字修订覆盖原图对应区域，其余设计保留。

实现截图：[最近工作流深色](build/validation-evidence/workflow-lists/run-20261031-6b70d904/chrome-workflows/recent-dark.png)、[最近工作流浅色](build/validation-evidence/workflow-lists/run-20261031-6b70d904/chrome-workflows/recent-light.png)、[全部工作流](build/validation-evidence/workflow-lists/run-20261031-6b70d904/chrome-workflows/all-light.png)、[短窗口](build/validation-evidence/workflow-lists/run-20261031-6b70d904/chrome-workflows/all-short.png)、[录制已整理](build/validation-evidence/workflow-lists/run-20261031-6b70d904/chrome-recordings/organized-short-dark.png)。Edge对应截图同批归档。原图为三屏概念板，实际截图360×600/360×420、1倍像素密度；按现有产品字体/字号及逻辑区域比较，不要求10条同屏塞下。

源图与实现同次查看比较：品牌/Tab固定，最近标题及历史/设置/查看全部同一行；只在全部页显示搜索。列表使用同一PopupListItem，内部8px padding及48px最小高度；双行文本按现有行高自然增高，不用缩小字号强制48px。外层上下8px，Separator上下各8px，容器gap仍为0。查看全部最右；已整理/已发布使用success语义绿，草稿保持中性。图标/品牌沿用原资源，无新增运行时位图。长列表正文滚动，底部加载更多与搜索保持可达。

分页验证：45条同时间数据稳定按ID排序，首页只取10条；全部页20/40/45条加载，无重复；搜索能找到未加载尾页记录；快速改查询、空结果、清空搜索、详情返回查询与加载范围均通过。保存后重排最初触发浏览器滚动锚定将视口拉回顶部，最终仅在全部列表正文禁用该锚定，沿用PopupPage原位置恢复，双浏览器回归通过；诊断期间的额外事件监听和测试调试代码已移除。

shared及双目标构建、lint/typecheck、150项包级测试通过；相关浏览器10项通过，最终绿色状态修改后模型设置/录制关联/新列表6项复验通过（有交集，不能相加作为独立覆盖数）。原始行高断言误把“最小48px”当成上限52px，改为验证8px内边距、48px最小值及比原64px紧凑；未通过延长等待或删除位置断言掩盖滚动问题。原失败日志和最终结果见[证据摘要](build/validation-evidence/workflow-lists/run-20261031-6b70d904/result.json)。没有真实提供商调用，也没有更改录制/整理/发布状态含义。

---

# 引导式整理实现复核

2026-10-31 · final result: passed（本地受控验证）。用户已批准两张细化稿并明确开始实施；真实提供商提问质量与本轮人工体验验收未因此视为完成。

视觉目标：[提问状态v2](../../docs/design/browser-extension-recorder/history-manifest.md#docs-design-browser-extension-recorder-workflow-guided-question-states-v2-png)、[继续与预览v2](../../docs/design/browser-extension-recorder/history-manifest.md#docs-design-browser-extension-recorder-workflow-guided-continuation-states-v2-png)，均保持approved。原生成图1647×955，是三屏状态板；按每个弹窗360×600/360×420逻辑布局比较，不用画板外距或生成图字号替换已有产品token。实现截图为CSS像素1:1，无截图缩放修改。

实现证据：[浅色提问](build/validation-evidence/guided-organization/run-20261031-9a175a2e/chrome/question-top-light.png)、[深色说明](build/validation-evidence/guided-organization/run-20261031-9a175a2e/chrome/question-dark.png)、[短窗口](build/validation-evidence/guided-organization/run-20261031-9a175a2e/chrome/question-short.png)、[预览上部](build/validation-evidence/guided-organization/run-20261031-9a175a2e/chrome/preview-top-dark.png)、[预览操作区](build/validation-evidence/guided-organization/run-20261031-9a175a2e/chrome/preview-dark.png)。Edge同状态在同批edge目录。源图与实现截图已在同次查看中比较；副本均为隔离合成数据，不使用日常Profile。

字体、层级和字号沿用现有Popup；证据在前、问题/选项在后，只有正文滚动，固定品牌/Tab/导航/操作区可达。明暗配色与Button/RadioGroup使用现有语义色，相关记录按本地事件标签显示，不以模型重写的意图冒充证据。问题原因放在标题悬停与读屏描述，避免重复小字挤出选项。短窗口可滚动查看说明，确认按钮始终可用。无新图像资产，保留品牌及现有Lucide图标。

预览以当前7步合成流程检查长内容，不能与3步示意图逐行比较。完成判断有“修改”入口，已答摘要可改；参数显示只读摘要，具体参数编辑沿用保存后的编辑页，因此没有给只读参数行画可点击箭头。此实现边界已同步开发文档。仍可后续把参数编辑提前到预览，但本轮未另建重复表单。

交互已覆盖：选择不发送请求、逐题提交、暂缓不等于同意、等待释放Host、Worker重启恢复、显式发送补充说明、暂缓草稿保存后继续完善、过期回答拒绝、人工完成方式发布、名称/未提交回答的放弃确认。结束时返回工作流列表，执行前确认未解除。没有自由聊天输入框。

验证：151项包级测试通过；完整工作流浏览器套件22/22通过；最终小改后引导UI/真实IndexedDB迁移专项4/4通过。shared及Chrome/Edge构建、扩展lint/typecheck、共享UI typecheck与新RadioGroup lint通过。初次CDP层级错误、配置对象比较误判、缺少Alert description及修正前lint记录与最终日志均保留在[证据目录](build/validation-evidence/guided-organization/run-20261031-9a175a2e/result.json)。原始失败不覆盖，未放宽时限或移除关键断言。

本轮真实提供商请求数为0；后续真实模型验收须另行申请额度。没有发布、打包安装器、重放业务动作或更改现有商店/硬件验收结论。

---

# 步骤就地核对实现复核

## 录制整理状态复核

2026-10-30 按用户收敛并授权的三态方案实施：首页、全部列表、详情共用“待整理 / 整理中 / 已整理”，详情按钮对应“整理为工作流 / 整理中… / 重新整理”；关联产物可进入工作流Tab。沿用既有中性Badge、spinner、固定footer与ScrollArea，缺口在元信息独立提示。此为现有控件的定向修订，无新增视觉稿或历史稿状态变更。

运行截图：[待整理及独立缺口提示](build/validation-evidence/recording-workflow-state/chrome/pending-dark.png)、[整理中详情](build/validation-evidence/recording-workflow-state/chrome/running-detail-dark.png)、[已整理列表](build/validation-evidence/recording-workflow-state/chrome/organized-dark.png)、[短窗口深色](build/validation-evidence/recording-workflow-state/chrome/organized-short-dark.png)、[短窗口浅色](build/validation-evidence/recording-workflow-state/chrome/organized-short-light.png)。Edge证据在同级edge目录。实测360×600和360×420，正文单独滚动、按钮可达、无外层滚动、无页面错误。Browser plugin not available，使用仓库现有Playwright扩展验证。

140项包级测试通过；新增三态UI双浏览器2/2，原有一键整理及IndexedDB持久化回归4/4。覆盖实际来源关联、任务状态优先、失败/取消保留已有工作流、重复整理新增草稿、最新产物删除后回退到其它存续产物、全部删除后待整理、清理整理历史不影响产物判断，以及查看产物跳转。新增测试首轮因隐藏列表与详情含同文案导致定位不唯一，收窄到详情导航后通过，原始日志保留。未调用真实模型、修改日常Profile或提升商店/重放验收状态。

最终源码重新构建Chrome/Edge后，三态UI复验2/2通过，lint/typecheck和格式检查通过；最终截图及结果保留于上述证据目录的final/chrome、final/edge，初轮截图和日志未覆盖。

## 步骤核对既有复核

2026-10-30 追加局部优化：按用户提供的实现截图，将详情页脚核对项与执行前确认提示改为单行两端对齐；发布成功返回工作流列表，保存草稿或发布失败保留编辑页。Chrome/Edge 隔离测试覆盖两端对齐、360×600 深浅色、360×420 短窗口、发布冲突、成功返回和重新打开已发布工作流。Browser plugin not available，使用仓库已有 Playwright 扩展测试。运行证据：[Chrome 深色](build/validation-evidence/workflow-footer-publish-2026-10-30/chrome/step-review-dark.png)、[短窗口](build/validation-evidence/workflow-footer-publish-2026-10-30/chrome/step-review-short.png)、[发布后列表](build/validation-evidence/workflow-footer-publish-2026-10-30/chrome/published-list.png)；Edge 在同级 edge 目录。截图是实现验证证据，未新增视觉稿或改变历史稿状态。

- 日期：2026-10-30；final result: passed。
- 视觉目标：[已批准方案2](../../docs/design/browser-extension-recorder/history-manifest.md#docs-design-browser-extension-recorder-workflow-step-review-footer-v1-png)。原图1368×1150，为两个扩展画面的设计板；按每个画面的逻辑布局与既有360px弹窗比较，不把设计板外框或生成图字号作为产品像素规范。
- 实现截图：[列表深色](build/validation-evidence/step-review/final/chrome/step-review-list-dark.png)、[详情深色](build/validation-evidence/step-review/final/chrome/step-review-dark.png)、[详情浅色](build/validation-evidence/step-review/final/chrome/step-review-light.png)、[短窗口](build/validation-evidence/step-review/final/chrome/step-review-short.png)。对应Edge证据在同级edge目录。
- 实现尺寸：360×600 CSS/图像像素、deviceScaleFactor=1；短窗口360×420。目标与实现同次打开比较，重点检查列表状态、详情原因/证据、固定页脚和可滚动正文。

本次追加检查：138 项包级测试、lint、typecheck、shared 构建和 Chrome/Edge 完整构建通过；Impeccable detector 无发现。补充集成回归共 8 项，6 项通过（双浏览器成功条件、步骤核对/发布返回、任务生命周期），2 项完整编辑流程在已完成发布后触及原有 120 秒上限而取消，不能计为通过；未放宽超时，也未据此推断为既有问题。完整日志见 [integration.log](build/validation-evidence/workflow-footer-publish-2026-10-30/integration.log)。

## 比较结果

没有发现阻断使用的布局或状态问题。字体与字号沿用当前产品；标题、目标字段、来源和辅助信息层级清楚。品牌、Tab、导航和页脚固定，正文ScrollArea满宽，短窗口核对框与两个操作按钮完整可见。

配色沿用当前深浅色语义token；已核对采用现有secondary Badge加绿色Check，保留低干扰视觉。相对生成稿的整块绿色Badge，这是沿用产品组件的轻量呈现。图标沿用现有Lucide和品牌资源，无新增位图素材。表单保留目标说明/定位描述及依赖编辑，因此正文比示意稿更长；核对和来源仍在同一详情上下文，未改变确认位置或数据流程。

文案按用户已确认的灵活规则调整；总确认严格为“已核对参数、成功条件”。模型补充是来源，待核对/已核对是状态；确认不代表执行完成。取消/应用/保存/重开、相关修改撤销确认及后台过期审批拒绝均通过Chrome/Edge自动化。

## 验证范围

138项包级测试通过，shared与双目标构建、lint/typecheck通过。新增就地核对、成功条件界面、IndexedDB版本/审批、原有编辑器和任务生命周期共10项双浏览器用例通过；最终构建后新增核对用例复验2/2通过。未执行真实模型请求、日常Profile操作、业务重放或商店验收。2026-10-30用户明确确认第二阶段人工验收通过，并说明另行修改了一些逻辑代码；视觉目标仍保持approved。上述自动化记录对应此前验证版本，不能视为用户后续逻辑修改已被重新自动化验证。

## 后续旧路径清理

2026-10-31仅清理已退役协议、内部状态/导出与无消费者代码，视觉目标和布局不变；不重新生成视觉稿。149项包级及14项受影响浏览器回归通过，构建、lint/typecheck通过。完整证据见 [cleanup result](build/validation-evidence/workflow-cleanup/run-20261031-dc600c79/result.json)，不覆盖此前引导式整理的截图与真实模型验证边界。
