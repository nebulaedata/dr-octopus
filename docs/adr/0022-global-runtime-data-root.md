# ADR-0022：分离 Agent 与 Server 配置所有权

## 状态

Accepted（附件物化位置由 ADR-0025 修订）

> ADR-0025 仅修订本文关于附件短期物化位置、Workspace 不存放附件副本及其 Permission Gate 的决定；
> Agent/Server 配置所有权、依赖方向和 Server 权威数据根继续有效。

## 背景

Server 曾默认把 SQLite 与附件写入 `process.cwd()/data`，附件适配器还会在用户 Workspace 下创建
`.dr-octopus/attachments`。这使运行目录影响持久化位置，并污染源码仓库或外部项目。Pi 已将用户级 Agent
数据放在 `~/.dr-octopus/agent`，但没有公开获取其父级产品根目录的函数。

## 决策

Dr.Octopus 的 Agent 与 Server 默认共同位于 `~/.dr-octopus`，但配置与代码所有权严格分离：

- Pi Agent 专属数据默认位于 `~/.dr-octopus/agent`，只由 Pi/Agent 配置管理，可通过
  `DR_OCTOPUS_CODING_AGENT_DIR` 覆盖。
- Server SQLite、附件、备份与状态默认位于 `~/.dr-octopus/server`，只由
  `apps/server/src/lib/config` 管理，可通过 `SERVER_DATA_DIR` 覆盖。
- 受管 Workspace、General Workspace 与 Context Mode 保持为产品级顶层目录。
- Host 启动 Pi RPC 时显式传入已解析的 Agent 目录，禁止 Agent 反向了解或推导 Server 路径。
- 附件短期物化位于 `<serverDataDir>/attachments/materialized`，Prompt 使用绝对路径；外部 Workspace
  不再存放附件副本。
- `packages/agent` 不得定义 `serverDir`、数据库、附件、备份或物化路径；Server 组合根可以引用 Agent
  公共契约，但 Agent 不得引用 Server 配置。
- Server 路径通过 `apps/server/src/lib/config/server-paths.ts` 生成并由组合根注入；业务 Service 不读取
  cwd 推断持久化位置。
- Server 物化文件位于 Workspace 外，因此 Agent 对其读取继续遵循标准外部路径 Permission Gate；不得增加
  `isManagedAttachmentRead` 一类依赖 Server 目录结构的隐式放行规则。

## 备选方案

- **在 `packages/agent` 聚合 Server 与 Agent 路径**：形成 Agent 对 Host 的反向依赖，拒绝。
- **直接使用 `getAgentDir()` 存放 Server 数据**：会把 Host 生命周期耦合到 Pi Agent 配置目录，拒绝。
- **通过 `dirname(getAgentDir())` 推导根目录**：Pi 的 Agent 环境变量可指向任意目录，父目录语义不稳定，拒绝。
- **把 SQLite 和附件直接放在 `<octopusRoot>`**：可工作，但会混淆 Pi、Host 与未来宿主的所有权，拒绝。
- **继续使用 Workspace 相对附件路径**：读取简单，但污染用户项目且不能保证全局治理，拒绝。

## 结果与权衡

正面结果：启动 cwd 不再影响数据位置；Agent 与 Server 默认物理共址但代码和配置互不反向依赖；备份与
清理可以按 Server 数据目录治理；源码仓库和外部 Workspace 不再产生附件运行时文件。

代价：外部 Workspace 中的 Agent 读取附件时使用 Host 管理的绝对路径，并按照标准外部路径规则请求权限；如果
部署者分别覆盖 Server 与 Agent 目录，两者可以不再拥有共同父目录，这是配置解耦后的明确选择。
