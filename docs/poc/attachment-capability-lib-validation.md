# attachment-capability-lib：概念验证与验收

架构设计：[原设计](../architecture/attachment-capability-lib.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

## 11. 测试要求

### 11.1 单元测试

- 四类结果的 happy path/拒绝路径和未知 MIME reject；所有非 `rejected` 类别必须存在默认可达规则。
- 声明 MIME、扩展名、magic bytes 或容器结构任一冲突时 reject。
- 每条不可覆盖安全拒绝规则。
- processor/tool/model capability 缺失时的 defer、降级和 reject。
- 数值上限取最小值、allow-list 交集、deny-list 并集。
- 相同冻结输入产生深度相等的 Resolution，输入对象不被修改。
- 任意规则顺序不得改变 deny 优先级。

### 11.2 属性与模糊测试

- 任意负数、NaN、极大 size/页数/像素都不能得到 allow。
- 产品白名单之外的格式在任何租户覆盖下都只能得到 reject。
- delivery capabilities 不得包含策略禁止或部署不具备的能力。
- 只有 `structured-file-read` 和 `lexical-search` 时，大文档仍能得到允许的 `manifest-path/retrieval` 交付。
- `semantic-vector-search` 缺失不得单独导致可预处理文档 defer/reject；存在时也不得绕过 inline 或安全上限。
- 未知字段和未知 MIME 不导致异常泄漏或宽松放行。

### 11.3 契约测试

- Processor 目录与 `AttachmentProcessorCapability` catalog 一致。
- Agent Adapter 只消费 Resolution 允许的 delivery capability。
- `rejected/none` 永远不会到达 Blob materialization、Prompt 或 Pi RPC。
- `manifest-only-binary` 永远不产生媒体 processing step，且 manifest 标记 `contentAvailableToModel: false`。
- 持久化后的 policy/rule version 可重放得到相同历史决策。

## 12. 实现验收

- 源文件符合仓库 JSDoc header 和函数注释规范，每个文件保持单一职责。
- lib 可在纯 Node test 中构造，不启动 Fastify、SQLite、Pi 或外部二进制。
- 公共出口只从 `index.ts` 暴露 contracts 和 resolver factory，不导出内部规则 helper。
- 默认规则、默认策略和合并逻辑均有确定性 fixture，不使用当前机器探测结果。
- 分类决策 trace 只记录分类、规则 ID、策略版本和诊断码，不记录文件内容。
