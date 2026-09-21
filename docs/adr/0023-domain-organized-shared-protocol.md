# ADR-0023：按领域组织 Shared Protocol

## 状态

Accepted

## 背景

`packages/shared/src/types/index.ts` 曾同时承载 Session、Workspace、Skill、Realtime、Goal、Permission 等多个领域，
并混合 TypeScript 类型、运行时常量和校验函数。附件能力随后以 `src/attachments/index.ts` 引入 Zod Schema，形成了
`types` 与 `attachments` 并列但语义层级不一致的结构，也遗留了重复且未使用的 `AttachmentDto`。

## 决策

- `protocol` 是 Shared 包跨应用、跨进程数据契约的顶层语义，附件是其领域子协议。
- 控制面协议按 runtime、sessions、workspaces、skills、realtime、goals、subagents 等领域拆分，禁止继续向单一
  `types/index.ts` 聚合无关契约。
- 附件协议位于 `src/protocol/attachments`，进一步拆分 resource、message、processor 和 document 契约；目录
  `index.ts` 只负责公共导出。
- HTTP、WebSocket、Processor IPC、Agent manifest 和持久化 JSON 等不可信运行时边界，应使用 Zod Schema
  作为唯一权威并通过 `z.infer` 推导 TypeScript 类型，禁止手写重复结构。
- 已由边界层校验的数据以及只在编译期流转的内部 DTO，可以直接使用 TypeScript 类型或接口。
- 公共入口为 `@octopus/shared/protocol` 与 `@octopus/shared/protocol/attachments`；项目尚未发布，因此删除
  `@octopus/shared/types` 与 `@octopus/shared/attachments` 旧入口，不保留兼容别名。

## 备选方案

- **继续保留 `types` 技术分类目录**：改动较小，但会持续混合业务领域和运行时值，拒绝。
- **所有 Protocol 全部改写为 Zod**：运行时保障最强，但会为当前只在可信内部流转的静态 DTO 引入不必要成本，拒绝。
- **附件与 Protocol 并列**：短路径简洁，但错误表达了二者层级关系，拒绝。

## 结果与权衡

正面结果：目录直接表达领域边界；附件运行时 Schema 与推导类型保持单一事实来源；消费者通过明确的公共子路径
识别协议依赖；新增领域不再扩大通用类型文件。

代价：现有调用方需要一次性更新 import；控制面中尚未使用 Zod 的外部边界仍需按风险逐步补齐运行时校验，不能
因为目录迁移就假定未知数据已经可信。
