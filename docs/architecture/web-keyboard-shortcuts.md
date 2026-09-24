# Web 全局快捷键体系与设置页设计

> 状态：已实施
>
> 版本：v1.0
>
> 日期：2026-09-20
>
> 视觉输入：用户提供的「设置 - 外观 - 快捷键」参考图，仅作为布局、密度和交互证据，不作为产品文案或命令清单来源
>
> 架构决策：[ADR-0064](../adr/0064-web-keyboard-shortcut-registry.md)

## 1. 目标与边界

在 `apps/web` 建立一套统一的全局快捷键体系，并新增「设置 - 外观 - 快捷键」页面：

- 一个全局通用的快捷键注册器类 `ShortcutKeyRegister`，基于 `window` 的 `EventListener`（`keydown`）派发；
- 各组件通过 `shortcutKey.register(commandId, handler)` 注册处理函数，通过 `shortcutKey.get(commandId)` 读取当前生效的按键展示文本；
- 快捷键绑定支持用户自定义、单条清除、单条恢复默认、全部恢复默认，绑定覆盖持久化在本机；
- 设置页支持按命令文案与按键文本搜索；
- 首期命令清单（9 条，见 §4），其中「语音识别」为功能占位。

不在本期范围：参考图中的其他命令（打开设置、对话内搜索、全屏、唤起主窗口、字号缩放）、语音识别实际功能、快捷键的云端同步、macOS `Cmd` 体系适配（按 Windows/Linux 修饰键展示，结构预留）。

## 2. 现状盘点

- 代码库目前没有全局 `keydown` 监听；仅有的键盘逻辑在 Lexical 编辑器内部：[submit-shortcut-plugin](../../apps/web/src/components/AgentComposerEditor/plugins/submit-shortcut-plugin/index.tsx) 把 Enter 映射为发送、Shift+Enter 换行。
- 左侧栏开合由 shadcn `SidebarProvider` 的 `toggleSidebar` 驱动；右侧栏（文件资源 / 属性面板）由 URL search 参数 `sideright` 驱动；二者均在 [features/layout/index.tsx](../../apps/web/src/features/layout/index.tsx) 收口。
- 新建会话 = `useWorkbenchHome.ensureDraftId(workspaceId)` + 导航到 Workspace 首页；上/下会话可复用 Sidebar 的 `sessions.data` 顺序做相对导航；停止生成 = Composer 内的 `stop()`（发送 `agent.abort`）。
- shadcn 已有 `Kbd`、`Table`、`Input`、`Button`、`Tooltip`、`Dialog`、`Popover` 原语，可直接覆盖参考图布局。
- 设置信息架构集中在 `settings-navigation.ts`、`router/settings-modal.ts`、`router/index.ts`、`router/routes.tsx`，新页面按现有 Appearance 组（参考 Language 页）接入。

## 3. 总体架构

按界面接线、React Hook、运行时和持久化分工；依赖按具体文件保持单向，符合 store 边界与 components 纯净性约束：

```text
features（接线层）          features/layout、features/session/Composer、features/settings/shortcuts
   │
hooks/use-shortcut.ts      useShortcut(id, handler) / useShortcutBinding(id)
   │
lib/shortcuts（引擎层）     ShortcutKeyRegister 单例 + 组合键规范化 + 命令目录（纯 TS，无 React/无 store 依赖的类本体）
   │  订阅覆盖变化
stores/shortcuts（持久层）  zustand persist：用户绑定覆盖（overrides），localStorage
```

- `src/lib/shortcuts/`：领域无关的引擎。类本体不 import zustand；`shortcut-runtime.ts` 负责把单例与 store 接线（订阅覆盖变化刷新生效绑定），`index.ts` 仅显式导出基础设施。React Hook 位于 `src/hooks/use-shortcut.ts`；store 只导入纯命令目录，不导入运行时入口。
- `src/stores/shortcuts/`：唯一读写 localStorage 的地方，暴露语义化 action（`setBinding` / `clearBinding` / `resetBinding` / `resetAll`）。
- `src/features/settings/shortcuts/`：设置页 UI，按现有 Settings 卡片模式实现。
- Composer 作用域命令（发送 / 换行）不走 window 派发，见 §8。

## 4. 命令目录（数据驱动）

