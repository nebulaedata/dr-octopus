# 配置提醒与会话重启：实施契约及审查记录

## 1. 状态与审查结论

2026-09-15，实施已完成，自动化验证记录见[主设计第 9 节](./session-config-restart.md)。本文保留实施前审查发现与开发契约，表格中的“当前代码事实”描述审查时的基线，不表示缺口仍未修复。首期仍只通知模型服务，不扩大检测范围；浏览器人工验收尚未完成。

主设计足以说明架构方向，但审查发现下列现状不能直接当作已具备能力。实现应以本文契约补齐，不能仅在接口尾部加通知、将 stop/activate 串联就交付。

| 优先级 | 当前代码事实 | 实施要求 |
| --- | --- | --- |
| 高 | PiSettingsStore 的 configureLocalProvider/loginProvider/logoutProvider 返回 void；本地保存后刷新失败抛普通 Error | 补充提交事实契约，Service 能区分未提交、未变化、已提交及提交后同步失败 |
| 高 | ProviderAuthSessionManager 在记录已取消时直接返回，可能跳过已提交错误分支 | 提交记录与认证 UI 状态解耦，取消不掩盖实际凭据提交 |
| 高 | ChannelConnection 缓存 runtime；重复 subscribe 返回旧 binding；浏览器 subscribeSession 也去重 | 定义同一 Session 的显式订阅刷新，更新双方 binding、租约及快照 |
| 高 | AgentRpcProcess.waitForExit 在超时强杀后仍等待 exit，没有最终时限；retirement 在 finally 清 Slot | Host 超时后保留停止所有权，退出未确认时禁止再激活；不能用 Promise.race 超时视作退出 |
| 中 | SessionDto/SessionRuntimeDto 没有提醒或重启操作字段 | 增加会话级控制投影，覆盖旧进程已退出、新进程尚未出现的空窗 |
| 中 | 幂等 ledger 会重放失败结果；Slot.activate 在 draining 后自动重试激活 | 明确重试键规则与独立的重启门禁，避免重试永久重放错误或普通请求抢入 |

## 2. 保存接入与通知所有者

### 2.1 模型配置

`lib/pi-settings/local-provider-repository.ts` 在现有写入串行边界比较本次有效 Provider 配置与原配置。保持未知字段、区分展示元数据与模型配置；返回模型配置是否改变，不用整个文档文本差异决定通知。不读取或监听外部变更，不新增指纹系统。

`PiSettingsStore.configureLocalProvider` 需要返回内部提交结果，至少包含 changed 和后续 snapshot 同步结果；提交后刷新失败必须通过结构化结果或稳定领域错误保留 changed 事实，不能要求 Service 解析错误文案。

`SettingsService.configureLocalProvider` 是这次业务提交的唯一通知所有者：确认 changed 后调用 ModelConfigChanges，再映射现有响应或错误。通知可以在设置端口返回提交结果后发生，但不能因调用端再次读取 Provider detail 失败而遗漏。迟报版本只可能造成保守提醒，不得提前报告未发生的提交。

不改造所有 Settings 端口，也不新增通用保存包装器。只改本次需要的模型写入与认证提交契约；基础设施端口不引用 ModelConfigChanges、路由、Runtime 或 SSE。

### 2.2 凭据

登录流程由 ProviderAuthSessionManager 的后台任务拥有通知；删除凭据由 SettingsService.resetProviderAuth 拥有通知。两者共享同一 ModelConfigChanges 适配实例。

- `loginProvider` 成功和 `PiCredentialSynchronizationError` 均能证明 Pi 已提交凭据，但当前 void 契约不能证明内容是否改变。
- 提交事实应先记录，再判断认证 UI record 是否仍 active。用户取消与保存完成竞争时，可能继续呈现 cancelled，但不能抹去实际提交的通知；不要为了上报强行覆盖已终结的交互状态。
- 未提交失败、只取消交互以及幂等重放不通知；正常与提交后失败路径只能上报一次。
- 首期凭据的“变化”按 Pi 确认完成一次凭据写入处理。公开 API 未提供 changed 时，允许用户重新认证为相同凭据后产生一次保守提醒；不为去除这次提醒读取、缓存或比较密钥。不把普通模型配置的 changed 比较承诺错误套用到凭据写入。

此语义是轻量通知的明确取舍：普通模型配置重复保存不提醒；凭据成功重新提交可能提醒。验收必须覆盖两者差异。

