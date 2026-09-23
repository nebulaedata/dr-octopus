# ADR-0018: Fastify 实例作为 Module Service 的统一上下文

## Status

Superseded by [ADR-0066](./0066-server-module-autoload.md)。以下保留历史决策；业务 Service 改为由模块入口显式注入资源，不再持有完整 Fastify 实例。

## Context

数据库和 Session Runtime 已由 Fastify plugins 创建、发布并管理生命周期。应用组合层此前从
Fastify decorators 读取这些对象，再把具体对象或 readiness callbacks 逐层传给 Service 和
Controller。这保持了窄依赖契约，但每新增一个跨模块 plugin 能力，都需要扩展组合参数并经过中间层
传递。

Server Module 现在要求所有 Service 构造器都以当前 `FastifyInstance` 作为第一个参数，使 Service
能够在需要时直接读取同一封装域内的 plugin decorators。该决策修订 ADR-0017 中业务 Service 不持有
Fastify 实例的限制，但不改变 database 和 session-runtime plugins 的生命周期所有权。

## Decision

1. `apps/server/src/modules` 下的每个 `*Service` 构造器都以 `FastifyInstance` 为第一个参数。
2. Service 将该实例保存为受保护的只读上下文，后续参数继续表达该 Service 独有的业务依赖与配置。
3. `SessionsService` 默认从 `server.database` 创建 `SessionsRepository`，并从
   `server.sessionRuntime` 获取 Runtime；测试可用 options 覆盖这些具体依赖。
4. `EffectiveSkillsService` 默认从 `server.sessionRuntime` 获取 Runtime；测试可覆盖 Runtime。
5. `HealthService` 直接从 server decorators 执行数据库和 Runtime readiness 检查，不再接收探测器或
   decorator 对象。
6. Fastify plugins 仍是基础设施实例及其启动、关闭生命周期的唯一 owner；Service 不注册、替换或关闭
   plugins。

## Consequences

### Positive

- 新 plugin decorator 可由 Service 直接访问，无需在应用组合函数中增加逐层透传参数。
- 数据库、Runtime 与请求模块使用同一 Fastify 封装域中的实例。
- `modules/index.ts` 不再创建 `SessionsRepository`，也不再显式传递 database 或 session-runtime。

### Negative

- 所有 Module Services 都耦合 Fastify，无法脱离 Server 框架单独构造。
- Service 的静态构造器契约不再完整枚举其可能使用的 plugin 能力，依赖发现需要检查实现。
- 单元测试必须提供 Fastify 实例；直接访问更多 decorators 时，测试需要注册或装饰相应替身。
- 完整 Fastify 实例赋予 Service 超出当前职责的能力，需要代码审查防止 Service 注册路由、关闭 Server
  或修改无关 decorators。

### Neutral

- 现有业务 options 仍用于 Workspace、附件限制和测试替身等非 plugin 配置。
- HTTP Controller 继续只负责协议解析和响应映射。

## Alternatives Considered

### 仅向实际需要 plugin 的 Service 注入 Fastify

拒绝。虽然能减少框架耦合，但不能形成所有 Service 一致的首参数约定。

### 继续注入窄接口或具体依赖

拒绝。它保留最明确的依赖契约，但新增共享 plugin 能力时仍需要更新组合层和中间参数。

### 引入只包含 decorators 的独立 Application Context

暂不采用。它能限制 Service 权限，但会建立第二套上下文对象，不能满足直接访问当前 Fastify 实例的
约束。

## References

- [ADR-0017: Fastify 数据库生命周期插件与模块级应用组合](./0017-fastify-database-lifecycle-plugin.md)
- [Dr.Octopus Server 架构设计](../architecture/octopus-server.md)
