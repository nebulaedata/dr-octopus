# ADR-0024：采用可选的 Server 本地滚动文件日志

## 状态

Accepted

## 背景

`apps/server` 当前通过 Pino 输出 stdout。容器和服务管理器适合直接采集 stdout，但 Dr.Octopus 也需要支持不依赖外部日志服务、系统守护进程或额外数据库的独立桌面和单机部署。

本地文件日志必须遵循 ADR-0022 的 Server 配置所有权，不能写入源码仓库、当前工作目录、Workspace 或 Agent 数据目录。同时，文件写入和磁盘故障不能默认破坏 Server 业务可用性。

## 决策

- stdout 始终保留，并继续作为默认日志输出。
- 本地文件日志默认关闭；显式启用后与 stdout 双写。
- 日志目录固定由 `SERVER_DATA_DIR` 派生为 `<serverDataDir>/logs`，不增加独立路径覆盖变量。
- 日志目录按需创建，不在功能关闭时保留空目录。
- 文件采用 UTF-8 JSONL，使用 Pino transport worker 与 `pino-roll` 按日期、大小轮转。
- 文件 destination 在落盘前执行独立字段白名单与错误安全投影，不持久化未知对象或正文型字段。
- rolling worker 显式发布当前活动文件；Server 自有 retention janitor 仅在登记有效时按保留期、文件数和总容量清理历史文件。
- 单写者 Lease 通过完整临时记录和原子硬链接竞争发布；陈旧 Lease 接管先竞争旧 token
  对应的恢复声明并在删除前复核所有权，只有确认 transport 关闭后才释放。
- 文件输出默认 fail-open：失败时降级到 stdout；合规部署可以配置启动时 fail-closed。
- Server 运行日志与 Permission System 审计日志保持物理和语义隔离。
- V1 只支持一个 Server 进程独占一个 `SERVER_DATA_DIR`。

## 结果

### 正面结果

- 独立部署无需引入日志服务或系统级轮转工具。
- 容器与标准服务部署仍能使用 stdout 采集链路。
- 日志路径、清理范围和 Server 数据所有权保持一致。
- 文件写入不阻塞请求主路径，且故障默认不会中断业务。

### 负面结果

- Server 需要承担 transport 生命周期、磁盘容量治理和故障测试。
- 异步写入在进程被强制终止时可能丢失少量尚未刷新的日志。
- 本地文件日志不提供跨机器汇总、检索和告警。

### 中性结果

- 需要增加 `pino-roll` 直接运行时依赖。
- 日志文件不是审计或业务事实的权威数据源。

## 备选方案

- **只保留 stdout**：运维模型最简单，但独立桌面部署缺少受管的历史诊断日志。
- **默认启用文件日志**：诊断信息更容易留存，但会在用户未选择时持续占用磁盘并产生敏感数据落盘风险。
- **要求 logrotate/systemd/Docker 管理文件**：适合服务器环境，但违反独立部署约束。
- **自行实现滚动写入流**：可完全定制，但会重复处理文件句柄、轮转竞态和跨平台细节。
- **使用 SQLite 保存日志**：便于查询，但会放大数据库写入、争用和容量治理压力，并混淆控制面数据与诊断数据。
- **使用远程日志平台**：能力完整，但引入网络、凭据和外部基础设施依赖。

## 参考

- [Server 本地文件日志设计](../architecture/server-file-logging.md)
- [ADR-0022：分离 Agent 与 Server 配置所有权](./0022-global-runtime-data-root.md)
- [Pino transports](https://github.com/pinojs/pino/blob/main/docs/transports.md)
- [pino-roll](https://github.com/mcollina/pino-roll)
