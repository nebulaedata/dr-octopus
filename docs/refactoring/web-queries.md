# Web Query 目录整理

## 边界变化

本次基于同一工作区中上一轮已通过构建的版本整理 queries，保留此前 feature 与 store 重构。长期规则见 [代码开发规范 §4.4](../code-development-standards.md#44-query-目录与缓存协调)。Server、Agent、共享协议和 UI primitives 未改动。

| 原位置 | 最终位置与职责 |
| --- | --- |
| `data-events-lifecycle.ts` | `data-events-queries.ts`：对外保留 `useDataEventsLifecycle`，拥有 SSE 挂载、重连与清理 |
| `data-events-sync.ts` | `utils/data-events-sync.ts`：解析、匹配、事件合并与缓存刷新协调 |
| `realtime-message-handler.ts` | `utils/realtime-message-handler.ts`：运行时消息校验、确认及快照协调 |

`parseDataChange` 原样移入同步辅助文件。Layout 和实时查询接线更新引用；聚焦测试通过新位置验证原有行为。旧路径删除，不保留兼容转导出。

根目录只保留 `*-queries.ts`、`core/` 与 `utils/`；客户端和共享键分别位于 `core/query-client.ts`、`core/query-keys.ts`。内部辅助文件不导入 React、不对外提供直接入口；连接仍由查询层 Hook 创建及清理。QueryClient、查询键、失效规则、刷新顺序和实例作用域未调整。

## 验证证据

- 迁移前后分别运行相同的 13 项数据事件与实时消息回归，均通过。覆盖事件合并、刷新竞争、作用域匹配、旧运行时隔离、延迟快照与命令恢复。
- 新增 2 项 AST 架构检查：根目录角色、内部入口限制、Query utils 外部导入限制、React 依赖限制与查询层依赖环检查。
- Web 全量测试 231 项通过。
- AST 对照确认 5 个修改或移动的已有源文件及单独迁移的解析函数，其实现语句保持一致；该结果与行为回归共同作为证据，不单独替代生命周期测试。

没有调整业务断言或引入新请求、连接、状态实例及兼容层。

补充验证：强制 TypeScript 重建、生产构建与首页到会话的生产浏览器回归 1 项通过；覆盖惰性加载、草稿及快捷键焦点。未重跑整个浏览器套件，既有完整浏览器套件的限制仍见 [feature 重构记录](./web-features.md)。

首次 lint 发现普通 import 位于 import type 之后；已修正顺序，剔除注释后的 TypeScript 转译 JavaScript 完全一致。修正后数据事件和架构聚焦检查 8 项通过，没有放宽检查规则。

最终 Web lint 复验通过，i18n CI 提取未更新任何语言文件。

## 查询基础设施归入 core

`query-client.ts` 与 `query-keys.ts` 迁入 `queries/core/`，文件名和导出保持不变。core 表示查询客户端及共享缓存键的基础设施；不新增入口、不增加客户端实例，也不把它归入内部辅助工具。

- 同步更新 17 处源码文件的路径及导入，AST 对照确认实现声明和函数体保持一致。
- 根目录检查调整为仅允许 `*-queries.ts`、`core/` 和 `utils/`，core 内固定保留两个基础设施文件，并检查其不反向依赖 query 接线及辅助实现。
- 根规范与 Web 指南已同步；聚焦检查 17 项、Web 全量测试 231 项通过。
- 最终 lint、强制 TypeScript 重建、生产构建及首页到会话浏览器回归 1 项通过，语言目录未更新。