命令元数据集中在 `shortcut-catalog.ts`，每条命令：

| 字段              | 说明                                                                    |
| ----------------- | ----------------------------------------------------------------------- |
| `id`              | 稳定字符串 ID，同时作为持久化 key                                       |
| `defaultBinding`  | 规范化组合键字符串，`null` 表示默认未绑定                               |
| `scope`           | `'global'`（window 派发）/ `'composer'`（编辑器内派发）                 |
| `status`          | `'active'` / `'placeholder'`（占位：仅展示，不派发、不可编辑）          |
| `allowInEditable` | 焦点在可编辑元素且组合键不含 Ctrl/Alt/Meta 时是否仍触发（默认 `false`） |

命令文案不在 catalog：设置页与冲突提示统一经 feature 层 `use-shortcut-command-labels.ts` 的 `useShortcutCommandLabels()` 提供——每条命令一个字面量 `t('settings.shortcuts.commands.*', …)` 调用（i18next-cli 只提取静态调用点，动态 key 会导致 en.json 缺 key、zh-CN 回退英文），返回类型 `Record<ShortcutCommandId, string>` 让新增命令漏配文案时直接编译失败。

首期清单（默认值以需求文案为准；与参考图不一致处在 §13 列出）：

| ID（`ShortcutKeyRegister` 静态常量）               | 命令（中文）       | 默认按键       | scope    | 备注                                                  |
| -------------------------------------------------- | ------------------ | -------------- | -------- | ----------------------------------------------------- |
| `VOICE_TOGGLE = 'voice.toggle'`                    | 语音识别开关       | `Ctrl+D`       | global   | **占位**：`status: 'placeholder'`，不派发、设置页只读 |
| `SEND_MESSAGE = 'composer.send'`                   | 发送消息           | `Enter`        | composer | 由 Lexical 插件消费                                   |
| `INSERT_NEWLINE = 'composer.newline'`              | 输入时换行         | `Shift+Enter`  | composer | 同上                                                  |
| `STOP_GENERATION = 'session.stop'`                 | 停止生成           | `Shift+Esc`    | global   | `allowInEditable: true`（输入框聚焦时也要能停止）     |
| `PREVIOUS_SESSION = 'session.previous'`            | 上一个会话         | `Ctrl+[`       | global   | 按 Sidebar 会话顺序相对导航                           |
| `NEXT_SESSION = 'session.next'`                    | 下一个会话         | `Ctrl+]`       | global   | 同上                                                  |
| `NEW_SESSION = 'session.new'`                      | 新会话             | `Alt+N`        | global   | 刻意避开浏览器保留键 `Ctrl+N`（§11）                  |
| `TOGGLE_LEFT_SIDEBAR = 'layout.toggleLeftSidebar'` | 切换左侧栏         | `Ctrl+B`       | global   | 复用 `toggleSidebar`                                  |
| `TOGGLE_RIGHT_PANEL = 'layout.toggleRightPanel'`   | 切换右侧资源管理栏 | `Ctrl+Shift+B` | global   | 目标固定为 `file-explorer`                            |

扩展新命令 = 在 catalog 增加一行 + 在 `useShortcutCommandLabels()` 补一条文案（TS 强制）+ 在接线层注册 handler，引擎与设置页零改动。

## 5. 组合键规范化（shortcut-combo.ts）

纯函数模块，负责 `KeyboardEvent ↔ 规范字符串` 双向转换与校验：

