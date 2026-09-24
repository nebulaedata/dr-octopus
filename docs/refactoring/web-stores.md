# Web Store 目录整理

## 范围与边界

本次按已确认的状态域模板整理 `apps/web/src/stores/`。执行前工作区包含此前 feature 重构，基线使用当时的完整工作区，不以 Git HEAD 替代。Server、Agent、共享协议和 UI primitives 未改动。

长期规则见 [代码开发规范 §4.3](../code-development-standards.md#43-store-目录与状态所有权)。模板允许按需省略类型与工具文件，并保留有明确职责的状态转换、生命周期与持久化实现。

## 各状态域结果

| 状态域 | 调整与保留的边界 |
| --- | --- |
| language | 单文件移入 `language/store.ts`，新增显式入口；语言恢复时机和设备存储键保持不变 |
| home-drafts | 单文件移入 `home-drafts/store.ts`，入口导出工厂、既有单例、空草稿和 HomeDraft 类型；草稿版本、提交身份和标签页存储保持不变 |
| workbench-home | 单文件移入 `workbench-home/store.ts`，新增入口；工作区草稿身份、过期恢复与发布后清理保持不变 |
| session | 6 个无独立状态的投影、归一化和统计辅助文件移入平级 `utils/`；入口补充视图实际使用的 token 选择和格式化能力 |
| file-explorer | 维持 `index/store/type/utils`；消费者的类型导入改用公共入口 |
| background-tasks | 保留 `index.ts + store.ts`，不增加空类型或工具文件 |
| shortcuts | 保留内聚实现及入口；私有类型继续跟随实现 |
| memory-assistant | 保留位置持久化适配与入口，不引入 Zustand |

初次整理保留了 Session 的实例管理、事件更新、上传取消和草稿存储实现。后续按确认的分组规则，将 reducer 移至 `reducers/`，附件持久化与任务管理移至 `utils/attachments/`；`registry.ts` 继续拥有实例回收。各实现保持独立，没有合并进单一 store 文件。

生产调用方统一从对应状态域入口导入。内部文件直接引用实现；测试仍可直接验证 reducer 或投影。删除了旧文件路径，没有兼容转导出。

## 验证证据

- 整理前：Web 223 项测试通过，强制 TypeScript 重建及生产构建通过。
- 整理后：Web 225 项测试通过；新增 2 项 AST 边界检查，约束业务目录、显式入口、utils 二选一以及静态/动态/类型导入和再导出的访问路径。
- 最终 lint、强制 TypeScript 重建和生产构建通过；i18n CI 提取没有更新语言文件。
- 聚焦回归 50 项通过，覆盖语言、首页草稿、会话历史、运行时、token 统计及 feature 边界；最终别名修正后，语言与 store 边界共 5 项复验通过。
- 对迁移前快照和最终源码做 AST 对照：16 个修改或移动的已有源文件，其非导入导出声明和函数体一致。该证据不单独替代运行时验证。
- 同一生产浏览器用例在前后版本均通过：验证首页不提前加载会话页面、进入会话后加载、Composer 草稿及快捷键焦点行为。
- lint 首次发现 language 迁移后两处过深相对导入，改为 `@/i18n/config` 后复验；没有放宽规则或业务断言。

本次未重跑整个浏览器套件，既有浏览器失败的记录仍见 [feature 重构记录](./web-features.md)。本记录的浏览器通过结论仅限上述已执行用例。

## 后续 Session 职责分组

按确认方案进一步收紧 Session 根目录：保留 `index.ts`、`store.ts`、`type.ts`、`registry.ts`，以及 `reducers/` 和 `utils/`。无新增中间入口或兼容导出。

| 原位置 | 新位置 |
| --- | --- |
| `reducer.ts` | `reducers/session-reducer.ts` |
| `retry-reducer.ts` | `reducers/retry-reducer.ts` |
| `attachment-drafts.ts` | `utils/attachments/draft-storage.ts` |
| `attachment-upload-tasks.ts` | `utils/attachments/upload-tasks.ts` |

Store utils 现在允许业务分组与明确封装的副作用；附件任务 Map 仍为浏览器标签页共享实例，草稿继续按工作区与会话存储。Feature hooks/utils 的扁平规则保持不变。规范、Web 指南和 Zustand skill 已同步修订。

验证：

- 新增 3 项附件行为回归，先在迁移前执行，再以相同断言验证迁移后：持久化筛选与隔离、恢复状态、损坏数据、取消前移除任务、完成清理和取消失败后的清理。
- 新增 1 项 Session 目录边界检查，限制根目录角色并禁止内部目录入口；保留既有公共入口与依赖检查。
- 迁移后聚焦测试 50 项通过，Web 全量测试 229 项通过；lint 通过，语言文件未发生变化。
- 6 个修改或移动的已有源文件经过迁移前后 AST 对照，非导入导出声明和函数体一致。公共能力名称、状态更新、存储键及实例范围未调整。
- 强制 TypeScript 重建、生产构建通过；首页到会话的生产浏览器回归 1 项通过，覆盖惰性加载、草稿与快捷键焦点。未重跑整个浏览器套件。