## 3. HTTP 与投影契约

新 request/response 在 `packages/shared` 的 Session 协议归属处统一定义并提供运行时校验，按仓库约定由 schema 推导类型。以下字段是目标契约，不是现有代码能力。

### 3.1 请求与结果

`POST /api/workspaces/:workspaceId/sessions/:sessionId/restart`

```json
{
  "expectedRuntime": { "runtimeId": "current-runtime-id", "epoch": 3 },
  "allowInterrupt": false
}
```

expectedRuntime 必填，为对象或 null；null 只匹配没有驻留进程且没有进行中激活的会话，不是通配符。allowInterrupt 默认 false。使用 `Idempotency-Key`，scope 为 session，mutation 类型为 session.restart，指纹包括全部请求字段。

成功返回 HTTP 200 和新的 SessionDto，包含新 runtime 与控制状态。不使用 202，不增加异步任务查询 endpoint；客户端在超时或断线后通过现有 GET Session 查询结果。幂等重放返回的是当时结果，客户端仍需刷新当前 Session，避免采用后来已失效的 binding。

| HTTP / code | 含义与客户端行为 |
| --- | --- |
| 409 SESSION_BUSY | 有未结束任务/交互且未确认中断；显示确认框，确认后使用新键 |
| 409 SESSION_RUNTIME_BINDING_MISMATCH | 目标代际不匹配；刷新状态，不自动中断新代际 |
| 409 SESSION_RESTART_IN_PROGRESS | 新任务或不兼容的生命周期操作进入重启门禁；等待状态更新 |
| 409 SESSION_RESTART_UNSUPPORTED | 只读任务结果或未发布草稿不支持此接口 |
| 502 SESSION_RESTART_FAILED | 启动或可确认的停止失败；刷新状态，再根据 retryable 决定重试 |
| 504 SESSION_RESTART_TIMEOUT | Host 等待预算耗尽；查询控制状态，不能假定进程已退出 |

不存在和跨 Workspace 访问沿用现有 404/鉴权规则；幂等冲突与容量错误沿用现有 ledger。失败后主动重试使用新键；同一次网络重试使用原键。提交前的 schema/鉴权错误不启动任何操作。

### 3.2 Session 控制投影

在 SessionDto 增加 `runtimeControl`；不放到可选的 runtime 对象内部：

```ts
type SessionRuntimeControlDto = {
  restartRequired: boolean;
  changedConfigRoutes: string[];
  restart: {
    status: 'idle' | 'restarting' | 'failed';
    error?: { code: string; message: string; retryable: boolean };
  };
};
```

changedConfigRoutes 来自服务端启用名单，按名单声明顺序返回并去重；restartRequired 等于非空检查。内部 revision 不传给浏览器。普通 dormant 会话为 false/空数组/idle；只读结果和未发布草稿也返回中性状态且不提供重启入口。

Slot 持有重启操作状态及最后一次脱敏错误，不持久化、不另建操作目录。业务前置拒绝不改变其状态。接受操作后置 restarting，成功置 idle，失败置 failed；下一次接受重试清错误，删除/Server 关闭清记录。停止已结束、启动失败时可以没有 runtime，failed 仍可展示。

停止退出不明时是特殊的 failed、retryable=false：Slot 仍封锁激活并保留停止 Promise。若稍后确认旧进程退出，才释放封锁、发布可重试状态；不自行恢复已经返回超时的重启任务。

HTTP Session 查询/list 使用同一 mapper 投影；读取控制状态不启动 RPC。旧字段保持既有含义，不给 RuntimeProjectionState 加上业务重启状态。

## 4. 生命周期排序与停止预算

Slot 的重启门禁在第一个异步等待前原子设置，覆盖验证目标代际、停止、容量准入和激活整个区间。内部重启拥有者可调用激活；普通 activate/withExisting 在此期间返回 SESSION_RESTART_IN_PROGRESS，不沿现有 draining.then(activate) 偷偷排队。删除与重启不能并发取得所有权，冲突返回可重新操作的错误。

相同 expectedRuntime 的并发重启只在进行中合并；若已接受 allowInterrupt=true 的操作，后来的调用只是观察该操作，不能扩展其目标。新请求不能将尚未授权中断的操作升级成强制停止。进行中 activation/recovery 也必须纳入门禁，先结算既有所有者再重新校验目标，避免恢复动作与停止动作交错。

