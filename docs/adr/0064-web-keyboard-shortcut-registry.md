# ADR-0064：Web 统一快捷键注册器与可定制绑定

- 状态：Implemented（2026-09-20 评审确认并实施；详细设计见 [web-keyboard-shortcuts](../architecture/web-keyboard-shortcuts.md)）
- 日期：2026-09-20
- 范围：apps/web（引擎 lib、持久化 store、设置页、布局与会话接线）

## 背景

Web 端此前没有全局键盘体系：唯一的快捷键逻辑硬编码在 Composer 的 Lexical 插件里（Enter 发送、Shift+Enter 换行），左侧栏开合、右侧面板、会话切换、停止生成等高频操作只能依赖指针。新增快捷键若继续散落在各组件内各自 `addEventListener`，会产生重复的按键解析、无法统一自定义绑定、无法集中展示，也容易与浏览器默认行为和输入法状态冲突。

产品侧同时需要「设置 - 外观 - 快捷键」页面：搜索快捷键、逐条编辑/清除/恢复默认、全部恢复默认，且「语音识别」作为占位命令先行展示。

## 决策

1. 采用三层单向依赖架构：`src/lib/shortcuts/` 为纯 TS 引擎（组合键规范化、数据驱动命令目录、`ShortcutKeyRegister` 类）；`src/stores/shortcuts/` 独占绑定覆盖的持久化；`src/features/` 通过 `useShortcut(commandId, handler)` 等 hook 接线。引擎类本体不 import zustand/React，单例接线集中在 `lib/shortcuts/shortcut-runtime.ts`；`index.ts` 只显式导出基础设施，React Hooks 位于 `hooks/use-shortcut.ts`。
2. 命令目录（catalog）是唯一命令权威：每条命令声明稳定 ID、i18n key、默认绑定、作用域（`global`/`composer`）、状态（`active`/`placeholder`）与 `allowInEditable`。新增命令 = catalog 加一行 + 注册 handler，引擎与设置页零改动。占位命令（首期：语音识别 `Ctrl+D`）只读展示、不参与派发与冲突检测。
3. 全局命令由引擎持有唯一的 window `keydown` 监听统一派发；守卫依次排除 IME 组合中、长按重复、录制暂停期、可编辑焦点目标；可编辑焦点仅在组合键不含 Ctrl/Alt/Meta 时拦截（此类组合不产生文本输入），`allowInEditable` 命令例外（如 `Shift+Esc` 停止生成）；命中即 `preventDefault`，handler 按 LIFO 调用、首个返回 `true` 者消费事件。
4. Composer 作用域命令（发送/换行）不走 window 派发：Enter 手势仍归 Lexical `SubmitShortcutPlugin` 所有（要让位于 typeahead 菜单等编辑器内部状态），但发送判定改为由 feature 层（Composer）基于生效绑定与规范化匹配计算并以 props 传入，保持 `src/components/` 不依赖 stores/features 的纯净边界；用户改绑后插件行为自动跟随。非发送的 Enter 手势一律保持编辑器默认换行语义。
5. 用户绑定只持久化覆盖层：zustand persist 保存 `overrides`（值为组合键字符串；`null` = 已清除；键缺失 = 跟随目录默认），storage key `dr-octopus.shortcuts.bindings.v1`；rehydrate 时丢弃未知命令 ID 与非法组合键，防止脏数据破坏派发。不同步到服务端，绑定为本机偏好。
6. 组合键使用规范化字符串（修饰键固定顺序 `Ctrl+Alt+Shift+Meta` + 主键，如 `Ctrl+Shift+B`），主键优先 `event.code` 物理键位映射，保证 `Ctrl+[` 等在输入法/键盘布局变化下稳定。按键名称为跨语言通用符号，不进入 i18n；命令文案使用 `settings.shortcuts.*` key 域。
7. 冲突检测按作用域分命名空间（global 内互斥、composer 内互斥，跨作用域不冲突）。录制改绑撞键时提示冲突命令并允许一键替换（将原占用方覆盖写为 `null`）；「全部恢复默认」回到目录默认。
8. 默认键刻意避开浏览器保留键：新会话采用 `Alt+N` 而非 `Ctrl+N`（Chrome/Edge 保留 `Ctrl+N`，keydown 不派发给页面）；`Ctrl+B`、`Ctrl+Shift+B`、`Ctrl+D` 的浏览器默认行为均可被 `preventDefault` 压制，正常可用。

## 后果与边界

- 键盘语义集中后可测试：规范化、派发守卫、覆盖解析均为纯函数/可注入 fake EventTarget 的单测，不需要真实浏览器。
- 设置页复用现有 Settings 卡片/导航/路由骨架（含 route-masked 弹窗），不引入第二套设置 UI；`/settings/appearance/shortcuts` 同时进入 canonical 路由与 modal path 白名单。
- 引擎不感知业务：会话导航、侧栏开合、停止生成等 handler 全部留在 features 接线层，符合模块边界规则。
- 移动端无实体键盘时全局监听无副作用；macOS `Cmd`（Meta）体系暂按 Windows/Linux 修饰键展示，规范化层已预留 `Meta` 槽位。
- 语音识别仅为目录占位，不包含任何采集/识别实现；后续启用时将其 `status` 翻为 `active` 并注册 handler 即可。
