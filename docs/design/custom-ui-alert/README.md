# Custom UI Alert 实际渲染截图

这些文件是已实现 React 组件的浏览器截图和验证证据，使用合成数据；不是生成式设计稿，也不是完整扩展 Popup 截图。截图确认与实施授权分别记录，截图本身不表示已获视觉批准。

| 文件                                                                     | 状态           | 适用范围                            | 状态日期   | 原因                               | 替代关系 |
| ------------------------------------------------------------------------ | -------------- | ----------------------------------- | ---------- | ---------------------------------- | -------- |
| [alert-variants-light-v1.png](alert-variants-light-v1.png)               | pending review | 360 CSS 像素，浅色，三种 Alert 状态 | 2026-10-30 | 按用户要求展示当前组件真实效果     | none yet |
| [alert-variants-dark-v1.png](alert-variants-dark-v1.png)                 | pending review | 360 CSS 像素，深色，三种 Alert 状态 | 2026-10-30 | 同一组件切换 dark 主题后的真实效果 | none yet |
| [alert-danger-expanded-light-v1.png](alert-danger-expanded-light-v1.png) | pending review | 浅色，danger 详情展开               | 2026-10-30 | 验证真实诊断组件与操作区域排列     | none yet |

来源与生成方法：Microsoft Edge 无头浏览器，Playwright 截图，deviceScaleFactor=2；esbuild 编译当前 Alert、Button、WorkflowDiagnosticDetails，加载扩展已构建的 popup CSS。独立预览未运行 Popup 的外壳及其主题初始化，按钮跟随共享样式的默认 primary 色，不能用本截图替代完整业务页验收。

截图请求记录：用户要求核实 `border-warning` 是否为 Tailwind 默认变量，并展示最终渲染截图。该过程未调用图像生成模型、未使用图像生成提示词、未修改截图像素。

颜色来源：共享 `globals.css` 的 `@theme inline` 将 `--color-warning` 绑定到项目自定义 `--warning`。浅深色分别设置不同 token；浏览器计算值和构建 CSS 证据见 [render-evidence-v1.json](render-evidence-v1.json)。当前使用的 `border-warning/50` 已生成，计算边框宽度为 1px、颜色透明度为 0.5。

组件实现：[Alert](../../../packages/custom-ui/src/components/alert/index.tsx)。接入清单：[custom-ui-alert-migration.md](../../refactoring/custom-ui-alert-migration.md)。消费方架构：[browser-extension-recorder.md](../../architecture/browser-extension-recorder.md)。

## success 与 SettingsToast 接入验证

| 文件                                                                     | 状态       | 适用范围                         | 状态日期   | 原因                                           | 替代关系                                                                 |
| ------------------------------------------------------------------------ | ---------- | -------------------------------- | ---------- | ---------------------------------------------- | ------------------------------------------------------------------------ |
| [settings-toast-success-dark-v1.png](settings-toast-success-dark-v1.png) | superseded | 真实扩展模型设置页，顶部成功通知 | 2026-10-30 | 用户同意职责划分后接入，原有布局与通知行为保留 | [settings-toast-success-dark-v2.png](settings-toast-success-dark-v2.png) |

| [alert-success-layout-light-v1.png](alert-success-layout-light-v1.png) | superseded | 浅色组件测试页，包含 success | 2026-10-30 | 长内容、图标、动作与关闭组合实际渲染 | [alert-success-layout-light-v2.png](alert-success-layout-light-v2.png) |

| [alert-success-layout-dark-v1.png](alert-success-layout-dark-v1.png) | superseded | 深色组件测试页，包含 success | 2026-10-30 | 成功正文对比度与组合布局实际渲染 | [alert-success-layout-dark-v2.png](alert-success-layout-dark-v2.png) |

新增截图由本仓库 Playwright 集成测试直接生成，未编辑像素；数据为隔离 Profile 与本地合成服务。设置页截图使用完整 Popup 外壳与实际主题；布局页使用真实组件与生产 CSS。无图像模型或生成提示词。原三状态 v1 截图保留其历史范围，不代表 success 当前效果。

