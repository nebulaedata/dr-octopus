# ADR-0017: Fastify 数据库生命周期插件与模块级应用组合

## Status

Accepted; service dependency injection amended by ADR-0018

## Context

Server 的 SQLite/Drizzle 连接此前由 `app.ts` 直接创建和关闭，再通过
`registerApplicationModules` 的 options 传给 Repository。该方式可以运行，但基础设施初始化、业务
模块组装和 shutdown ownership 混在同一 composition root 中；数据库也无法通过 Fastify 的插件启动
失败语义、decorator 可见性和 `onClose` 顺序形成完整生命周期契约。

另一方面，业务 Services 依赖显式构造器注入，Health 是 HTTP 模块。把所有对象都改成 Fastify
decorator 会扩大框架耦合，并削弱现有模块边界。

## Decision

1. 使用具名 `database` Fastify plugin 创建唯一的 control-plane 数据库，发布 `database` decorator，
   并在 `onClose` 中关闭 SQLite。重复注册是启动配置错误。
2. `app.ts` 只负责按顺序注册基础设施插件和应用模块，不再持有或关闭数据库连接。
3. `registerApplicationModules` 迁入 `modules/index.ts`。它从 Fastify 读取基础设施 decorator，但继续通过
   构造器把数据库、Runtime 和其他依赖显式注入 Repository/Service；业务 Service 不迁移为 plugin。
4. Health 继续作为普通 HTTP 模块。`/health` 只表示进程存活；`/ready` 每次请求执行 SQLite
   `SELECT 1`，并读取 Session Runtime Coordinator 的请求接收 gate。任一检查失败返回 HTTP 503，且
   只公开稳定的 `ready/unavailable` 状态。
5. CORS、rate limiting、WebSocket 和现有模块注册方式保持不变。本决策不引入聚合 `services`
   decorator，也不允许 Controller 直接访问数据库或 Runtime。

## Consequences

### Positive

- 数据库的创建、共享与关闭只有一个 Fastify 生命周期 owner。
- 数据库初始化失败通过 Fastify startup 失败传播，测试可以独立验证 plugin 契约。
- `app.ts` 保持基础设施 composition root，`modules/index.ts` 集中表达应用模块组合。
- readiness 反映当前依赖状态，而不是启动时写死的成功结果。
- Service 和 Controller 保持框架无关或只依赖窄接口，避免把 Fastify decorator 变成 service locator。

### Negative

- 数据库初始化从 `createServer()` 调用时推迟到 Fastify `ready()`/`listen()` 阶段；启动调用方必须等待
  Fastify 启动 Promise 才能判定成功。
- `modules/index.ts` 是应用 composition seam，会同时认识 Fastify decorator 与 Service 构造器，需要
  控制其职责，避免业务逻辑进入该文件。

### Neutral

- SQLite、Drizzle、schema 初始化和 Repository API 不变。
- Session Runtime 继续由 ADR-0016 的独立 `session-runtime` plugin 管理。
- 当前为单 Server 进程语义；本决策不提供跨进程数据库连接共享。

## Alternatives Considered

### 继续由 `app.ts` 手工创建和关闭数据库

拒绝。它让 composition root 同时承担资源实现细节，并绕过 Fastify 插件的启动与关闭契约。

### 把所有 Services 迁移为 Fastify plugin/decorator

拒绝。Services 已有清晰的显式依赖注入边界；全面 decorator 化会增加框架耦合和隐式依赖，对当前需求
没有收益。

### 把 Health 迁移为基础设施 plugin

拒绝。Health 是 HTTP 能力模块；通过窄 probe 契约读取基础设施状态即可，无需拥有资源生命周期。

## References

- [ADR-0012: Server Runtime 基础库边界](./0012-server-runtime-library-boundary.md)
- [ADR-0016: 稳定 Session Runtime Slot 与就绪门禁](./0016-stable-session-runtime-slots.md)
- [Dr.Octopus Server 架构设计](../architecture/octopus-server.md)
