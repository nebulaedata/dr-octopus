# Product

> 2026-11-03 按已确认的统一 Agent、侧边栏与浏览器优先保存方向收敛。架构见[统一方案](../../docs/architecture/browser-skill-unified-agent.md)，视觉见 [DESIGN.md](DESIGN.md)。目标、实施与验收分别表述。

<!-- impeccable:product-schema 1 -->

## Platform

web（Chrome/Edge 浏览器扩展，WXT/MV3；Popup、窗口级 Side Panel 与 Content Script 浮条均为 Web 技术栈）

## Users

扩展主体用于连接 Executor，连接功能是默认入口。录制功能面向**在网页上重复执行业务流程的用户**（运营、财务、客服等）。他们的任务：手动演示一次 → 智能体自主整理并按需澄清 → 获得可维护的 Skill → 智能重放。用户维护技能文件，不维护复杂步骤 DAG。

主体职责：扩展是 Dr.Octopus Agent 系统的 Browser Bridge 组件，为本机 Executor 提供有限 Browser 工具；该路径的用户是 Dr.Octopus Agent 使用者，与录制用户路径相互独立、互不阻塞。

## Product Purpose

让用户把重复性网页业务流程演示一次，获得可维护、可重放的技能：

1. 录制用户在明确授权的 Tab/站点内的网页操作与浏览器级事件（Tab 创建/切换/关闭等）。
2. ToolLoopAgent 自主分析脱敏录制，必要时提问，生成 `SKILL.md` 与轻量 `workflow.json`，不要求逐步骤审批/发布。
3. ToolLoopAgent 使用现有 PageController 工具重放，缺少本次参数时主动提问。默认在浏览器保存技能，可导出或显式保存到本机目录。Executor 离线不阻止录制、整理及浏览器副本重放；已关联目录的技能优先读当前磁盘，离线使用缓存需明确确认。模型与网站网络仍需可用。

成功意味着：业务用户不依赖开发者即可自动化自己的网页流程，且全程不牺牲隐私与控制权。

## Positioning

邻近产品无法如实复制的机制组合：

- **本地技能维护**：录制事件不经 Native Host、源端脱敏；生成后默认保存在浏览器，也可导出或关联本机目录维护，静态校验不冒充重放成功。
- **明确的采集边界**：只录制用户明确选择的 Tab/站点；安装权限不等于全局采集同意。
- **受限会话、无任意脚本**：MessageScroller 展示任务时间线，Questionnaire 仅接受当前工具问题的回答；会话由窗口级 Side Panel 承载，无自由聊天或任意 JS。密钥经显式保存留在受信扩展存储，按接口绑定，不进入 Content、技能和日志。
- **统一智能体运行机制**：两阶段共用 ToolLoopAgent 会话能力、分别配置工具，页面操作复用 PageController。

## Operating Context

- 运行环境为 Chrome/Edge（MV3），Popup 管理连接与录制，window-panel 侧边栏管理会话、历史与模型设置；录制期间的控制在网页 Content Script 浮条（计时、步骤数、暂停、停止，不阻断页面交互）。
- 录制/重放与 Bridge 连接是独立生命周期；扩展需容忍 Executor 离线、浏览器重启（标记中断，不自动恢复）、侧边栏运行文档关闭或失效。
- 一次只允许一个活跃的本地技能重放；录制与重放互斥。
- 一期范围限定顶层文档；frame 内流程标记不支持并提示人工补充，不声称完整捕获。

## Capabilities and Constraints

- 当前实现已接入录制、浮条、列表/详情、统一 Skill 整理与重放、窗口级侧边栏、会话问答与历史、浏览器副本和可选本地目录。受控闭环与各项局部验证不能替代完整真实网站或发行验收；证据和待办只维护在[验证矩阵](../../docs/poc/executor-validation.md)。旧步骤编辑/审批/发布与固定引导问卷不再作为当前能力。
- 协议版本 4，单 JSON 不超过 256 KiB；截图不超过 128 KiB、边长不超过 1280。
- 权限最小化：仅 nativeMessaging、storage、alarms、scripting、截图所需 `<all_urls>`、录制所需 webNavigation 及窗口级会话所需 sidePanel；不申请 debugger/cookies/externally_connectable。
- 任意脚本执行明确关闭；不为此新增 debugger/userScripts。
- 不修改 `packages/agent` 与共享 shadcn 源组件；扩展私有协议留在本应用。
- 明确不做：录制/重放 MCP 接口、自由聊天、确定性网页重放引擎、Chrome 原生 UI 逐键监听、桌面操作。
- 已确认模型密钥可经显式保存持久留在当前浏览器，并按接口地址隔离。跨窗口操作的录制属后续扩展；UI i18n 时间未定。

## Brand Commitments

- 名称：Dr.Octopus（Octopus 浏览器扩展）。
- 视觉承诺（已在视觉稿登记中确认）：延续现有插件**黑白灰**基调、黑色主按钮、浅灰分区、圆角边框与细线图标；**红色用于录制/异常与危险操作，绿色用于已整理、连接和成功反馈**。
- 录制入口图标固定为 `MousePointerClick`（表达网页操作录制），不使用空心圆或视频录制图标。
- 提交类操作使用实心 default 按钮；删除使用 destructive 按钮并保留确认。
- UI 语言：**当前仅简体中文**；未来有计划支持英文等多语言，文案结构需为 i18n 留余地。

## Evidence on Hand

- 视觉稿权威登记与设计规范：`DESIGN.md`（本目录；附录 A 为唯一状态入口，含已批准/需修订/已替代清单）；现存图稿与历史原件归档见[设计入口](../../docs/design/browser-extension-recorder/README.md)。
- 架构与协议：[录制架构](../../docs/architecture/browser-extension-recorder.md)、[统一 Agent](../../docs/architecture/browser-skill-unified-agent.md)、[离线保存](../../docs/architecture/browser-skill-offline.md)、[桥接协议](../../docs/architecture/executor-browser.md)。
- 验证状态：`docs/poc/executor-validation.md`。
- 没有真实客户证言、案例或基准数据；任何对外材料不得虚构上述内容。

## Product Principles

1. **演示一次，整理成技能**：围绕「录制 → 自主整理/按需问人 → 浏览器保存／可选本地技能 → 智能重放」，不引入复杂编辑器或自由聊天。
2. **采集即授权**：任何录制范围扩大（新站点、关联 Tab）都必须经用户明确确认；未知在途结果显式保留而非自动掩盖。
3. **诚实呈现状态**：缺口、中断、部分保存、失败原因各自如实表达，不用成功态掩盖缺失；「已整理」不等于「可运行」。
4. **本地优先的隐私边界**：源端脱敏、密钥不出受信 Host、录制数据不经 Native Host。
5. **复用上游而非重建**：页面控制复用 PageController 公开能力；不为统一接口另建第二套实现。

## Accessibility & Inclusion

- 浅/深色模式与 reduced-motion 均需保留并实际验证。
- 浮条图标按钮须有可访问名称与 Tooltip；记录行支持键盘 Enter/Space 与 focus-visible 焦点反馈。
- Popup 在短屏高度下保持固定标题/Tab/NavigationBar/底部操作；普通页面单一 ScrollArea，会话单一 MessageScroller，不嵌套两套滚动区域。
