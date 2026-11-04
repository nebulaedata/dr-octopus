# 独立配置变更服务验收计划

日期：2026-11-04。作者：Codex。

状态：2026-11-04 已实施；以下保留原验收计划，实际执行结果追加于第 6 节。

设计：[独立配置变更服务](../architecture/configuration-change-service.md)。决策：[ADR-0093](../adr/0093-independent-configuration-change-service.md)。当前实现及历史验证：[配置更新通知检查](agent-configuration-notification-review.md)。

## 1. 验证目标

服务所有权提取成功的证据是：配置模块不再经由 sessionRuntime 发布，所有发布者和 Runtime 共享同一实例，现有行为不变且关闭完整。文件减少、类重命名或单测通过不能单独证明成功。

## 2. 验收矩阵

| 验证项          | 必须观察的结果                                                                       | 计划位置                                |
| --------------- | ------------------------------------------------------------------------------------ | --------------------------------------- |
| 唯一实例        | 配置模块发布后，相同 Server 的 Runtime 能读取变化；两个 Server 不共享版本            | 配置资源插件集成测试                    |
| 必需依赖        | 缺少配置资源或注入不匹配的 Coordinator，在启动阶段失败，不创建隐式备用服务           | app/plugin 装配测试                     |
| 无 Agent 发布   | 没有驻留会话时保存配置会记录版本，但不创建 Pi 进程                                   | configuration-notifications.test.mjs    |
| 全局版本        | 旧实例提示，新启动实例不误报；不同会话互不清除过期状态                               | 服务与 Coordinator 测试                 |
| Workspace 隔离  | A 的技能变化只影响 A；全局技能影响所有旧实例                                         | 服务与 HTTP/子进程回归                  |
| 启动期间变化    | spawn 前取基线，ready 前发生更新后仍提示过期                                         | Coordinator 确定性启动竞争测试          |
| MCP 无变化/失败 | 重复启停、stale revision、未提交失败不通知；原子提交后投影失败仍通知一次             | pi-mcp-store.test.mjs                   |
| 幂等重放        | 同一 HTTP mutation 的重复响应不再次发布；Registry 不新增请求级去重                   | HTTP 回归                               |
| 模型/认证       | Save/OAuth 只 invalidate；monitor 确认一次后发布；原文件事件去重保留                 | model-config-monitor/provider-auth 测试 |
| 默认模型        | 只刷新模型意图/catalog，不增加旧会话重启提示                                         | conversation-start/provider 回归        |
| 环境与 Jev      | Agent 实际变化提醒，Server 环境不进入 Agent 提示；凭据提交后响应失败仍可保守通知     | 环境/凭据 HTTP 回归                     |
| 技能写入        | 创建、改动、删除、上传提交后通知；普通无变化保存不通知，作用域正确                   | Skills 与 HTTP 回归                     |
| 观察者异常      | 一个订阅者失败不阻断其余订阅者；版本已记录、保存结果不回滚、不包含敏感数据           | 服务测试                                |
| 提示行为        | 仅保存不会更换 runtimeId/epoch，不产生自动 whenIdle 意图；用户重启后原会话身份保持   | HTTP + 确定性 RPC 子进程回归            |
| SSE 单通道      | 每次控制状态失效只由既有 Sessions 桥接，不增加第二路配置推送；断线后 HTTP 可恢复真相 | data-events/Session 回归                |
| 生命周期        | 停止 watcher/后台写入，释放 Runtime/Sessions 订阅，最后关闭资源；重复 close 幂等     | Fastify onClose 集成测试                |
| 晚到回调        | 资源关闭后的回调不更新版本、不调用 SSE；没有残留监听、定时器或活动进程               | 关闭与异步认证竞争测试                  |
| 旧引用删除      | 无 runtime.configChanges、旧 RuntimeConfigChanges 构造/关闭或旧路径重导出            | 引用与干净产物检查                      |
| 敏感信息        | 事件、日志及 DTO 不包含凭据、变量值、MCP 文档或技能正文                              | 合成秘密回归                            |