- 规范形式：`修饰键(固定顺序 Ctrl+Alt+Shift+Meta) + 主键`，以 `+` 连接，例如 `Ctrl+Shift+B`、`Shift+Esc`、`Ctrl+[`、`Enter`。
- 主键判定优先 `event.code` 物理键位映射表（`KeyA–Z`、`Digit0–9`、`BracketLeft→[`、`BracketRight→]`、`Comma→,`、`Period→.`、`Slash→/`、`Semicolon→;`、`Quote→'`、`Backquote→``、`Minus→-`、`Equal→=`、`Backslash→\`、`Space`、`Enter`、`Escape→Esc`、`Tab`、`F1–F12`、`Arrow*→Arrow*`），保证 `Ctrl+[` 在任意输入法/布局下稳定；表外回退 `event.key` 单字符大写。
- 仅按修饰键不产生组合（录制时忽略，等待主键）。
- 展示层直接使用规范字符串（按键名称为跨语言通用符号，不占 i18n key）。
- 提供 `normalizeEvent(event): string | null`、`isValidCombo(raw): boolean`、`comboMatches(event, combo): boolean`。

## 6. ShortcutKeyRegister 类设计

```ts
type ShortcutHandler = (event: KeyboardEvent) => boolean | void;

interface ShortcutCommandView {
  id: ShortcutCommandId;
  scope: 'global' | 'composer';
  status: 'active' | 'placeholder';
  defaultBinding: string | null; // 目录默认
  binding: string | null; // 生效值（覆盖优先，null = 已清除）
}

class ShortcutKeyRegister {
  // 命令 ID 静态常量（§4 表格左列），调用方无需记忆字符串
  static readonly NEW_SESSION = 'session.new' as const;
  // …其余 8 条

  constructor(options?: {
    target?: Pick<Window, 'addEventListener' | 'removeEventListener'>; // 默认 window，测试可注入
    now?: () => number; // 预留
  });

  /** 挂载/卸载 window keydown 监听；start 幂等。 */
  start(): void;
  stop(): void;

  /**
   * 注册命令处理函数，返回注销函数。
   * 同一命令支持多次注册，派发按 LIFO（后注册先执行），
   * 第一个返回 true 的 handler 消费事件；无任何 handler 返回 true 时事件不被消费。
   */
  register(commandId: ShortcutCommandId, handler: ShortcutHandler): () => void;

  /** 读取命令视图（含生效绑定）；getCombo 为其展示文本便捷封装。 */
  get(commandId: ShortcutCommandId): ShortcutCommandView;
  getCombo(commandId: ShortcutCommandId): string; // 例 "Ctrl+Shift+B"；未绑定返回 ''
  list(): ShortcutCommandView[];

  /** 判定事件是否命中某命令的生效绑定（Composer 插件复用）。 */
  matches(commandId: ShortcutCommandId, event: KeyboardEvent): boolean;

  /** 由接线层在 store 覆盖变化时调用，刷新内部生效绑定表。 */
  syncOverrides(overrides: Partial<Record<ShortcutCommandId, string | null>>): void;

  /** 录制新快捷键期间暂停全局派发（设置页录入框使用）。 */
  setSuspended(suspended: boolean): void;
}
```

`index.ts` 导出模块级单例 `shortcutKey`（构造即 `start()`，并订阅 `useShortcutsStore` 调用 `syncOverrides`），以及 React 接入：

```ts
/**
 * 在组件挂载期间注册 handler；enabled=false 时不注册。
 * handler 经 ref 保持稳定，引用变化不导致重复注册。
 */
function useShortcut(
  commandId: ShortcutCommandId,
  handler: ShortcutHandler,
  options?: { enabled?: boolean }
): void;

/** 响应式读取某命令的生效绑定（供设置页/Tooltip 展示）。 */
function useShortcutBinding(commandId: ShortcutCommandId): string | null;
```

## 7. 全局派发与守卫

window `keydown` 处理流程（全部通过才派发）：

1. `event.isComposing`（IME 组合中）→ 忽略；
2. `event.repeat`（长按重复）→ 忽略，避免开关类命令来回翻转；
3. 引擎处于 `suspended`（设置页正在录制）→ 忽略；
4. 规范化事件得到组合键，在「scope=global 且 status=active」命令中查找生效绑定匹配项，无匹配 → 忽略；
5. 事件目标为可编辑元素（`input` / `textarea` / `select` / `[contenteditable]`）时：组合键含 Ctrl/Alt/Meta 的照常派发（此类组合不产生文本输入，与 VS Code 行为一致）；不含这些修饰键（如 `Shift+Esc`、裸键）且命令未声明 `allowInEditable` → 忽略；
6. 匹配成功即 `event.preventDefault()`（压制 `Ctrl+B` 书签栏等浏览器默认行为），按 LIFO 调 handler，首个返回 `true` 者消费事件。

说明：命中即先 `preventDefault` 再派发，保证 `Ctrl+B` 这类浏览器可拦截键在任何 handler 结果下都不泄漏默认行为；handler 返回 `true` 仅用于多 handler 场景的消费语义。

## 8. Composer 作用域（发送 / 换行）

`composer.send` 与 `composer.newline` 不参与 window 派发：它们只在编辑器聚焦时成立，且要让位于 typeahead 菜单等编辑器内部状态。现有 `SubmitShortcutPlugin` 继续拥有 Enter 手势，但发送判定改为由接线层计算：

- `src/components/` 不得依赖 stores/features，因此由 `Composer.tsx`（feature 层）把判定函数以 props 传入 `AgentComposerEditor` → `SubmitShortcutPlugin`：`isSubmitEvent(e)` 基于 `useShortcutBinding(SEND_MESSAGE)` 的响应式生效绑定 + `comboMatches` 计算；`Alt+<发送组合>` 保持「备选发送（follow-up）」语义，绑定不含 Alt 时按忽略 Alt 匹配。
- 插件逻辑：菜单打开 → 放行；命中 send → `preventDefault` + 提交（`altKey` 备选语义保持现状）；其余 Enter 手势一律放行走 Lexical 默认换行。
- 换行语义说明：`composer.newline` 的绑定参与展示、搜索与冲突检测；行为上「非发送的 Enter 手势均换行」这一编辑器本质保持不变（用户改绑发送键后，Enter 自然回落为换行）。
- `aria-keyshortcuts` 由 `keyShortcutsHint` props 提供，随生效绑定响应式更新（`toAriaKeyShortcuts` 转换，如 `Ctrl→Control`、`Esc→Escape`）。

## 9. 持久化（stores/shortcuts）

- zustand `persist` + `combine`，storage key：`dr-octopus.shortcuts.bindings.v1`，仅持久化 `overrides: Partial<Record<ShortcutCommandId, string | null>>`（值为组合键字符串；`null` = 用户清除；键不存在 = 跟随默认）。
- 生效绑定解析：`id in overrides ? overrides[id] : defaultBinding`。
- rehydrate 经 `merge` 净化：丢弃未知命令 ID 与非法组合键字符串，防止脏数据破坏派发。
- Action：`setBinding(id, combo)` / `clearBinding(id)`（写 `null`）/ `resetBinding(id)`（删 override）/ `resetAll()`（清空）。store 模块对外只暴露这些语义 action 与只读 selector。

## 10. 冲突策略

- 冲突命名空间按 scope 分隔（global 内互斥、composer 内互斥；global 与 composer 互不冲突，因为派发上下文不同）。占位命令不参与冲突检测。
- 录制到新组合键时与同 scope 其他命令的生效绑定撞键：录入框内提示「与『X』冲突」，提供「仍然替换 / 取消」；替换 = 把冲突方 override 写为 `null`（清除），再写入新绑定。
- 「全部恢复默认」后所有命令回到目录默认值（默认即无冲突）。

## 11. 浏览器保留键与平台限制（已知风险）

- 新会话默认 `Alt+N`：评审确认刻意避开 Chrome/Edge 保留的 `Ctrl+N`（该键 keydown 不派发给页面，普通标签页内不可用）。
- `Ctrl+B`、`Ctrl+Shift+B`、`Ctrl+D` 的浏览器默认行为（书签栏、加书签）可被 `preventDefault` 压制，正常可用。
- `Alt` 系组合在 Firefox 中按键弹起可能触发菜单栏聚焦：不影响快捷键功能本身，记录为已知浏览器行为。
- 移动端无实体键盘，全局监听不产生副作用，不做额外开关。

## 12. 设置页 UI（features/settings/shortcuts）

布局参考用户提供截图，用 shadcn/ui 实现，沿用现有 Settings 卡片模式（`SettingContainer` + `Card`）：

```text
Card
├─ CardHeader：标题「快捷键」+ 描述
├─ 工具行：搜索 Input（SearchIcon，占位「搜索快捷键」） + 「全部恢复默认」Button(variant=outline，Dialog 二次确认)
└─ Table：列 = 命令 | 按键绑定 | 操作
   ├─ 命令：本地化文案；占位命令附 Badge「即将推出」
   ├─ 按键绑定：一枚 Kbd 展示整串（如 Ctrl+Shift+B）；已清除显示弱化文本「未设置」
   └─ 操作（图标按钮 + Tooltip）：编辑(PencilIcon) / 清除(EraserIcon，未绑定或已清除时禁用) / 恢复默认(RotateCcwIcon，无 override 时禁用)
```

- 搜索：大小写不敏感，同时匹配本地化命令文案与按键文本（对组合串做去 `+`、去空格归一后包含匹配，例如输入 `ctrlb` 或 `ctrl b` 均能命中 `Ctrl+B`）；无结果显示弱化空态文案。
- 编辑：点击后该行按键绑定单元格切换为内联录制框（`ShortcutRecorder`）——引擎 `setSuspended(true)`，捕获下一次有效组合键（仅修饰键继续等待；`Esc` 取消；`Backspace`/`Delete` 清除绑定）；合法则走 §10 冲突流程后写入；焦点离开录制区域视为取消；结束一律 `setSuspended(false)`。
- 防布局抖动：`Table` 使用 `table-fixed` 并固定按键绑定列宽（`w-64`）与操作列宽（`w-28`）；录制框与展示态（`Kbd`/未设置）保持同一占位尺寸（`w-full` × `h-8`），提示与冲突操作渲染为悬浮层（`absolute` overlay），录制状态切换不改变表格几何。
- 全部恢复默认：`Dialog` 确认后调用 `resetAll()`。
- 响应式：窄屏隐藏「操作」列 Tooltip 之外的冗余文案，表格行可换行，沿用 `Page`/`SettingContainer` 的滚动容器。

## 13. 与参考图的差异（评审确认：参考图仅作布局证据，不作为数据/文案来源）

| 项                                                   | 参考图                | 本期实现                        | 说明                                           |
| ---------------------------------------------------- | --------------------- | ------------------------------- | ---------------------------------------------- |
| 停止生成                                             | `Esc`                 | `Shift+Esc`                     | 按需求文案；裸 `Esc` 与编辑器/弹窗关闭手势冲突 |
| 语音识别                                             | 语音录制开关 `Ctrl+D` | 语音识别开关 `Ctrl+D`，占位只读 | 功能未实现；默认键经评审确认                   |
| 打开设置 / 对话内搜索 / 全屏 / 唤起主窗口 / 字号缩放 | 有                    | 不做                            | catalog 可后续扩展                             |

## 14. i18n 约定

- 调用处 `t(key, 'Default English')`，手工维护 `zh-CN.json`，`en.json` 由 `pnpm i18n:extract` 生成；`aria-label` 不翻译（沿用现状）。
- 新增 key 域：`settings.nav.shortcuts.*`（导航项）、`settings.shortcuts.*`（标题/描述/搜索/列头/操作/录制/冲突/空态/即将推出）、`settings.shortcuts.commands.<id>`（9 条命令文案）。
- 按键名称（`Ctrl`、`Shift`、`Esc`…）为通用符号，不进入 i18n。

## 15. 路由与导航接入

- `router/settings-modal.ts`：`settingsPaths` 增加 `/settings/appearance/shortcuts`。
- `router/index.ts`：新增 `shortcutsSettingsRoute`（path `appearance/shortcuts`，挂在 `settingsLayoutRoute` 下）。
- `router/routes.tsx`：新增 `ShortcutsSettingsRoute`（lazy + Suspense，同 Language 页模式）。
- `settings-navigation.ts`：Appearance 组新增「Keyboard shortcuts / 快捷键」项（`KeyboardIcon`，`pageType: 'complete'`）。

## 16. 各命令接线点

| 命令                                 | 接线位置                                                        | handler 行为                                                                                                           |
| ------------------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `layout.toggleLeftSidebar`           | `features/layout/index.tsx` `WorkbenchLayout`                   | 调 `useSidebar().toggleSidebar()`                                                                                      |
| `layout.toggleRightPanel`            | 同上                                                            | `sideright === 'file-explorer'` → 清除；否则 → 置 `'file-explorer'`（沿用 Header 的可用条件：xl 断点且已选 Workspace） |
| `session.new`                        | 同上                                                            | `ensureDraftId(selectedWorkspaceId)` + 导航 Workspace 首页（复用 Sidebar `onCreate` 逻辑；未选 Workspace 时不注册）    |
| `session.previous` / `session.next`  | 同上                                                            | 按 `sessions.data` 顺序相对当前 `params.sessionId` 导航；无活动会话或已到端点 → 返回 `false` 不消费                    |
| `session.stop`                       | `features/session/Composer.tsx`                                 | `enabled: running` 时调用现有 `stop()`                                                                                 |
| `composer.send` / `composer.newline` | `Composer.tsx` → `AgentComposerEditor` → `SubmitShortcutPlugin` | 见 §8（send 判定含 Alt 备选；newline 语义见 §8 第三条）                                                                |
| `voice.toggle`                       | 无                                                              | 占位，不注册                                                                                                           |

## 17. 文件清单

新增：

```text
apps/web/src/lib/shortcuts/shortcut-combo.ts          # 组合键规范化（纯函数）
apps/web/src/lib/shortcuts/shortcut-catalog.ts        # 命令目录与类型
apps/web/src/lib/shortcuts/shortcut-key-register.ts   # ShortcutKeyRegister 类
apps/web/src/lib/shortcuts/index.ts                   # 基础设施显式导出
apps/web/src/lib/shortcuts/shortcut-runtime.ts        # 单例接线
apps/web/src/hooks/use-shortcut.ts                    # useShortcut / useShortcutBinding
apps/web/src/stores/shortcuts/store.ts                # overrides 持久化
apps/web/src/stores/shortcuts/index.ts                # store 公共出口
apps/web/src/features/settings/shortcuts/ShortcutsSettingsPage.tsx
apps/web/src/features/settings/shortcuts/ShortcutRecorder.tsx
apps/web/src/features/settings/shortcuts/shortcut-search.ts   # 搜索谓词（纯函数）
apps/web/test/shortcut-combo.test.mjs
apps/web/test/shortcut-key-register.test.mjs
apps/web/test/shortcuts-store.test.mjs
apps/web/test/shortcut-search.test.mjs
```

修改：

```text
apps/web/src/router/settings-modal.ts                 # settingsPaths +1
apps/web/src/router/index.ts                          # 路由 +1
apps/web/src/router/routes.tsx                        # 路由组件 +1
apps/web/src/features/settings/settings-navigation.ts # 导航项 +1
apps/web/src/features/layout/index.tsx                # 4 条全局命令接线
apps/web/src/features/session/Composer.tsx            # 停止生成 + 传递 send/newline 判定
apps/web/src/components/AgentComposerEditor/...       # submit-shortcut-plugin 改为 props 判定（含上游 props 透传）
apps/web/src/i18n/locales/zh-CN.json                  # 中文 overlay
apps/web/src/i18n/locales/en.json                     # pnpm i18n:extract 生成
```

## 18. 测试计划

- `shortcut-combo.test.mjs`：规范化（字母大写、`Ctrl+Shift+B`、`Shift+Esc`、`Ctrl+[`、`Space`、纯修饰键返回 `null`、Shift+标点按物理键稳定）、`comboMatches`、非法串校验。
- `shortcut-key-register.test.mjs`：注入 fake EventTarget —— register/注销、LIFO 与消费语义、命中即 preventDefault、守卫（composing / repeat / suspended / 可编辑目标 / `allowInEditable` 例外）、`syncOverrides` 后按新绑定派发、placeholder 不派发、`get/getCombo/list` 视图正确。
- `shortcuts-store.test.mjs`：`setBinding/clearBinding/resetBinding/resetAll`、生效绑定解析（override 优先、`null` 清除语义）、rehydrate 净化（未知 ID / 非法组合被丢弃）。
- `shortcut-search.test.mjs`：命令文案与按键文本（含去 `+`/去空格归一）的双通道匹配、大小写不敏感。
- 交付前运行：`pnpm --filter @octopus/web test`、`pnpm lint`、`pnpm typecheck`。

## 19. 评审结论（2026-09-20 已确认）

1. 参考图仅作布局参考，不作为数据/文案来源；停止生成默认键按需求文案取 `Shift+Esc`。
2. 新会话默认键采用 `Alt+N`，放弃浏览器保留键 `Ctrl+N`。
3. 语音识别占位行展示 `Ctrl+D`，只读、不派发、不参与冲突检测 —— 符合预期。
4. 冲突处理采用「提示冲突 + 一键替换（清除原占用方）」。
5. 右侧栏切换目标固定为文件资源面板（`file-explorer`），不含属性面板。
