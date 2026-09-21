# ADR-0050: Agent 内置扩展持有全局长期记忆

## Status

Accepted — 2026-09-12。用户明确授权修改 Agent 并实施全局记忆、Drizzle 存储和 Web 投影。

数据库访问与服务生命周期现由 [ADR-0059](./0059-agent-owned-memory-daemon.md) 更新：Memory 单例后台持有连接，CLI/RPC/Server 通过异步 SDK 访问。

## Context

同一用户的不同 Workspace、Session、TUI 和 Web 需要共享偏好、决策与稳定约定。TUI 不应依赖 Server；Web 管理不应启动 Agent 或维护另一套记忆规则。

## Decision

- 由 packages/agent/src/extensions/memory 持有领域规则、Drizzle Schema、SQLite 基础设施和公开 SDK；CLI 装配为 octopus-memory 内置扩展，TUI 与 RPC 共用。
- 通过公开 CONFIG_DIR_NAME 和 homedir() 定位产品数据根，数据库唯一路径为 ~/.dr-octopus/memory/memory.db。agentDir、cwd 和 Workspace 不参与路径或可见性计算。可信 dataRoot 注入用于隔离测试。
- 标准表/约束采用 Drizzle；独立 drizzle/memory 目录随构建发布。仅 FTS5 虚表和同步触发器使用 Drizzle custom migration。短事务与迁移锁提供进程间一致性。
- 一事实一 Section；索引负责导航。请求幂等、乐观版本检查、统一 activation sequence 和 revision 游标支持持续积累。忘记删除所有版本并推进写入 epoch，保留来源/事实散列屏障防止旧推理恢复已删除内容。
- 模型仅有 recall/read 工具，受每轮调用和响应预算限制。Curator 在 agent_settled 后使用现有模型进行有限推理，事务提交前检查取消与写入 epoch。普通 Agent 默认 auto；manual 仅处理明确意图，off 停止召回和自动整理。子进程可由组合根强制 readOnly。
- Server 管理接口调用同一 SDK，沿用 Host 现有访问边界。Web 的 Header“记忆”进入全局 /memory，页面无需 Workspace 或运行中的 Agent。原生 RPC 工具与版本化状态独立投影，HTTP 数据是当前事实权威。
- 全局记忆模式在 Settings → 基础 → 记忆（/settings/memory）配置，同时支持设置弹窗；/memory 负责数据管理，并显示当前模式和设置入口。

## Consequences

所有会话共享事实与写入竞争，需要保留事实主体和适用条件。短索引及有限 FTS/分页不能保证找到全部历史，预算终止必须明确。Markdown 导出是副本，FTS 是可重建派生数据。

Web 使用 5 秒可见页面轮询与写后失效；运行状态是最近观察值。自动整理增加最多 10 秒稳定收尾时间；失败不阻断主 Agent，也不伪报写入成功。完整模型效果、十万条规模和跨平台性能需要独立实测，不能由适配器测试推断。

## Validation

隔离真实 SQLite 测试覆盖默认路径、惰性读、迁移、跨实例共享、超过 100 条分页、Unicode 续读、20 个并发客户端、批次回滚、冲突重判、删除屏障、取消及只读模式。公共 Pi ResourceLoader 验证构建出口和资源存在；TUI/RPC 适配器及 Fastify 注入测试验证独立管理闭环。浏览器使用临时库验证 /memory 的创建、编辑、模式、刷新及响应式入口。

详细契约见 [长期记忆设计](../architecture/octopus-memory.md)。
