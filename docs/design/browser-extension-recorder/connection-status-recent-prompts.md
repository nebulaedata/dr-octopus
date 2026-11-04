# 连接页最近一次连接视觉稿（2026-11-04）

## 来源与边界

- 方法：Product Design ideate，使用 Image Gen 分别生成三张独立草稿，再复制到本目录；原生成文件保留在 `C:\Users\zhang\.codex\generated_images\01a1a414-eecf-7d72-ba1a-e3013db22a76\`。
- 参考：用户于 2026-11-04 提供的当前连接页截图 `codex-clipboard-7c5710da-bc88-489e-a734-070beb732b65.png`，以及历史视觉稿 [connection-panel-v1.png](connection-panel-v1.png)。参考截图是现行界面的证据；以下三图是生成的设计草稿，不是已实现界面截图。
- 约束：360×600 弹窗、深色黑白灰视觉、当前状态优先、成功态绿色、页脚与连接控制保留；历史错误移入折叠诊断。图中“今天 09:17”是以 2026-11-04 为日期锚的示意值。现有 `PopupStatus` 没有最近一次成功连接时间，实施时需要单独设计该字段及其生命周期，不得从心跳时间或最后错误时间冒充。
- 架构参考：[浏览器扩展连接](../../architecture/executor-browser.md)、[当前视觉与状态登记](../../../apps/browser-extension/DESIGN.md)。2026-11-04 用户选择第一稿，其状态为 `approved`；其余两稿为 `superseded`。视觉批准、代码实现与运行验证分别登记。

## 候选与交互建议

| 文件                                                                 | 设计重点                                 | 交互建议（待审阅）                                                     |
| -------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| [connection-status-summary-v1.png](connection-status-summary-v1.png) | 保留现有状态列表；最近连接与诊断各占一行 | 已选目标：默认显示最近一次成功握手时间；点击“连接诊断”才展开历史异常。 |
| [connection-status-focus-v1.png](connection-status-focus-v1.png)     | 当前连接状态作为主标题；时间紧随其下     | 当前状态变化时主标题同步变化；历史异常入口保持低权重。                 |
| [connection-status-ledger-v1.png](connection-status-ledger-v1.png)   | 状态双行与最近连接记录分组               | 连接记录独立于实时状态；断线时仍可显示上次成功时间并明确当前状态。     |

实施交互：从未成功连接时显示“尚无连接记录”；有历史异常时仅在展开诊断后展示时间、有限错误码与恢复建议；连接中、暂停、断开及版本不兼容时优先解释当前状态。展开诊断不能改变连接状态。最近成功握手时间由扩展本地保存，跨浏览器重启保留；心跳不更新它，当前状态始终由 Worker 实时判断。

## 生成提示词记录

三次生成都实际附带了上述两张图片作为参考，`transparent_background=false`。以下保留各次提示词的设计要求；生成输出约为 972×1620 像素，比例对应 360×600。

### connection-status-summary-v1.png

> Create ONE realistic production-quality browser extension popup visual mockup, 360 x 600 px, app content only, no browser frame. Direction name: 'Quiet connection summary'. Use the attached current Dr.Octopus popup screenshot as exact visual-system reference: dark graphite canvas, black outer background, Microsoft YaHei UI-like Chinese sans, white text, subtle neutral borders, green only for success, existing compact header with octopus icon and Dr.Octopus, two tabs 连接状态 and 录制重放, fixed footer with 扩展版本 v0.1.5 and 安装实例 abbreviated ID. Redesign ONLY the connection tab. Current state clearly shows 本机 Executor, 连接状态 已连接 in green success pill, 工具链 已就绪 in neutral white pill, and the description 已连接本机 Executor，工具调用仍需在客户端授权。 Replace the prominent historical error card with a calm single-line '最近一次连接' record showing '今天 09:17' as illustrative proposed data, visually subordinate to live status. Put a subtle collapsed '连接诊断' disclosure beneath it with chevron; no raw error codes visible in default state. Keep the existing footer actions 刷新状态 and 暂停连接 in a compact bottom action row of the card. Use no new features or navigation. Preserve 360x600 fit and real Chinese legibility. Today anchor 2026-11-04; sample recent connection 09:17 and current screenshot time 09:26. This is a pending-review concept; recent successful connection time requires a new data field in later implementation. Do not render any design notes or labels such as option/variant/concept.

### connection-status-focus-v1.png

> Create ONE independent realistic production-quality visual design for the Dr.Octopus Chrome/Edge browser extension popup at 360 x 600 px, app content only, no device or browser chrome. Direction name: 'Connection moment'. Use attached existing screenshot and older approved connection visual as moodboard references only. Preserve exact incumbent visual world: compact 360px dark graphite/black, neutral fine lines, Microsoft YaHei UI Chinese typography, green for live connection success only, header with octopus icon Dr.Octopus and 浏览器连接 · Google Chrome, two tabs 连接状态 and 录制重放, fixed metadata footer 扩展版本 v0.1.5 / 安装实例 1332c836...fbed. Redesign connection panel structure distinct from a list of rows: lead with a confident '已连接' success state and the human-readable record '最近一次连接 今天 09:17' immediately below as the central information. The tool readiness '工具链 已就绪' sits as a small neutral supporting status. Keep the truthful note '工具调用仍需在客户端授权。' Clearly provide 刷新状态 and 暂停连接 actions. Historical errors are NOT prominent; make an understated text-level disclosure '查看连接诊断' near bottom of panel with chevron, collapsed and without raw codes. No decorative cards within cards, no marketing features, no new destinations. Maintain realistic 360 x 600 popup fit, high contrast and legible Chinese text. Date anchor 2026-11-04; shown recent connection time is illustrative proposed future data and is not currently available from runtime status. Do not render any design notes, option numbers, or labels such as concept.

### connection-status-ledger-v1.png

> Generate ONE standalone, realistic production-quality UI mockup, 360 x 600 px, for Dr.Octopus browser extension connection popup. Direction name: 'Connection ledger'. Use both attached screenshots as visual source; preserve current dark graphite/black compact Chinese interface, the Dr.Octopus icon/brand header, two tabs 连接状态 and 录制重放, fixed bottom metadata footer, 14px Chinese sans, neutral surfaces, green success, and existing two actions 刷新状态 / 暂停连接. This layout should be meaningfully distinct from a hero status layout or a series of nested cards. Within the single 本机 Executor panel, preserve two tidy live rows: 连接状态 [green 已连接] and 工具链 [white 已就绪]. Under a fine separator create a lightweight '最近一次连接' record, showing a small success check and '今天 09:17' on the same line plus short quiet text '当前连接正常'; this is the most recent successful connection, not a historical error. Place a very low-key collapsed disclosure '连接诊断' with a chevron BELOW the recent-connection record, no raw failure codes on default screen. Keep truthful statement 工具调用仍需在客户端授权. Keep actions at card bottom and footer anchored to bottom of 360x600. Use subtle grouping and clear hierarchy, no cards inside cards, no red historic failure card, no invented metrics or new navigation. Include date anchor 2026-11-04; timestamp is illustrative future proposed data and not yet in current app. Ensure Chinese copy readable and uncropped, no design annotation text and no option numbers.