实施授权：用户于 2026-10-30 同意 Alert 负责展示、SettingsToast 拥有悬浮与计时生命周期。新截图仍为 pending review。成功正文颜色仅在 Alert 内调整，不改共享 theme；浏览器实测默认浅色 6.47:1、深色 9.88:1。最终 6 项集成结果与原始比值日志见 [success-integration-v1.log](success-integration-v1.log)。测试命令与职责契约见 [接入清单](../../refactoring/custom-ui-alert-migration.md)。

2026-10-30 用户指出 success 文字色不正确，参考 Ant Design：上述 success v1 的正文/标题颜色失效，标记 revision required；布局、图标位置和交互可继续作为参考。替换稿尚待本轮真实截图；replacement: none yet。

## Ant Design 状态色分工修订

2026-10-30 用户明确要求 success 文字色参考 Ant Design，本轮采用常规前景色标题/正文与绿色图标，保留绿色背景和边框。v1 失效范围为 success 的标题与正文颜色，已由 v2 替代；原始文件及日志保留。来源为 Ant Design 官方 components/alert/style/index.ts 的 colorText、colorSuccess 和 colorSuccessBg 分工；实现继续使用本项目语义 token。

| 文件                                                                     | 状态           | 适用范围               | 状态日期   | 原因                                | 替代关系                                                                                             |
| ------------------------------------------------------------------------ | -------------- | ---------------------- | ---------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [settings-toast-success-dark-v2.png](settings-toast-success-dark-v2.png) | pending review | 真实设置页深色成功通知 | 2026-10-30 | 常规标题/正文色，图标独立使用成功色 | 替代 [settings-toast-success-dark-v1.png](settings-toast-success-dark-v1.png)；replacement: none yet |
| [alert-success-layout-light-v2.png](alert-success-layout-light-v2.png)   | pending review | 独立组件布局，浅色     | 2026-10-30 | 常规标题/正文色，图标独立使用成功色 | 替代 [alert-success-layout-light-v1.png](alert-success-layout-light-v1.png)；replacement: none yet   |
| [alert-success-layout-dark-v2.png](alert-success-layout-dark-v2.png)     | pending review | 独立组件布局，深色     | 2026-10-30 | 常规标题/正文色，图标独立使用成功色 | 替代 [alert-success-layout-dark-v1.png](alert-success-layout-dark-v1.png)；replacement: none yet     |

截图由实际 Chrome 集成测试生成，使用隔离 Profile 和合成数据，未编辑像素，无图像生成模型或提示词。新稿 pending review，不代表用户已批准截图所有细节。Chrome/Edge 均验证标题/正文等于正常前景色、图标颜色独立；对比度浅色 17.54:1、深色 16.79:1。原始日志见 [success-integration-v2.log](success-integration-v2.log)。

## 全应用迁移运行时证据

2026-10-30 用户授权全部应用迁移。以下为 Chrome + Playwright 对实际 Web 服务设置页的截图，使用合成 HTTP 夹具，无真实凭据、无图像生成、未编辑像素。截图是实施验证证据，视觉状态均为 pending review；不替代既有设计目标，replacement: none yet。

| 文件 | 状态 | 范围 | 日期 | 原因 | 替代关系 |
| --- | --- | --- | --- | --- | --- |
| [web-save-success-v1.png](web-save-success-v1.png) | pending review | Web 服务设置页 Alert | 2026-10-30 | 实际迁移效果与换行验证 | none yet |
| [web-warning-light-320-v1.png](web-warning-light-320-v1.png) | pending review | Web 服务设置页 Alert | 2026-10-30 | 实际迁移效果与换行验证 | none yet |
| [web-warning-dark-320-v1.png](web-warning-dark-320-v1.png) | pending review | Web 服务设置页 Alert | 2026-10-30 | 实际迁移效果与换行验证 | none yet |
| [web-danger-320-v1.png](web-danger-320-v1.png) | pending review | Web 服务设置页 Alert | 2026-10-30 | 实际迁移效果与换行验证 | none yet |

[Web 四项回归](web-migration-validation-v1.log) 覆盖确认后保存、success 反馈、显式重启、恢复继承、320/390px、三种配色与明暗模式及 danger 重试入口；[Executor 三项回归](executor-migration-validation-v1.log) 覆盖恢复详情/确认/恢复成功和连接设置。Browser plugin not available，沿用仓库 Playwright 与系统 Chrome。迁移及已知测试限制见 [清单](../../refactoring/custom-ui-alert-migration.md)。
