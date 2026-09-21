# Lexical Agent Composer — 源码映射与可执行清单

本文件是 `lexical-agent-composer` skill 的参考资料，包含核心源码位置与项目落地的检查清单。

## 源码映射

| 功能 | 源码浏览地址 | 原始文件（可直接 fetch） |
|------|-------------|-------------------------|
| 自动补全插件 | [LexicalTypeaheadMenuPlugin.tsx](https://github.com/facebook/lexical/blob/main/packages/lexical-react/src/LexicalTypeaheadMenuPlugin.tsx) | https://raw.githubusercontent.com/facebook/lexical/main/packages/lexical-react/src/LexicalTypeaheadMenuPlugin.tsx |
| Menu 基础类与键盘 | [LexicalMenu.tsx](https://github.com/facebook/lexical/blob/main/packages/lexical-react/src/shared/LexicalMenu.tsx) | https://raw.githubusercontent.com/facebook/lexical/main/packages/lexical-react/src/shared/LexicalMenu.tsx |
| Mention Node | [MentionNode.ts](https://github.com/facebook/lexical/blob/main/packages/lexical-playground/src/nodes/MentionNode.ts) | https://raw.githubusercontent.com/facebook/lexical/main/packages/lexical-playground/src/nodes/MentionNode.ts |
| Mentions 插件示例 | [MentionsExtension/index.tsx](https://github.com/facebook/lexical/blob/main/packages/lexical-playground/src/plugins/MentionsExtension/index.tsx) | https://raw.githubusercontent.com/facebook/lexical/main/packages/lexical-playground/src/plugins/MentionsExtension/index.tsx |
| Slash 命令示例 | [ComponentPickerPlugin/index.tsx](https://github.com/facebook/lexical/blob/main/packages/lexical-playground/src/plugins/ComponentPickerPlugin/index.tsx) | https://raw.githubusercontent.com/facebook/lexical/main/packages/lexical-playground/src/plugins/ComponentPickerPlugin/index.tsx |
| React 绑定入口 | [LexicalComposer.tsx](https://github.com/facebook/lexical/blob/main/packages/lexical-react/src/LexicalComposer.tsx) | https://raw.githubusercontent.com/facebook/lexical/main/packages/lexical-react/src/LexicalComposer.tsx |
| 第三方 mentions | [lexical-beautiful-mentions](https://github.com/sodenn/lexical-beautiful-mentions) | https://github.com/sodenn/lexical-beautiful-mentions.git |

## 下一步可执行清单

给用户的可执行清单通常按以下顺序：

1. 确定 `@` 用核心方案还是 `lexical-beautiful-mentions`
2. 定义 `FileMentionNode`（或 `BeautifulMentionNode` 的 data 结构）
3. 实现文件搜索 hook（去抖 + 缓存）
4. 挂载 `@` plugin 并渲染菜单
5. 定义命令注册表，实现 `/` plugin
6. 添加触发器互斥 guard
7. 实现 `buildPayload` 与后端对接
8. 写 E2E/单元测试覆盖：打开菜单、选中、插入、序列化、提交
