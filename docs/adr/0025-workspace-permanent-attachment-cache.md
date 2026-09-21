# ADR-0025：使用 Workspace 永久附件物化缓存

## 状态

Accepted

工作区外回退策略已由 [ADR-0054](./0054-workspace-attachment-delivery-and-pdf-coverage.md) 替代；保留工作区永久缓存。

## 背景

附件权威 Blob 与派生物当前位于 `~/.dr-octopus/server/attachments`。Agent 读取非图片附件时，Host 把副本物化到
`<serverDataDir>/attachments/materialized` 并在 Prompt 中提供绝对路径。该路径位于 Workspace 外，因此
Permission System 将其标记为 external；即使用户批准工具执行，Context Mode 的 `ctx_execute_file` 仍会按自身的
项目边界拒绝读取。

修改 `CLAUDE_CONFIG_DIR` 会同时改变 Pi Skills 等资源的发现位置；为 context-mode 配置全局 Host 附件白名单又会
耦合 Agent 与 Server 路径。产品需要在不改变这两类契约的情况下，让附件文件真实位于当前 Workspace 边界内。

## 决策

1. Server 的 SQLite、上传 staging、原始 Blob、派生物、备份和状态继续位于 Server 数据根；Workspace 缓存不是
   权威存储，不进入备份，也不能回写任何 Server 数据。
2. 需要文件路径的附件工件固定物化到 `<cwd>/.dr-octopus/temp/attachments`。缓存按实际工件 SHA-256 内容寻址，
   跨 Session 和 Server 重启复用。
3. `<cwd>/.dr-octopus/temp/.gitignore` 由 Host 确保存在，完整内容为 `*`，同时忽略附件缓存与 `.gitignore` 自身；
   Host 不修改项目根或 `.dr-octopus` 根级 ignore 文件。
4. 已发布缓存永远不由 Octopus 主动清理：不在 Session、Runtime、Server、附件删除、TTL、LRU、容量或磁盘水位
   事件上删除。用户可以手动删除，Host 在再次需要时重建。
5. 未发布的事务 `.tmp` 文件可以由当前失败路径移除；哈希不匹配的已发布条目可以原位修复。这两项是一致性操作，
   不构成缓存回收策略。
6. 每次复用前以 Server 权威大小和 SHA-256 校验。缓存只向 Agent 暴露，不能成为下载、预览、处理、恢复或备份来源。
7. Host 必须执行规范路径包含校验并拒绝 symlink、junction 和 reparse point。只读 Workspace、Git 跟踪冲突、
   `.gitignore` 冲突或安全校验失败时，回退到 Server 全局物化路径和现有 external Permission Gate。
8. 内部路径消除的是 external 与 Context Mode 项目边界问题，不改变精确工具审批。`ctx_execute_file` 是否自动批准
   仍由 Permission System 工具策略决定。

完整设计见[《Workspace 附件永久物化缓存设计》](../architecture/workspace-attachment-temp-cache.md)。

本 ADR 修订 ADR-0022 中“附件短期物化只位于 Server 数据根、Workspace 不存放附件副本”的决定；ADR-0022 的
Agent/Server 配置所有权、依赖方向和权威 Server 数据根保持有效。

## 结果与权衡

### 正面结果

- 文件真实位于 Workspace 内，普通读取不再被识别为 external，Context Mode 项目边界也能自然通过。
- 不修改 `CLAUDE_CONFIG_DIR`、Pi Trust 或 context-mode 上游实现。
- 内容寻址使相同工件跨 Session 和重启复用，避免重复物化大文件。
- Server 权威附件与 Agent 可修改副本保持单向隔离。
- 自带 `.gitignore`，无需改动用户仓库的已管理文件。

### 负面结果

- 缓存磁盘占用永久增长，Octopus 不提供自动容量治理。
- 删除 Server 附件不会删除已经进入 Workspace 的副本；彻底删除需要用户手动删除 Workspace temp。
- `.gitignore` 不能阻止 IDE、索引器、备份或云同步读取缓存。
- Workspace 内同一 OS 用户进程可篡改缓存，因此每次复用都有额外哈希成本，且缓存不能成为安全边界。
- `temp` 名称与永久保留语义存在直觉差异，需要通过文档稳定说明。
- Workspace 不可写或路径存在冲突时仍会回退并触发 external 审批。

### 中性结果

- `ctx_execute_file` 仍可能弹出工具执行审批；路径授权与任意代码执行授权继续分离。
- 用户删除 `.dr-octopus/temp` 后不会丢失权威附件，下次使用会重新物化。

## 备选方案

- **继续使用 Server 全局短期物化目录**：生命周期集中，但无法通过 Context Mode 项目边界，拒绝作为正常路径。
- **把整个附件权威存储迁入 Workspace**：路径天然内部，但耦合 Workspace 生命周期、污染备份边界并允许 Agent
  修改权威字节，拒绝。
- **Workspace 缓存采用 Session/TTL/LRU 清理**：可以控制磁盘占用，但与已确认的永久复用和永不清理语义冲突，拒绝。
- **修改 `CLAUDE_CONFIG_DIR` 或 Pi Trust**：影响 Skills/项目资源发现，且 Trust 不是附件文件访问 ACL，拒绝。
- **为 context-mode 增加 Host 附件白名单**：能够保持文件在 Server 根，但需要上游能力或长期 fork，并形成路径耦合，
  暂不采用。

## 参考

- [ADR-0021：Host 持有附件生命周期并在消息边界适配给 Pi](./0021-host-owned-attachment-lifecycle.md)
- [ADR-0022：分离 Agent 与 Server 配置所有权](./0022-global-runtime-data-root.md)
- [Workspace 附件永久物化缓存设计](../architecture/workspace-attachment-temp-cache.md)
