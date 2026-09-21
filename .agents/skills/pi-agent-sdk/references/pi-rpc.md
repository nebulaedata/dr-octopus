# Pi Coding Agent RPC 模式

本参考针对 `@earendil-works/pi-coding-agent@0.84.3`。设计或调试 RPC
宿主时，先核对实际安装版本的以下文件：

- `dist/modes/rpc/rpc-types.d.ts`：线协议类型的最终依据；
- `dist/modes/rpc/rpc-mode.js`：服务端命令、事件、关闭与扩展 UI 行为；
- `dist/modes/rpc/rpc-client.d.ts`：官方 Node.js 类型化客户端 API；
- `dist/modes/json-event.d.ts`：可序列化事件与流式增量约束；
- `docs/rpc.md`：对应版本的协议文档。

## 目录

1. [定位与执行模型](#1-定位与执行模型)
2. [传输与消息分流](#2-传输与消息分流)
3. [命令与响应](#3-命令与响应)
4. [事件与完成语义](#4-事件与完成语义)
5. [扩展 UI 子协议](#5-扩展-ui-子协议)
6. [生命周期、并发与背压](#6-生命周期并发与背压)
7. [集成方式选择](#7-集成方式选择)
8. [类型化 Node.js 示例](#8-类型化-nodejs-示例)
9. [自管进程示例](#9-自管进程示例)
10. [实现与验收清单](#10-实现与验收清单)

## 1. 定位与执行模型

`runRpcMode(runtime)` 是 `AgentSessionRuntime` 上的一层无头 I/O 适配器：

```text
宿主 ──stdin JSONL──▶ runRpcMode ──▶ AgentSessionRuntime/AgentSession
宿主 ◀─stdout JSONL── response + event + extension_ui_request
宿主 ◀─stderr──────── diagnostics
```

它在调用方当前 Node.js 进程的主线程运行，监听 `process.stdin`、接管
`process.stdout`，并返回 `Promise<never>` 保持进程存活。它不会自行创建
`child_process`、Worker Thread 或网络服务。

需要故障与内存隔离时，由宿主启动一个独立 Node.js 子进程，再在该子进程
入口创建 runtime 并调用 `runRpcMode()`。不要为了 RPC 再套 Worker Thread：
Worker 没有独立进程级 stdin/stdout，还需要额外的 `parentPort` 桥接。仅把明确的
CPU 密集计算下沉到 Worker。

`runRpcMode()` 会绑定扩展的 `mode: "rpc"` UI context，并在 new/switch/fork/
clone 后重新绑定新 session 的事件与扩展。runtime 是权威状态所有者；HTTP、
WebSocket、Electron IPC 等外层传输只投影消息。

## 2. 传输与消息分流

协议使用严格 JSONL：每条消息是一个 JSON 对象，以 LF (`\n`) 结束。

- 只按 `\n` 切帧；允许输入 CRLF，但解析前只移除末尾 `\r`；
- 必须使用增量 UTF-8 decoder，处理跨 chunk 的多字节字符和半条记录；
- 不要用 Node `readline` 实现严格客户端，它还会把 `U+2028`、`U+2029`
  当作行分隔符，而二者可以合法出现在 JSON 字符串中；
- stdout 专用于协议。日志、诊断和崩溃信息写 stderr；
- 客户端必须处理 stdout 背压，服务端也会等待原始 stdout drain；
- 不要假设一次 `data` 对应一条消息，也不要假设一条消息只占一次 `data`。

stdout 上有三类消息：

| 判别方式 | 方向 | 含义 |
| --- | --- | --- |
| `type === "response"` | 服务端 → 客户端 | 命令接受、结果或错误；以 `id` 关联 |
| `type === "extension_ui_request"` | 服务端 → 客户端 | 扩展 UI 对话或展示请求 |
| 其他已知事件类型 | 服务端 → 客户端 | `JsonAgentSessionEvent` 流 |

stdin 接收两类消息：`RpcCommand` 与 `RpcExtensionUIResponse`。所有命令都允许
可选 `id`；生产客户端应始终提供唯一 ID。响应复制同一个 ID。普通 Agent 事件
通常没有请求 ID；直接 `bash` 的 `bash_execution_update` 会复制命令 ID。

不要只按“不是 response 就是 Agent event”强制转换：扩展 UI 请求也在同一流中。

## 3. 命令与响应

所有失败统一为：

```json
{"id":"req-1","type":"response","command":"set_model","success":false,"error":"..."}
```

未知命令同样失败；非法 JSON 返回 `command: "parse"`，可能没有 ID。

### 3.1 提示与控制

| 命令 | 关键字段 | 成功结果/语义 |
| --- | --- | --- |
| `prompt` | `message`, `images?`, `streamingBehavior?` | 无 data；预检成功、已入队或已处理，不代表生成完成 |
| `steer` | `message`, `images?` | 将指令插入当前运行之后、下一次 LLM 调用之前 |
| `follow_up` | `message`, `images?` | 等当前 Agent 完全结束后继续 |
| `abort` | — | 等待当前 session 取消完成 |

Agent 正在流式运行时，普通 `prompt` 必须指定 `streamingBehavior: "steer" |
"followUp"`，否则预检失败。扩展命令可以自行管理运行时交互。

`prompt` 是特殊的异步命令：服务端立即启动 `session.prompt()`，但只在
preflight 成功后发送一次成功响应。成功后的模型或工具失败通过事件/消息流表达，
不会为同一个 ID 再发送失败响应。

### 3.2 Runtime、模型与队列

| 命令 | 关键字段 | 成功 data |
| --- | --- | --- |
| `new_session` | `parentSession?` | `{ cancelled }` |
| `get_state` | — | `RpcSessionState` |
| `set_model` | `provider`, `modelId` | 完整 `Model` |
| `cycle_model` | — | `{ model, thinkingLevel, isScoped } | null` |
| `get_available_models` | — | `{ models }` |
| `set_thinking_level` | `level` | 无 data |
| `cycle_thinking_level` | — | `{ level } | null` |
| `get_available_thinking_levels` | — | `{ levels }` |
| `set_steering_mode` | `mode: "all" | "one-at-a-time"` | 无 data |
| `set_follow_up_mode` | `mode: "all" | "one-at-a-time"` | 无 data |

`RpcSessionState` 包含 model、thinkingLevel、isStreaming、isCompacting、两种队列
mode、sessionFile/sessionId/sessionName、autoCompactionEnabled、messageCount 和
pendingMessageCount。它是查询时快照，不是持续同步状态；实时 UI 应同时消费事件。

`new_session`、`switch_session`、`fork`、`clone` 可能被扩展取消。只有
`cancelled: false` 才表示 runtime 已替换成功。

### 3.3 压缩、重试与 Bash

| 命令 | 关键字段 | 成功 data |
| --- | --- | --- |
| `compact` | `customInstructions?` | `CompactionResult` |
| `set_auto_compaction` | `enabled` | 无 data |
| `set_auto_retry` | `enabled` | 无 data |
| `abort_retry` | — | 无 data |
| `bash` | `command`, `excludeFromContext?` | `BashResult` |
| `abort_bash` | — | 无 data |

直接 RPC `bash` 的实时 stdout/stderr 通过 `bash_execution_update` 发送，最终
`BashResult.output` 可能被截断，因此需要完整日志时必须累计 update。该命令不同于
LLM 发起的 bash 工具调用；后者使用 `tool_execution_*` 事件。

### 3.4 Session 查询与操作

| 命令 | 关键字段 | 成功 data |
| --- | --- | --- |
| `get_session_stats` | — | `SessionStats` |
| `export_html` | `outputPath?` | `{ path }` |
| `switch_session` | `sessionPath` | `{ cancelled }` |
| `fork` | `entryId` | `{ text, cancelled }` |
| `clone` | — | `{ cancelled }` |
| `get_fork_messages` | — | `{ messages: [{ entryId, text }] }` |
| `get_entries` | `since?` | `{ entries, leafId }` |
| `get_tree` | — | `{ tree, leafId }` |
| `get_last_assistant_text` | — | `{ text: string | null }` |
| `set_session_name` | `name` | 无 data |
| `get_messages` | — | `{ messages: AgentMessage[] }` |
| `get_commands` | — | `{ commands: RpcSlashCommand[] }` |

`fork(entryId)` 从指定用户消息之前创建分叉；`clone` 将当前活动分支复制到新会话。
`get_entries(since)` 用于增量同步 append-order entries；`get_tree` 用于树形导航。
`get_commands` 只列出扩展命令、prompt template 与 skill，不含 TUI 内置命令。

## 4. 事件与完成语义

RPC 转发 `JsonAgentSessionEvent`。主要事件：

| 类别 | 事件 |
| --- | --- |
| Agent 生命周期 | `agent_start`, `agent_end`, `agent_settled` |
| Turn/message | `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end` |
| 工具/Bash | `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `bash_execution_update` |
| 队列 | `queue_update` |
| 压缩 | `compaction_start`, `compaction_end` |
| 自动重试 | `auto_retry_start`, `auto_retry_end` |
| 摘要重试 | `summarization_retry_scheduled`, `summarization_retry_attempt_start`, `summarization_retry_finished` |
| Session 投影 | `entry_appended`, `session_info_changed`, `thinking_level_changed` |
| 扩展错误 | `extension_error` |

`agent_end` 只表示一次低层 Agent run 结束。`willRetry: true` 时一定还有自动重试；
即使为 false，也可能随后压缩重试或执行已排队 follow-up。把
`agent_settled` 作为“Pi 不会自动继续”的权威完成信号。

### 4.1 流式消息组装

v0.84.1 的 `message_update` 只包含 `assistantMessageEvent` delta，不再包含累计
`message` 或 `partial`。客户端应：

1. 在 `message_start` 建立消息投影；
2. 按 `contentIndex` 处理 `text_*`、`thinking_*`、`toolcall_*`；
3. 累积 `text_delta`/`thinking_delta`/`toolcall_delta.delta`；
4. 用 `toolcall_end.toolCall` 完成工具调用；
5. 用 `message_end.message` 覆盖为最终权威值。

如果 UI 只需要输出文本，可以只消费 `text_delta`；如果要持久化或恢复完整消息，
必须使用上述状态机，不能把 delta 当作完整消息。

## 5. 扩展 UI 子协议

扩展调用 `ctx.ui` 时，RPC mode 将其转为 `extension_ui_request`。

需要响应的 dialog：

| method | 请求字段 | 合法响应 |
| --- | --- | --- |
| `select` | `title`, `options`, `timeout?` | `{ value }` 或 `{ cancelled: true }` |
| `confirm` | `title`, `message`, `timeout?` | `{ confirmed }` 或 `{ cancelled: true }` |
| `input` | `title`, `placeholder?`, `timeout?` | `{ value }` 或 `{ cancelled: true }` |
| `editor` | `title`, `prefill?` | `{ value }` 或 `{ cancelled: true }` |

所有响应必须使用请求 ID：

```json
{"type":"extension_ui_response","id":"uuid","confirmed":true}
```

`notify`、`setStatus`、`setWidget`、`setTitle`、`set_editor_text` 是 fire-and-forget，
不得等待或发送响应。dialog 超时与 abort 在服务端清理 pending request；select/
input/editor 默认 `undefined`，confirm 默认 `false`。

RPC 的 `ctx.mode === "rpc"` 且 `ctx.hasUI === true`，因为上述桥接可用。但依赖
真实 TUI 的 custom component、theme switching、autocomplete、footer/header 等能力
不可用或降级；扩展应以 `ctx.mode === "tui"` 保护真正的终端功能。

## 6. 生命周期、并发与背压

- 服务端会异步处理输入行；不要依赖命令响应严格按发送顺序返回，必须按 ID 关联。
- 明确定义宿主策略：通常一个权威 Agent 实例对应一个子进程；并行 Agent 使用多个
  子进程，session 切换留在同一 runtime 内。
- 启动后用 `get_state` 做协议级 readiness check；官方 `RpcClient.start()` 只等待
  短暂启动窗口，严格宿主可增加自己的 readiness 请求。
- 为每个 request 设置超时；进程 exit/error、stdin error 时拒绝全部 pending。
- prompt 请求超时不等同于 Agent 已取消。需要取消时另发 `abort`，再等待 settled。
- 收到 `SIGTERM`（非 Windows 还包括 `SIGHUP`）或 stdin EOF 时，RPC 会 dispose
  runtime 并退出；宿主应先优雅终止，超时后再强杀。
- session 被 new/switch/fork/clone 替换后，RPC mode 会重绑扩展和事件。外层宿主
  不应缓存旧 session 状态。
- stdout 是共享有序流，但 response、event、extension UI 可以交错。

## 7. 集成方式选择

| 场景 | 选择 |
| --- | --- |
| Node.js 同进程，需直接访问 session | `createAgentSession()` 或 `createAgentSessionRuntime()` |
| Node.js 子进程，接受官方 CLI 生命周期 | `RpcClient` |
| 自定义 runtime/内置扩展，同时要求进程隔离 | 自建 child entry + `runRpcMode(runtime)` |
| Python/Rust/Java/Electron 独立后端 | 按 `RpcCommand` 实现严格 JSONL 客户端 |
| CPU 密集扩展任务 | 只把计算任务放 Worker，不把 `runRpcMode()` 放 Worker |

`RpcClient` 会自行 spawn `node <cliPath> --mode rpc`，提供类型化方法、响应关联、
stderr 收集、事件订阅和 `waitForIdle()`。它的事件 listener 类型只声明
`JsonAgentSessionEvent`，不会替你处理 `RpcExtensionUIRequest`；需要完整扩展 UI、
自定义进程重启、动态超时或产品化监督时，实现自己的进程管理器。

## 8. 类型化 Node.js 示例

参见 `examples/pi-agent-demo/src/rpc-client-demo.ts`。关键顺序：先注册事件监听或
创建 `promptAndWait` 的收集器，再发送 prompt，避免漏掉快速事件；最终在 finally
中取消订阅并 stop。

```ts
const events = await client.promptAndWait("检查当前项目", undefined, 120_000);
const finalText = await client.getLastAssistantText();
```

不要用 `agent_end` 自行实现 `waitForIdle()`；官方客户端等待 `agent_settled`。

## 9. 自管进程示例

自定义 runtime 的子进程入口：

```ts
import { runRpcMode } from "@earendil-works/pi-coding-agent";
import { createProductRuntime } from "./runtime.js";

const runtime = await createProductRuntime();
await runRpcMode(runtime);
```

宿主必须用 `spawn(process.execPath, [entryPath], { stdio: ["pipe", "pipe", "pipe"] })`
启动它，并实现：严格 JSONL decoder、唯一 ID、pending map、请求超时、三类 stdout
消息分流、stderr 上限、退出时 reject-all、readiness、优雅停止和强杀兜底。

最小交互：

```jsonl
{"id":"1","type":"get_state"}
{"id":"1","type":"response","command":"get_state","success":true,"data":{"isStreaming":false}}
{"id":"2","type":"prompt","message":"检查项目"}
{"id":"2","type":"response","command":"prompt","success":true}
{"type":"agent_start"}
{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"发现"}}
{"type":"agent_end","messages":[],"willRetry":false}
{"type":"agent_settled"}
```

线上实现不要假设示例中的相邻顺序；事件可能在 prompt response 前后交错，应分别按
ID 和事件状态机处理。

## 10. 实现与验收清单

- 版本：所有 Pi 包同一 release line，并从包根公开入口导入。
- framing：LF-only、增量 UTF-8、跨 chunk、CRLF 输入和 U+2028/U+2029 均测试。
- 分流：response、Agent event、extension UI request 三类不混淆。
- 关联：每条命令唯一 ID；乱序响应、超时、迟到响应和进程退出均覆盖。
- 流式：按 contentIndex 组装，`message_end` 权威，`agent_settled` 判定完成。
- 队列：streaming prompt 的 steer/followUp、queue_update 和 abort 均覆盖。
- UI：四种 dialog 的 value/confirm/cancel/timeout，以及 fire-and-forget 均覆盖。
- runtime：new/switch/fork/clone 的 cancelled 与成功重绑均验证。
- 可靠性：stdout 无日志污染、stderr 有界、背压、SIGTERM、EOF、强杀兜底。
- 安全：把 RPC 子进程与扩展视为拥有宿主权限；限制 cwd、环境变量、工具与资源来源。
