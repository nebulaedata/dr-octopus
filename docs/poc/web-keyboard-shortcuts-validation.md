# web-keyboard-shortcuts：概念验证与验收

架构设计：[原设计](../architecture/web-keyboard-shortcuts.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

## 18. 测试计划

- `shortcut-combo.test.mjs`：规范化（字母大写、`Ctrl+Shift+B`、`Shift+Esc`、`Ctrl+[`、`Space`、纯修饰键返回 `null`、Shift+标点按物理键稳定）、`comboMatches`、非法串校验。
- `shortcut-key-register.test.mjs`：注入 fake EventTarget —— register/注销、LIFO 与消费语义、命中即 preventDefault、守卫（composing / repeat / suspended / 可编辑目标 / `allowInEditable` 例外）、`syncOverrides` 后按新绑定派发、语音切换及取消的处理器生命周期、`get/getCombo/list` 视图正确。
- `shortcuts-store.test.mjs`：`setBinding/clearBinding/resetBinding/resetAll`、生效绑定解析（override 优先、`null` 清除语义）、rehydrate 净化（未知 ID / 非法组合被丢弃）。
- `shortcut-search.test.mjs`：命令文案与按键文本（含去 `+`/去空格归一）的双通道匹配、大小写不敏感。
- 交付前运行：`pnpm --filter @octopus/web test`、`pnpm lint`、`pnpm typecheck`。