busy 判断区分持续的 Agent 工作与普通短 RPC 查询：短操作先有界排空，不要求用户“中断”一次列表查询；任务、压缩、重试、队列及待处理交互则要求 allowInterrupt。排空后仍须在同一门禁内重新确认状态。

新增 Host restartTimeoutMs，默认 60 秒，可注入以便确定性测试。停止/启动各自沿用现有更短预算，外层预算不将底层 Promise 自动视为取消。预算耗尽后禁止迟到的 readiness 发布新 runtime；若子进程已启动，必须由原所有者清理并确认退出后释放 Slot。只增加一个外层预算，不新建重试调度器。

AgentRpcProcess.stop 成功返回可以作为当前退出确认；若未返回或抛错，Host 保留原停止所有权与引用，不调用第二次 start。现有 retirement 的 finally 清理需要调整，禁止失败后把占用同一 sessionPath 的进程遗忘。

Host 保守封锁即可先满足安全性，不要求为了本功能修改 Agent 核心。若实现决定修复底层强杀后的最终等待时限，属于 packages/agent 的具体改动，需先取得该变更的明确确认；“预计无需修改”不是已验证承诺。

## 5. Conversation 重新订阅

业务 SSE 只触发 HTTP 重查；前端看到新的 runtimeId/epoch 后，由统一会话操作层通知 registry/transport 刷新订阅。SessionListItem 和提示条不得直接操作 WebSocket。

新增显式 refreshSessionSubscription(sessionId) 能力，保留 registry 的 view/background retain 理由与输入草稿，仅清当前 transport 的确认 binding：

1. 对仍被保留的会话发送 session.unsubscribe，并等待其 ACK，确保 Server Channel 释放旧 binding 的 reservation；不关闭整条 WebSocket，不影响其他会话。
2. 发送 session.subscribe，等待 session.subscribed 的新 runtime；不能只调用现有 subscribeSession，因为浏览器和 Server 均会命中去重分支。
3. 采用新 generation 并通过现有 bootstrap/snapshot 流程恢复投影；获取快照期间沿用现有事件缓冲/sequence 校验，避免覆盖新消息。
4. 新快照与订阅就绪前禁止发送新会话命令，终结旧代际 pending command 的等待并清理对应 retain，不重发旧命令。

同一会话订阅刷新合并；进行中再次观察到更新代际则补一轮。断线时保留 desired subscription，通过原有 reconnect 完成。多页面各自通过 SSE+HTTP 检测代际并恢复；没有打开/保留的会话只刷新列表，不为菜单重启额外建立对话订阅。

首期无需 Server 主动为所有 Channel 自动重绑，但在重启门禁内对旧 binding 的命令必须拒绝，直到该连接重新订阅。任何被延迟的旧订阅/快照响应都不能覆盖已经采用的新代际。

## 6. 开发入口与完成标准

| 阶段 | 主要文件/模块 | 必须验证 |
| --- | --- | --- |
| 1 提交事实 | lib/pi-settings/types、pi-settings-store、local-provider-repository，SettingsService、ProviderAuthSessionManager | changed、提交后同步失败、取消与提交竞争、凭据保守提醒，单次提交仅一位上报所有者 |
| 2 通知封装 | lib/runtime-config、ModelConfigChanges、Server 装配 | 名单过滤、基线比较、订阅异常隔离、仅模型服务参与 |
| 3 重启核心 | runtime Slot/Coordinator/retirement、Sessions API、shared Session 协议 | busy、代际、幂等、删除/激活/恢复竞争、迟到启动、停止不明时绝不双进程 |
| 4 Web 闭环 | SessionListItem、会话提示及操作层、registry、realtime-client、Session 查询投影 | 真实 unsubscribe/subscribe 握手、多页面恢复、两入口共享状态、失败无 runtime 仍可显示 |

可以先开发手动重启再接通知，但通知上线前必须完成第 1 阶段，不能先接 Service 成功路径后宣称提交检测完整。

优先运行与上述行为对应的 Server/Web/Shared 聚焦回归，再运行相关范围的 test、lint、typecheck。浏览器验证真实模型配置修改后提醒、点击重启后连接可继续对话，并用可控 Provider 验证实际请求地址变化。实际实施验证及未完成的人工验收见主设计第 9 节。
