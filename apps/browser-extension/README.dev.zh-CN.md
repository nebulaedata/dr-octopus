# Browser Extension 开发与实时调试

本文件维护插件的本地调试步骤。安装与连接见 [INSTALLATION.md](INSTALLATION.md)，完整构建见[仓库开发指南](../../README.dev.zh-CN.md#浏览器插件构建)，打包发布见 [RELEASE.md](RELEASE.md)，开发约束见 [AGENTS.md](AGENTS.md)。

## 1. 启动开发监听

准备 Node 22.19+、pnpm 11+，首次开发先在仓库根目录执行 `pnpm install`。随后按浏览器选择一个命令：

```powershell
pnpm dev:browser-extension          # Chrome
pnpm dev:browser-extension -b edge  # Edge
pnpm dev:browser-extension:only     # 已独立启动同工作区 dev:executor 时
```

命令先构建 shared，随后编排同工作区的隔离 Executor 与 WXT。开发 Host 名包含工作区摘要，数据位于 `~/.dr-octopus/executor-dev/<workspace-key>/electron`，浏览器 Profile 位于 `~/.dr-octopus/executor-dev/<workspace-key>/browser/<browser>`。首次使用仍需在开发 Executor 明确启用桥接；自动安装不代替授权。保持终端运行，Ctrl+C 结束本次会话。终端 localhost 是开发服务器，插件页面从扩展入口打开。

开发入口使用已锁定的 Playwright 依赖打开本机 Chrome/Edge 的专用 Profile，通过私有调试管道加载扩展；不修改日常 Profile。浏览器未安装或企业策略阻止加载会明确失败。dev:browser-extension:only 不启动 Executor，连接需要另行运行同工作区 pnpm dev:executor。

扩展界面支持 WXT 热更新。更改共享协议、Native 连接核心或 Executor 主进程后，停止该开发会话并重新运行命令，重新构建契约和 Host 包。复用已有实例不会声称已载入新的 Main/Host 代码。

开发模式固定使用已验证的侧载身份，不继承商店打包模式；生产构建仍按 BROWSER_IDENTITY_PROFILE 选择渠道。开发数据和 Profile 不在 build/.wxt/.output 中，清理构建输出不会删除它们。

退出对应开发会话后，可清理注册（保留 Profile 和数据）：

```powershell
pnpm dev:browser-extension --cleanup-registration
# 工作区已删除时，在另一份仓库按原 Host 名末尾的 16 位 key 清理：
$workspaceKey = Read-Host '原工作区的16位 key'
pnpm dev:browser-extension --cleanup-registration --workspace-key $workspaceKey
```

清理只删除指向该开发目录的 Chrome/Edge 注册；活动进程、正在进行的维护或不同路径的注册会阻止清理，不影响正式 Host。

## 2. 加载开发版插件

默认命令自动加载专用 Profile；手动调试也必须使用该开发 Host 对应的 Profile 与独立数据，约束见 [AGENTS.md](AGENTS.md#验证规则)。

| 浏览器 | 扩展管理页            | 从仓库根目录定位的开发产物                      |
| ------ | --------------------- | ----------------------------------------------- |
| Chrome | `chrome://extensions` | `apps/browser-extension/.output/chrome-mv3-dev` |
| Edge   | `edge://extensions`   | `apps/browser-extension/.output/edge-mv3-dev`   |

1. 在扩展管理页开启「开发者模式」。
2. 点击「加载已解压的扩展程序」，选择上表中包含 manifest.json 的目录。开发产物目录带 `-dev` 后缀。
3. 将 Octopus Browser Bridge 固定到工具栏，点击图标打开 Popup。

当前工作区位于 `D:\code\github\dr-octopus` 时，Chrome 完整路径为 `D:\code\github\dr-octopus\apps\browser-extension\.output\chrome-mv3-dev`；其他检出目录使用自己的仓库路径。

## 3. 调试 Popup 前端

1. 点击工具栏插件图标，打开 Popup，在弹窗内部右键 →「检查」。
2. 在 Console 查看前端日志和报错，在 Sources 设置断点；可用 Ctrl+P 搜索源文件。
3. 修改对应 React 组件或样式并保存，观察弹窗热更新；弹窗关闭后可重新点击图标打开。

常用入口包括 [ExtensionPopup.tsx](src/features/popup/ExtensionPopup.tsx)、[ConnectionPanel.tsx](src/features/connection/ConnectionPanel.tsx)、[RecordingPanel.tsx](src/features/recording/RecordingPanel.tsx) 和 [style.css](entrypoints/popup/style.css)。

Popup 页面依赖扩展 API 和消息来源校验，直接在普通网页中打开开发服务器地址不能替代实际扩展调试。

## 4. 调试后台 Service Worker

在扩展管理页找到插件，点击卡片里的「Service Worker」检查链接，打开后台 DevTools。后台入口为 [background.ts](entrypoints/background.ts)，页面消息路由位于 [browser-router.ts](src/browser-router.ts)。

在 Console 查看连接和消息异常，在 Sources 设置断点，然后从 Popup 或已授权的工具调用触发对应流程。修改后台代码后会重新加载，内存状态和连接可能重建。打开 Worker DevTools 会影响其休眠行为，验证休眠与唤醒时需关闭调试器。

## 5. 调试内容脚本与页面控制

内容脚本运行在目标网页中。[content.ts](entrypoints/content.ts) 是入口，[page-controller-adapter.ts](src/page-controller-adapter.ts) 负责 PageController 适配，网页录制运行时位于 [recording-content.tsx](src/lib/recording/recording-content.tsx)。

1. 在开发 Profile 中打开允许访问的普通 HTTP/HTTPS 网页，确认插件具有该站点权限。
2. 在目标网页按 F12，进入 Sources → Content scripts，找到插件脚本；也可用 Ctrl+P 搜索文件并设置断点。源码映射不可用时可先在生成的 content.js 中定位。
3. 在 Console 执行上下文下拉框中选择本扩展的内容脚本上下文，查看页面侧日志与变量。
4. 修改并保存后，若旧网页未更新，先结束当前任务或保存并停止录制，再刷新测试网页，重新触发操作。

调试 `page-controller-adapter.ts` 时，通过配套测试 Executor/Host 的已授权 MCP 客户端发起快照、点击等工具调用；仅打开 Popup 不会触发这些页面动作。调试录制浮条时，从 Popup 的「录制」Tab 开始一次测试录制。纯录制不依赖 Executor 在线。

## 6. 保存后如何生效

| 修改范围                                    | 更新方式                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| Popup React 组件、样式                      | WXT/Vite 热更新；不承诺所有组件状态均保留                              |
| 内容脚本、PageController 适配、网页录制浮条 | WXT 重载内容脚本；目标网页仍有旧行为时刷新测试页                       |
| 后台 Service Worker                         | 重新加载后台，内存状态和连接可能重建                                   |
| wxt.config.ts、权限、身份配置               | 确认终端已重建；必要时重启开发命令、在扩展管理页重新加载并刷新测试网页 |
| packages/shared                             | 当前命令只在启动时构建 shared；修改后停止并重新运行开发命令            |

## 7. 常见问题

- **保存后界面不变**：确认终端仍运行且无编译错误，扩展加载路径是 `*-mv3-dev`；重新打开 Popup，必要时重新加载扩展并刷新测试网页。
- **断点不命中**：确认调试窗口对应 Popup、Worker 或目标网页，文件属于当前开发产物，并已触发对应功能。内容脚本需在允许访问的 HTTP/HTTPS 网页上运行。
- **插件已加载但 Native Host 未连接**：默认命令会启动隔离执行器和插件；dev:browser-extension:only 仅启动插件。先确认使用同工作区的 dev:executor、已启用桥接，再按 [INSTALLATION.md](INSTALLATION.md#连接条件) 核对配套测试 Executor/Host、桥接与授权。
- **找不到插件源码或断点偏移**：检查 DevTools 是否启用 JavaScript source maps，并查看终端的 sourcemap 警告。启动成功不等于源码映射或浏览器内热更新已经完成验证。

## Skill Agent 开发与验证

整理和重放共用 `src/lib/builtin-agent` 的 ToolLoopAgent、Worker 会话与 IndexedDB 账本；模型配置独立位于全局设置，短连接测试仍走设置 Port。完整契约见[统一方案](../../docs/architecture/browser-skill-unified-agent.md)，视觉状态见 [DESIGN.md](DESIGN.md)。

先从仓库根构建 shared、Chrome/Edge 扩展及 Executor，再运行受影响检查：

```powershell
pnpm --filter @octopus/browser-extension test
pnpm --filter @octopus/browser-extension test:skill-agent
pnpm --filter @octopus/browser-extension test:settings
pnpm --filter @octopus/browser-extension test:recording
pnpm --filter @octopus/browser-extension test:popup
pnpm --filter @octopus/executor exec node --import tsx --test --test-concurrency=1 test/integration/browser-skills.test.mjs
```

`test:skill-agent` 覆盖 SDK 外部工具、同轮提问/动作门禁、预算、重复答案、旧世代、真实 IndexedDB 事务和保存重试；包含 Questionnaire/TanStack 多字段表单校验。`test:settings` 验证独立探针、密钥保留、模型列表和取消。完整 Native 用例使用唯一测试 Host、隔离数据目录及浏览器 Profile，完成录制→整理提问→保存→打开目录请求→手改→重读→重放提问→页面查询；它拦截已验证的 Main shell.openPath 以避免打开 Explorer，不代表人工文件夹体验验收。

以上命令使用受控模型和合成网页，不读真实密钥、不调用真实提供商。GUI 用例串行，Executor 构建和原生测试串行；日志和截图统一保存在 Executor 验证材料目录。执行结果与未覆盖范围记录在[验证矩阵](../../docs/poc/executor-validation.md)。

模型依赖固定为 ai 7.0.155 与 @ai-sdk/openai-compatible 3.0.80。provider-utils 5.0.70 未附 LICENSE，原文从对应官方标签取得并保存在 public/licenses/ai-sdk-provider-utils-5.0.70.txt；许可证脚本检查固定摘要后随产物交付。不得通过跳过许可证步骤发布。

旧 workflow 编译/编辑/发布及历史兼容路径已删除。更新或重新加载扩展清理 octopus-workflows、workflowJob/workflowHistory；Skill 会话库升级删除已导入旧摘要和迁移标记，保留新版会话与技能关联。后续真实模型质量验证须另行提出场景、调用上限和费用授权，旧编译测试额度不沿用。累计上下文使用 SDK 的 responseMessages；response.messages 仅为最后一步。

离线闭环见[方案](../../docs/architecture/browser-skill-offline.md)。`test:skill-agent`包含离线导出/缓存确认界面；`test/skill-offline.test.mjs`覆盖副本完整性与ZIP内容。完整Native用例先暂停桥接，验证整理/导出/重放，再恢复连接显式保存到磁盘、手改及重读，不使用真实模型。

### 智能体侧边栏验证

构建后运行 `pnpm --filter @octopus/browser-extension test:window-panel`。测试使用隔离Chrome/Edge Profile、临时扩展副本和本机合成模型服务，覆盖原生侧栏、Popup入口、关闭恢复、多窗口隔离、SDK问答和真实PageController观察。不会调用配置中的真实模型，测试证据写入 `build/validation-evidence/window-panel`。运行前需完成shared及扩展双目标构建，保持与界面测试串行，避免构建清空测试读取的产物。
