# Web lib、utils 与 hooks 职责整理

本轮保留 `apps/web/src/lib/` 作为基础设施目录，不新增应用级 core。长期规则见 [代码开发规范 §4.5](../code-development-standards.md#45-web-libutils-与-hooks-的边界)。既有 `queries/core/` 保持不变。

## 最终归属

| 能力 | 位置 |
| --- | --- |
| 剪贴板操作、复制反馈 | `utils/clipboard.ts`、`utils/copy-text-with-feedback.ts` |
| WebSocket、命令等待、会话保留与实例接线 | `lib/runtime/` |
| 快捷键目录、匹配、注册器 | `lib/shortcuts/` |
| 快捷键单例创建、覆盖同步与 HMR 监听器接线 | `lib/shortcuts/shortcut-runtime.ts` |
| React 注册与绑定读取 Hook | `hooks/use-shortcut.ts` |

`lib/shortcuts/index.ts` 只显式导出基础设施，通过运行时导出保留原有单例初始化；没有把初始化改到 Hook 中。Store 继续直接依赖纯命令目录，不通过运行时入口回到自身。原有订阅和 HMR 处理原样迁移，未夹带生命周期修复。

生产调用方、测试和相关架构文档已更新路径，旧路径删除，没有兼容转导出。复制的浏览器降级、焦点及选区恢复逻辑保持不变。

## 验证

- 迁移前后相同的 69 项聚焦回归均通过：复制、命令确认与超时、WebSocket 重连、快捷键匹配与派发、持久化覆盖和会话运行时。
- 新增基础设施不反向依赖 React/hooks/features 的边界检查，并验证快捷键入口仅显式导出；相关架构检查 8 项通过。
- 迁移后 Web 全量测试 232 项通过。
- AST 对照确认 20 个移动或调整引用的已有源文件实现不变；快捷键原入口中的初始化语句、选项契约和 Hook 函数体与拆分后的实现一致。三个消费者文件保留迁移前原有排版，仅更新导入。
- 两项会话快捷键浏览器用例在迁移前通过；迁移后以相同断言复验，并额外检查首页到会话的惰性加载及 Composer 焦点。

本轮不重跑完整浏览器套件；既有套件失败范围仍见 [feature 重构记录](./web-features.md)。

最终 lint、强制 TypeScript 重建和生产构建通过；3 项生产浏览器回归通过，语言目录未更新。