## 3. 风险与检查重点

- Fastify 祖先/兄弟作用域不同：必须证明独立资源在正确祖先作用域共享，不能仅添加 TypeScript decorator 声明。
- 配置插件可能过早关闭：测试实际关闭顺序，并注入待完成的 watcher/认证任务，不以注册顺序推断资源已经释放。
- 全局序号与 Workspace 局部索引同时存在：用交错更新测试确认基线比较不会跨 Workspace 误报，也不会遗漏后续全局更新。
- 模型监视器当前既处理保存也处理文件事件：替换通知依赖时不能同时保留入口直发和 monitor 直发。
- Jev 的错误路径只能通过已观察 revision 确认配置变化，不能精确归属并发写入；保留保守通知，并在报告中区分于准确的提交回执。
- 通知与持久写入不具备跨进程事务保证；测试不把内存事件解释为可靠消息队列。

## 4. 执行顺序

1. 保留当前实现的源码与确定性聚焦基线，使用当前通知回归建立前后可比结果。
2. 新服务与插件聚焦测试，随后验证 Coordinator 注入、启动竞争和关闭顺序。
3. 模块逐项迁移后运行现有 HTTP、幂等、模型监视器、环境、技能与重启回归。
4. 删除旧文件后干净构建，检查没有残留编译入口，再运行 Server test、lint、typecheck。
5. Web/Shared 原则上不改；如实施确实改到外部 DTO 或页面，扩大对应包与浏览器验证范围。
6. 记录运行环境、每次失败、跳过原因与最终结果；不通过提高超时、忽略失败或只更新快照证明行为不变。

## 5. 设计阶段记录（实施前）

- 已只读核对现有配置记录器、Coordinator 创建/关闭、Fastify 资源注册、各配置发布入口、模型监视器和 Sessions/SSE 桥接。
- 已形成设计与 ADR 提案；尚未创建新运行时服务、注册插件、迁移调用方或执行新方案运行测试。
- 先前实现的附件存储水位、开发 watcher 超时和 Web React 测试基线失败保留在[历史检查记录](agent-configuration-notification-review.md)，不能因本次设计归档而改写为已解决。
- 本次仅应验证 Markdown 格式、链接与差异，不运行无关业务测试。实施后在本文件追加实测结果，不覆盖以上计划与历史限制。

## 6. 实施记录（2026-11-04）

- 独立 ConfigurationChanges 和 Fastify 插件已接入；Coordinator 只接收读取能力，移除创建、公开发布和关闭所有权。配置模块使用绑定类别的窄提交回调。
- 39 项聚焦测试通过，包含新资源隔离、观察者失败、关闭后回调、Fastify 实际关闭顺序、错误实例注入、HTTP 提交、模型监视器与 Session 生命周期。
- 源码和测试迁移中发生编码读取中断及重复编辑编译错误，已根据编译诊断清理；未修改业务断言或增加测试超时。
- 首轮全量 444 通过、3 失败、1 跳过：三个 WebSocket 测试替身缺少新契约要求的配置实例。已显式注入实例并保留全部原断言，独立复测 3/3 通过。
- 最终 Server 全量 447 通过、0 失败、1 项既有私有 PDF fixture 跳过；干净构建、lint、typecheck 通过。测试 TEMP/TMP 使用 D 盘，避免已确认的 C 盘水位限制，不更改产品保护阈值。
- 旧源码引用及旧 dist 入口已检查移除；Markdown 本地链接与 git diff --check 通过。本次服务提取不修改 Agent 核心、Shared DTO 或 Web 行为。
- 原始全量日志：仓库本地 .cache/independent-configuration-service-tests.log、.cache/independent-configuration-service-final.log。前者保留首次失败，后者记录最终结果；不提交日志。
- 未执行浏览器人工验收、真实付费模型调用或跨 Server/CLI 外部同步验收；这些能力不因本次单进程服务提取而获得额外保证。
