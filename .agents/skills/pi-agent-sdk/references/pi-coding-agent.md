# `pi-coding-agent` 详细使用指南

> 适用基线：`@earendil-works/pi-coding-agent@0.84.3`。本文依据 Pi v0.84.3 SDK 与发布说明整理，并用仓库当前安装包的公开 `.d.ts` 复核。升级依赖后，应重新检查公开导出和类型声明。

## 1. 包定位与使用边界

`@earendil-works/pi-coding-agent` 是 Pi 面向编码产品的高层 SDK。它在 `pi-agent-core` 的 Agent 循环之上提供：

- `AgentSession`：提示、消息队列、事件、模型切换、上下文压缩、重试和会话树导航；
- `SessionManager`：JSONL 持久化、恢复、分支、标签和会话列表；
- `ModelRuntime`：模型目录、认证、运行时密钥和可用性查询；
- `SettingsManager`：全局与项目设置合并、内存设置和异步持久化；
- `ResourceLoader`：扩展、技能、提示模板、主题、`AGENTS.md` 和系统提示发现；
- 编码工具：`read`、`bash`、`edit`、`write`、`grep`、`find`、`ls`；
- 可替换会话运行时，以及 interactive、print、RPC 三种运行模式。

适合直接嵌入 Web、Electron、CLI、自动化流水线或自定义界面。若只需要模型调用，使用 `pi-ai`；若需要完全自定义 Agent 构造和循环，使用 `pi-agent-core` 或 `AgentHarness`。

关键边界：

- `createAgentSession()` 自己创建 `Agent`，不接受现成的 `Agent` 或 `agentFactory`；
- 扩展可以注册工具、命令和生命周期行为，但不能替换内部 Agent 构造；
- 单会话/多会话策略由应用编排层负责，工厂函数本身不提供全局单例；
- 不导入 `src/**` 或其他私有路径，只使用包根公开导出。

### 1.1 Octopus 产品化与 Rebrand 环境变量

Octopus 对 `@earendil-works/pi-coding-agent` 的 Rebrand 是通过改动 `package.json` 中的 `piConfig` 实现的：

```json
{
  "piConfig": {
    "name": "Dr_Octopus",
    "configDir": ".dr-octopus"
  }
}
```

源码默认：

```json
{
  "piConfig": {
    "configDir": ".pi"
  }
}
```

Pi 在模块加载时直接使用 `piConfig.name` 作为 `APP_NAME`，并通过以下规则推导环境变量名：

```ts
const APP_NAME = pkg.piConfig?.name || "pi";
const ENV_AGENT_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`;
const ENV_SESSION_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_SESSION_DIR`;
```

因此，设置 `piConfig.name` 时必须同时满足展示名称和环境变量名称约束，并匹配 `^[A-Za-z_][A-Za-z0-9_]*$`：只使用 ASCII 字母、数字和下划线，并以字母或下划线开头；不要使用空格、连字符、点号、中文或其他特殊字符。推荐格式为 `Dr_Octopus`，它会生成可安全使用的 `DR_OCTOPUS_*` 环境变量。`configDir` 不参与环境变量名推导，可以继续使用 `.dr-octopus`。

```json
{
  "valid": ["Dr_Octopus", "Octopus2"],
  "invalid": ["Dr-Octopus", "Dr.Octopus", "Dr Octopus", "章鱼博士"]
}
```

Pi 不会替换或清理 `piConfig.name` 中的字符；不安全字符会原样进入推导出的环境变量名，导致 shell、部署平台或跨平台宿主无法可靠设置和读取这些变量。

| 上游 Pi 变量名 | Octopus 变量名 | 说明 |
|---|---|---|
| `PI_CODING_AGENT_DIR` | `DR_OCTOPUS_CODING_AGENT_DIR` | 覆盖 Agent 配置/数据根目录；默认 `~/.dr-octopus/agent` |
| `PI_CODING_AGENT_SESSION_DIR` | `DR_OCTOPUS_CODING_AGENT_SESSION_DIR` | 覆盖会话存储目录；优先级低于 `--session-dir` |

**其余 `PI_*` 环境变量不会自动 Rebrand**，在 Octopus 中仍保持上游名称：

| 变量名 | 说明 |
|---|---|
| `PI_CODING_AGENT` | CLI/RPC 入口设置为 `true`，子进程可据此检测运行在 Pi/Octopus 内 |
| `AI_AGENT` | CLI/RPC 入口设置为 `pi`，用于通用 Agent 归因 |
| `PI_PACKAGE_DIR` | 覆盖包目录（Nix/Guix 场景） |
| `PI_OFFLINE` | 禁用启动网络操作 |
| `PI_SKIP_VERSION_CHECK` | 跳过启动版本检查 |
| `PI_TELEMETRY` | 覆盖安装/更新遥测与提供商归因头 |
| `PI_CACHE_RETENTION` | 设为 `long` 使用扩展提示缓存 |
| `PI_SESSION_ID` / `PI_SESSION_FILE` / `PI_PROVIDER` / `PI_MODEL` / `PI_REASONING_LEVEL` | Bash 工具传递给子命令的会话元数据 |
| `BASETEN_API_KEY` | v0.84.0 新增 Baseten 提供商认证 |
| `QWEN_TOKEN_PLAN_API_KEY` | Qwen Token Plan 国际区及 v0.84.1 Individual 方案认证 |
| `QWEN_TOKEN_PLAN_CN_API_KEY` | Qwen Token Plan 中国区认证 |

因此：
- 配置 Agent 目录时使用 `DR_OCTOPUS_CODING_AGENT_DIR`，而不是 `PI_CODING_AGENT_DIR`；
- 配置会话目录时使用 `DR_OCTOPUS_CODING_AGENT_SESSION_DIR`；
- 控制离线、遥测、缓存、Bash 元数据等行为时，仍使用原来的 `PI_*` 名称；
- 编写扩展或宿主代码时，不要假设所有 `PI_*` 变量都有对应的 `OCTOPUS_*` 形式。

## 2. 安装与最小会话

```bash
pnpm add @earendil-works/pi-coding-agent@0.84.3
```

```ts
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

const modelRuntime = await ModelRuntime.create();
const { session, extensionsResult, modelFallbackMessage } =
  await createAgentSession({
    modelRuntime,
    sessionManager: SessionManager.inMemory(),
  });

for (const error of extensionsResult.errors) {
  console.error(`扩展加载失败：${error.path}: ${error.error}`);
}
if (modelFallbackMessage) console.warn(modelFallbackMessage);

const unsubscribe = session.subscribe((event) => {
  if (
    event.type === "message_update" &&
    event.assistantMessageEvent.type === "text_delta"
  ) {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

try {
  await session.prompt("列出当前目录中的文件");
} finally {
  unsubscribe();
  session.dispose();
}
```

生产代码必须处理：无可用模型、认证缺失、扩展诊断、恢复模型失败、提示执行错误、取消和资源清理。

## 3. `createAgentSession()`

### 3.1 主要选项

```ts
interface CreateAgentSessionOptions {
  cwd?: string;
  agentDir?: string;
  modelRuntime?: ModelRuntime;
  model?: Model;
  thinkingLevel?: ThinkingLevel;
  scopedModels?: Array<{ model: Model; thinkingLevel?: ThinkingLevel }>;
  noTools?: "all" | "builtin";
  tools?: string[];
  excludeTools?: string[];
  customTools?: ToolDefinition[];
  resourceLoader?: ResourceLoader;
  sessionManager?: SessionManager;
  settingsManager?: SettingsManager;
  sessionStartEvent?: SessionStartEvent;
}
```

选项语义：

| 选项 | 默认值/行为 | 设计注意事项 |
| --- | --- | --- |
| `cwd` | `process.cwd()` | 项目资源发现、工具路径和会话目录命名的工作目录 |
| `agentDir` | `~/.dr-octopus/agent` | 全局资源、设置、认证、模型和会话根目录 |

Octopus 的产品化构建需要将 `piConfig` 改写为 `{ "name": "Dr_Octopus", "configDir": ".dr-octopus" }`，因此默认 `agentDir` 为 `~/.dr-octopus/agent`；未改写的 v0.84.3 上游包仍默认使用 `~/.pi/agent`。
| `modelRuntime` | 根据 `agentDir` 创建 | 应用已有认证/模型生命周期时应显式复用 |
| `model` | 恢复值、设置默认值或首个可用模型 | 显式模型可能尚无认证，调用前仍需验证 |
| `thinkingLevel` | 设置值或 `medium`，再按模型能力收敛 | 支持 `off/minimal/low/medium/high/xhigh/max`，实际可用级别取决于模型 |
| `scopedModels` | 无 | 控制模型循环范围以及每个模型的默认思考级别 |
| `tools` | 默认内置工具加合格的扩展/自定义工具 | 一旦提供即成为严格允许列表 |
| `excludeTools` | 空 | 在允许列表计算完成后应用的拒绝列表 |
| `noTools` | 未设置 | 只在没有显式 `tools` 时改变默认工具策略 |
| `customTools` | 空 | 与扩展工具合并；若有 `tools`，仍须把名称加入允许列表 |
| `resourceLoader` | 自动创建 `DefaultResourceLoader` | 显式创建时必须先 `await loader.reload()` |
| `sessionManager` | `SessionManager.create(cwd)` | 测试或临时会话应显式使用 `inMemory()` |
| `settingsManager` | `SettingsManager.create(cwd, agentDir)` | 与 loader、session 的目录配置应保持一致 |
| `sessionStartEvent` | 无 | 为扩展启动生命周期传递元数据 |

### 3.2 返回值

```ts
interface CreateAgentSessionResult {
  session: AgentSession;
  extensionsResult: LoadExtensionsResult;
  modelFallbackMessage?: string;
}

interface LoadExtensionsResult {
  extensions: Extension[];
  errors: Array<{ path: string; error: string }>;
  runtime: ExtensionRuntime;
}
```

`extensionsResult.errors` 不应被静默忽略。`modelFallbackMessage` 表示恢复会话时保存的模型不可用，SDK 已选择替代模型；宿主应将警告展示给用户或记录到诊断日志。

## 4. `AgentSession` 生命周期与状态

常用只读状态：

```ts
session.agent;             // 底层 Agent
session.state;             // 完整 AgentState
session.model;             // 当前模型，可能为 undefined
session.thinkingLevel;
session.messages;          // 包括 coding-agent 自定义消息
session.systemPrompt;      // 当前有效系统提示
session.isStreaming;       // Agent 运行或运行后续处理仍活跃
session.isIdle;            // 无运行、重试、压缩或排队续跑
session.isCompacting;
session.isRetrying;
session.isBashRunning;
session.sessionFile;       // 内存会话为 undefined
session.sessionId;
session.sessionName;
```

生命周期建议：

1. 编排层创建并持有会话；
2. 在同一所有者边界只订阅一次事件；
3. 传输层只接收规范化事件/DTO，不持有可变 `AgentSession`；
4. 关闭时先取消运行，再等待空闲，最后取消订阅并释放；
5. `dispose()` 在 0.83.0 中是同步方法，不要假设它等待正在执行的异步操作。

```ts
await session.abort();
await session.agent.waitForIdle();
unsubscribe();
session.dispose();
```

若只是正常等待整次提示结束，`await session.prompt(...)` 已等待已接受的完整运行结束，包括自动重试。

## 5. 提示、排队和并发契约

### 5.1 `prompt()`

```ts
interface PromptOptions {
  expandPromptTemplates?: boolean;
  images?: ImageContent[];
  streamingBehavior?: "steer" | "followUp";
  source?: InputSource;
  preflightResult?: (success: boolean) => void;
}
```

```ts
await session.prompt("检查项目");

await session.prompt("解释这张图", {
  images: [
    {
      type: "image",
      source: {
        type: "base64",
        mediaType: "image/png",
        data: base64Data,
      },
    },
  ],
});
```

行为规则：

- 默认展开文件型提示模板；
- 扩展命令立即执行，即使当前正在流式生成；扩展自行通过 `pi.sendMessage()` 管理模型交互；
- 正在流式生成时调用 `prompt()`，必须指定 `streamingBehavior`，否则抛错；
- `preflightResult(true)` 仅表示提示已被接受、排队或立即处理；
- `preflightResult(false)` 表示在接受前被预检拒绝；
- 接受后的模型/工具失败通过事件和消息报告，而不是改为调用 `preflightResult(false)`。

### 5.2 `steer()` 与 `followUp()`

```ts
await session.steer("停止当前方向，先检查配置文件");
await session.followUp("完成后再运行测试");

// 等价的 prompt 写法
await session.prompt("改为检查配置", { streamingBehavior: "steer" });
await session.prompt("最后运行测试", { streamingBehavior: "followUp" });
```

- `steer`：当前 assistant turn 完成已有工具调用后、下一次 LLM 调用前送达；
- `followUp`：Agent 无更多工具调用和 steering 消息、进入停止状态后送达；
- 两者都会展开技能命令和文件提示模板；
- 两者都不接受扩展命令，因为扩展命令不能排队；
- 队列模式可配置为 `all` 或 `one-at-a-time`。

不要让多个 HTTP/IPC 请求无策略地并发调用同一会话。应用应明确选择串行、steer 或 follow-up，并将选择映射到 SDK 契约。

## 6. 事件流

```ts
const unsubscribe = session.subscribe((event) => {
  switch (event.type) {
    case "message_update":
      if (event.assistantMessageEvent.type === "text_delta") {
        publish({ type: "text-delta", text: event.assistantMessageEvent.delta });
      }
      break;
    case "tool_execution_start":
      publish({ type: "tool-start", name: event.toolName });
      break;
    case "tool_execution_update":
      break;
    case "tool_execution_end":
      publish({ type: "tool-end", error: event.isError });
      break;
    case "queue_update":
      publish({ type: "queue", steering: event.steering, followUp: event.followUp });
      break;
    case "agent_end":
      publish({ type: "agent-end", willRetry: event.willRetry });
      break;
    case "agent_settled":
      publish({ type: "settled" });
      break;
  }
});
```

主要事件族：

- 消息：`message_start`、`message_update`、`message_end`；
- 工具：`tool_execution_start`、`tool_execution_update`、`tool_execution_end`；
- Agent：`agent_start`、`agent_end`、`agent_settled`；
- turn：`turn_start`、`turn_end`；
- 队列：`queue_update`；
- 压缩：`compaction_start`、`compaction_end`；
- 自动重试：`auto_retry_start`、`auto_retry_end`；
- 摘要重试：`summarization_retry_scheduled`、`summarization_retry_attempt_start`、`summarization_retry_finished`；
- 会话：`entry_appended`、`session_info_changed`、`thinking_level_changed`；
- Bash：`bash_execution_update`。

`agent_end` 不一定意味着完全结束，0.83.0 的事件带有 `willRetry`。需要真正稳定点时使用 `agent_settled` 或 `isIdle`/等待空闲。对外事件 DTO 应保留运行 ID、消息 ID、工具调用 ID 和顺序信息，避免 UI 将不同 turn 的增量混合。

## 7. 模型与认证

### 7.1 选择模型

```ts
import { getModel } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

const modelRuntime = await ModelRuntime.create();

const builtin = getModel("anthropic", "claude-opus-4-5");
if (!builtin) throw new Error("模型不存在");

const custom = modelRuntime.getModel("my-provider", "my-model");
const available = await modelRuntime.getAvailable();
```

区别：

- `getModel()` 查询内置目录，不检查是否已有认证；
- `modelRuntime.getModel()` 还能查询 `models.json` 中的自定义模型，也不代表认证可用；
- `modelRuntime.getAvailable()` 只返回当前具备有效认证的模型。

未显式传入模型时，SDK 依次尝试：恢复会话模型、设置中的默认模型、首个可用模型。

```ts
await session.setModel(builtin);
session.setThinkingLevel("high");
const cycled = await session.cycleModel("forward");
const nextLevel = session.cycleThinkingLevel();
```

`setModel()` 会验证认证。思考级别会按模型能力收敛；可通过 `getAvailableThinkingLevels()` 和 `supportsThinking()` 构建 UI。

### 7.2 CLI 同语义解析

```ts
import {
  resolveCliModel,
  resolveModelScopeWithDiagnostics,
} from "@earendil-works/pi-coding-agent";

const resolved = resolveCliModel({
  cliModel: "anthropic/claude-opus-4-5:high",
  modelRuntime,
});
if (resolved.error) throw new Error(resolved.error);
if (resolved.warning) console.warn(resolved.warning);

const { scopedModels, diagnostics } =
  await resolveModelScopeWithDiagnostics(
    ["anthropic/*:high", "gpt-5"],
    modelRuntime,
  );
```

### 7.3 认证优先级和刷新

`ModelRuntime` 的认证解析顺序：

1. `setRuntimeApiKey()` 设置的内存覆盖；
2. `auth.json` 中的 API Key 或 OAuth token；
3. 提供商环境变量；
4. 自定义提供商的 fallback resolver。

```ts
const runtime = await ModelRuntime.create({
  authPath: "/app/private/auth.json",
  modelsPath: "/app/config/models.json",
});

await runtime.setRuntimeApiKey("anthropic", apiKey);

for (const provider of runtime.getProviders()) {
  const status = await runtime.checkAuth(provider.id);
  console.log(provider.id, status);
}

const refresh = await runtime.refresh({
  providers: ["anthropic"],
  signal: AbortSignal.timeout(15_000),
});
```

远程操作未传 `AbortSignal` 时无超时上限，宿主必须定义 deadline。认证变更成功但本地模型目录同步失败时会抛 `CredentialSynchronizationError`；应检查 `providerId`、`operation`、`credential` 和 `cause`，不能盲目重复凭证写入。刷新超时不会撤销已成功的凭证变更。

## 8. 工具策略

### 8.1 内置工具

全部内置工具名：`read`、`bash`、`edit`、`write`、`grep`、`find`、`ls`。

默认启用：`read`、`bash`、`edit`、`write`。

```ts
// 只读会话
await createAgentSession({
  tools: ["read", "grep", "find", "ls"],
});

// 禁用全部工具
await createAgentSession({ noTools: "all" });

// 禁用默认内置工具，但保留合格的扩展/自定义工具
await createAgentSession({ noTools: "builtin" });

// 在最终结果中排除指定工具
await createAgentSession({ excludeTools: ["bash"] });
```

选择顺序可理解为：先根据 `tools` 或默认/noTools 规则选择，再应用 `excludeTools`。`edit` 的结果中，`details.diff` 面向 Pi TUI，`details.patch` 是供 SDK 消费者使用的标准 unified patch。

自定义 `cwd` 时，内置工具会按该目录构造；`SessionManager.inMemory(cwd)` 也应使用同一目录，防止工具工作目录与会话标识不一致。

### 8.2 自定义工具

0.83.0 官方示例使用 `typebox` 的 `Type`；项目也可在确认当前 `pi-ai` 根导出兼容的前提下统一从 `@earendil-works/pi-ai` 导入。不要额外混入不同 TypeBox 实现。

```ts
import { Type } from "typebox";
import {
  createAgentSession,
  defineTool,
} from "@earendil-works/pi-coding-agent";

const statusTool = defineTool({
  name: "status",
  label: "Status",
  description: "返回当前服务状态",
  parameters: Type.Object({
    service: Type.String({ description: "服务名称" }),
  }),
  execute: async (_toolCallId, params) => ({
    content: [{ type: "text", text: `${params.service}: healthy` }],
    details: { checkedAt: Date.now() },
  }),
});

const { session } = await createAgentSession({
  tools: ["read", "status"],
  customTools: [statusTool],
});
```

规则：

- 独立工具或 `customTools` 数组使用 `defineTool()`；
- 扩展内调用 `pi.registerTool({...})` 已能推断参数类型；
- 自定义工具与扩展工具合并；
- 若设置了 `tools`，必须显式列出自定义/扩展工具名；
- 工具执行应返回结构化 `content` 和 `details`，失败应形成明确错误结果或抛出可诊断异常；
- 第三方工具拥有与宿主进程相同的权限，必须视为可信代码。

运行时可通过 `getActiveToolNames()`、`getAllTools()`、`getToolDefinition()` 检查工具，并用 `setActiveToolsByName()` 修改下一 turn 的工具集合。未知名称会被忽略。

## 9. 资源加载

`DefaultResourceLoader` 统一加载扩展、技能、提示模板、主题、上下文文件和系统提示。

```ts
import {
  DefaultResourceLoader,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";

const loader = new DefaultResourceLoader({
  cwd: process.cwd(),
  agentDir: getAgentDir(),
});
await loader.reload();

const extensions = loader.getExtensions();
const skills = loader.getSkills();
const prompts = loader.getPrompts();
const themes = loader.getThemes();
const contextFiles = loader.getAgentsFiles().agentsFiles;
```

显式 loader 必须先 `reload()`。传入自定义 loader 后，`createAgentSession()` 的 `cwd`/`agentDir` 不再控制资源发现，但仍影响会话命名和工具路径。

### 9.1 默认发现位置

项目资源基于 `cwd`：

- `.dr-octopus/extensions/`；
- `.dr-octopus/skills/`；
- 当前目录及祖先目录中的 `.agents/skills/`，在 Git 仓库内走到仓库根，否则走到文件系统根；
- `.dr-octopus/prompts/`；
- 自 `cwd` 向上发现的 `AGENTS.md`。

> 上游 Pi 默认使用 `.pi/` 前缀；Octopus 通过 Rebrand Patch 改为 `.dr-octopus/`。

全局资源基于 `agentDir`：

- `extensions/`、`skills/`、`prompts/`；
- `~/.agents/skills/`；
- 全局 `AGENTS.md`、`settings.json`、`models.json`、`auth.json`、`sessions/`。

### 9.2 系统提示与覆盖

```ts
const loader = new DefaultResourceLoader({
  cwd,
  agentDir,
  systemPromptOverride: () => "你是一个只执行代码审查的助手。",
  appendSystemPromptOverride: (base) => [
    ...base,
    "不得修改工作区文件。",
  ],
});
await loader.reload();
```

覆盖回调应保留或明确替换基础值。若只追加约束，使用 append 机制，避免意外丢失工具说明和上下文。

### 9.3 技能、上下文和提示模板

```ts
const loader = new DefaultResourceLoader({
  cwd,
  agentDir,
  skillsOverride: (current) => ({
    skills: [...current.skills, customSkill],
    diagnostics: current.diagnostics,
  }),
  agentsFilesOverride: (current) => ({
    agentsFiles: [
      ...current.agentsFiles,
      { path: "/virtual/AGENTS.md", content: "# Rules\n\n- Be concise" },
    ],
  }),
  promptsOverride: (current) => ({
    prompts: [...current.prompts, customPrompt],
    diagnostics: current.diagnostics,
  }),
});
```

覆盖时通常应传播原有 diagnostics。技能对象至少包含 `name`、`description`、`filePath`、`baseDir` 和 `source`；提示模板包含 `name`、`description`、`source` 和 `content`。

## 10. 扩展

扩展默认导出同步或异步工厂，接收 `ExtensionAPI`。它可注册工具、命令、事件处理器、提供商和 UI 集成。

```ts
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import {
  createAgentSession,
  createEventBus,
  DefaultResourceLoader,
} from "@earendil-works/pi-coding-agent";

const eventBus = createEventBus();

const auditExtension: InlineExtension = {
  name: "audit",
  factory: (pi) => {
    pi.on("agent_start", () => {
      pi.events.emit("audit:status", { state: "started" });
    });
  },
};

eventBus.on("audit:status", (data) => console.log(data));

const loader = new DefaultResourceLoader({
  cwd,
  agentDir,
  eventBus,
  additionalExtensionPaths: ["/extensions/security.ts"],
  extensionFactories: [auditExtension],
});
await loader.reload();

const { session, extensionsResult } = await createAgentSession({
  resourceLoader: loader,
});
```

命名的 `InlineExtension` 会显示为 `<inline:audit>`；裸工厂仍兼容，但只显示 `<inline:1>` 等序号。扩展和技能均是特权代码/配置，不应从不可信输入直接加载。

`session.bindExtensions(...)` 用于绑定 UI 上下文、模式、命令动作、取消/关闭处理和错误监听。在会话被 runtime 替换后必须重新绑定。

## 11. 会话持久化与树结构

### 11.1 创建、恢复和列举

```ts
// 不落盘
SessionManager.inMemory(cwd);

// 新的持久化会话
SessionManager.create(cwd);

// 继续最近会话
SessionManager.continueRecent(cwd);

// 打开指定 JSONL
SessionManager.open("/sessions/session.jsonl");

const projectSessions = await SessionManager.list(cwd);
const allSessions = await SessionManager.listAll(cwd);
```

会话是由 `id`/`parentId` 连接的树，而不是单纯数组。常用树 API：

```ts
const entries = manager.getEntries();
const tree = manager.getTree();
const path = manager.getPath();
const leaf = manager.getLeafEntry();
const entry = manager.getEntry(id);
const children = manager.getChildren(id);

manager.appendLabelChange(id, "checkpoint");
manager.branch(entryId);
manager.branchWithSummary(entryId, "此前分支摘要");
manager.createBranchedSession(leafId);
```

在当前文件内导航用 `session.navigateTree()`；创建新会话文件的 fork/clone 用 `AgentSessionRuntime.fork()`，不要混淆。

```ts
const result = await session.navigateTree(targetId, {
  summarize: true,
  customInstructions: "重点保留架构决策",
  replaceInstructions: false,
  label: "before-refactor",
});
```

### 11.2 统计和导出

```ts
const stats = session.getSessionStats();
const htmlPath = await session.exportToHtml();
const jsonlPath = session.exportToJsonl();
const lastText = session.getLastAssistantText();
session.setSessionName("登录模块重构");
```

统计覆盖所有会话条目，包括已被上下文压缩移出的历史，因此 token 和成本更接近实际计费总量。

## 12. 设置管理

```ts
import {
  createAgentSession,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

const settings = SettingsManager.create(cwd, agentDir);
settings.applyOverrides({
  compaction: { enabled: false },
  retry: { enabled: true, maxRetries: 5 },
});

const { session } = await createAgentSession({
  settingsManager: settings,
});
```

测试中使用：

```ts
const settings = SettingsManager.inMemory({
  compaction: { enabled: false },
});
const sessions = SessionManager.inMemory(cwd);
```

文件设置从全局 `~/.dr-octopus/agent/settings.json` 和项目 `<cwd>/.dr-octopus/settings.json` 合并，项目覆盖全局，嵌套对象按键合并。getter/setter 修改内存是同步的，但 setter 的持久化写入异步排队：

```ts
await settings.flush();
for (const error of settings.drainErrors()) {
  reportSettingsError(error);
}
```

进程退出或测试断言文件前必须 `flush()`；SDK 不会自行打印设置 I/O 错误。

## 13. 压缩、重试、取消和 Bash

```ts
const result = await session.compact("保留所有未完成任务和公开接口");
session.abortCompaction();
session.abortBranchSummary();

session.setAutoCompactionEnabled(true);
session.setAutoRetryEnabled(true);
session.abortRetry();

await session.abort();
```

手动压缩会先取消当前 Agent 操作。压缩失败、取消和自动重试状态应通过事件展示，不要仅依赖 Promise 是否 resolve。

会话还提供受管理的 Bash 执行：

```ts
const result = await session.executeBash(
  "pnpm test",
  (chunk) => process.stdout.write(chunk),
  { id: "test-run" },
);

session.abortBash();
```

`excludeFromContext: true` 可让命令输出不进入 LLM 上下文。远程执行场景可注入 `BashOperations`，但权限、目录和取消语义由宿主负责。

## 14. 可替换的 `AgentSessionRuntime`

当宿主支持新建、恢复、fork、clone 或导入会话时，使用 `createAgentSessionRuntime()`。它持有当前 `session` 以及与 `cwd` 绑定的 services，并在替换时复用工厂重新创建完整运行时。

```ts
import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

const createRuntime: CreateAgentSessionRuntimeFactory = async ({
  cwd,
  sessionManager,
  sessionStartEvent,
}) => {
  const services = await createAgentSessionServices({ cwd });
  return {
    ...(await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
    })),
    services,
    diagnostics: services.diagnostics,
  };
};

const runtime = await createAgentSessionRuntime(createRuntime, {
  cwd: process.cwd(),
  agentDir: getAgentDir(),
  sessionManager: SessionManager.create(process.cwd()),
});
```

工厂接收 `cwd`、`agentDir`、`sessionManager`，以及可选的 `sessionStartEvent`/`projectTrustContext`；返回完整的 `CreateAgentSessionRuntimeResult`：会话创建结果、services 和 diagnostics。`projectTrustContext` 供工厂在资源信任决策中使用，并不是 `createAgentSessionFromServices()` 的直接参数。该工厂不是返回 `Agent` 的工厂。

替换操作：

```ts
await runtime.newSession();
await runtime.switchSession("/sessions/other.jsonl");
await runtime.fork(entryId);                         // 从用户条目前分叉
await runtime.fork(entryId, { position: "at" });   // clone 到指定条目
await runtime.importFromJsonl("/imports/a.jsonl", cwdOverride);
```

所有方法都可能返回 `{ cancelled: true }`，因为扩展生命周期可以取消切换。导入不存在文件会抛 `SessionImportFileNotFoundError`；无法确定会话 cwd 且无覆盖时会抛对应 cwd 错误。

### 14.1 替换后的重新绑定

`runtime.session` 在替换后是新对象。旧会话上的事件订阅、扩展 UI 绑定和其他 session-scoped 资源不会自动迁移。

```ts
let unsubscribe = () => {};

runtime.setRebindSession(async (session) => {
  unsubscribe();
  unsubscribe = session.subscribe(forwardEvent);
  await session.bindExtensions(extensionBindings);
});
```

应用必须重新创建或绑定：

- 事件订阅；
- 扩展 UI/命令上下文；
- cwd 相关工具和权限服务；
- ResourceLoader 及扩展生命周期；
- session-scoped adapter、缓存和投影。

替换创建失败会抛错，调用者负责恢复 UI/对外状态。使用 `runtime.diagnostics` 展示创建诊断。关闭整个 runtime 使用 `await runtime.dispose()`。

## 15. 运行模式

### 15.1 SDK 内嵌模式选择

- `InteractiveMode`：完整终端 UI、编辑器、历史和内置命令；
- `runPrintMode`：单次或少量提示，输出结果后退出；
- `runRpcMode`：同进程构建的 JSON-RPC 运行模式；
- CLI `pi --mode rpc`：不链接 SDK 的独立子进程方案；
- CLI `pi --mode rpc --no-session`：RPC 子进程的**临时会话（Ephemeral）模式**，不将当前会话写入 `~/.dr-octopus/agent/sessions/` 持久化。适用于一次性脚本、测试或不需要恢复历史会话的场景；需要会话持久化时去掉 `--no-session`。

```ts
await runPrintMode(runtime, {
  mode: "text",
  initialMessage: "检查项目",
  initialImages: [],
  messages: ["再给出风险列表"],
});
```

选择原则：

- 同一 Node.js 进程、需要类型安全、直接状态访问和编程式工具/扩展定制：SDK；
- 跨语言、需要进程隔离或语言无关客户端：CLI RPC；
- 自建 Web/Electron UI：通常直接消费 `AgentSession` 事件，不使用 `InteractiveMode`。

## 16. 完整嵌入示例

```ts
import { getModel } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

const cwd = process.cwd();
const agentDir = "/app/pi-agent";

const modelRuntime = await ModelRuntime.create({
  authPath: `${agentDir}/auth.json`,
  modelsPath: `${agentDir}/models.json`,
  signal: AbortSignal.timeout(15_000),
});

const model = getModel("anthropic", "claude-opus-4-5");
if (!model) throw new Error("配置的模型不存在");

const statusTool = defineTool({
  name: "status",
  label: "Status",
  description: "读取应用健康状态",
  parameters: Type.Object({}),
  execute: async () => ({
    content: [{ type: "text", text: "healthy" }],
    details: { timestamp: Date.now() },
  }),
});

const settingsManager = SettingsManager.inMemory({
  compaction: { enabled: true },
  retry: { enabled: true, maxRetries: 2 },
});

const resourceLoader = new DefaultResourceLoader({
  cwd,
  agentDir,
  settingsManager,
  systemPromptOverride: () => "你是项目代码分析助手。",
});
await resourceLoader.reload();

const { session, extensionsResult, modelFallbackMessage } =
  await createAgentSession({
    cwd,
    agentDir,
    model,
    thinkingLevel: "medium",
    modelRuntime,
    tools: ["read", "grep", "find", "ls", "status"],
    customTools: [statusTool],
    resourceLoader,
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager,
  });

if (extensionsResult.errors.length > 0) {
  throw new AggregateError(
    extensionsResult.errors.map(
      ({ path, error }) => new Error(`${path}: ${error}`),
    ),
    "扩展加载失败",
  );
}
if (modelFallbackMessage) console.warn(modelFallbackMessage);

const unsubscribe = session.subscribe((event) => {
  if (
    event.type === "message_update" &&
    event.assistantMessageEvent.type === "text_delta"
  ) {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

try {
  await session.prompt("读取项目结构并指出最重要的三个风险");
} catch (error) {
  await session.abort();
  throw error;
} finally {
  await session.agent.waitForIdle();
  unsubscribe();
  session.dispose();
  await settingsManager.flush();
}
```

## 17. 测试与验收清单

### 构造与版本

- 所有 Pi 包处于相同兼容发布线；
- 仅从公开入口导入，类型检查通过；
- `cwd`、`agentDir`、settings、session 和 loader 的目录一致；
- 无可用模型、无认证和模型恢复失败都有明确行为。

### 提示与事件

- 普通提示、图片提示、模板展开均有测试；
- 流式期间无策略调用会被拒绝；steer/follow-up 顺序符合预期；
- text/thinking delta、工具开始/更新/结束和 agent settled 均正确投影；
- 自动重试时不会把第一次 `agent_end` 错当成最终完成。

### 工具与安全

- 允许列表、拒绝列表和 `noTools` 组合经过测试；
- 自定义/扩展工具确实被加载且被允许；
- 工具成功、参数错误、执行错误、取消和增量输出均覆盖；
- 不可信扩展/技能不会被自动加载；
- 工具 cwd、文件权限和 Bash 取消策略明确。

### 持久化与替换

- 内存、新建、继续最近、打开指定文件均可工作；
- tree navigation、fork、clone、import 的语义和取消路径经过测试；
- runtime 替换后事件、扩展和 session-scoped 服务全部重新绑定；
- 设置退出前 `flush()`，并检查 `drainErrors()`；
- 关闭时 abort、idle、unsubscribe、dispose 的顺序可靠。

## 18. 常见错误

1. 把 `createAgentSessionRuntime()` 当作 `Agent` 工厂；它要求返回完整 session runtime 结果。
2. 会话替换后继续监听旧 `runtime.session`。
3. 提供 `tools` 后忘记列出自定义或扩展工具。
4. 显式创建 `DefaultResourceLoader` 却没有先调用 `reload()`。
5. 认为 `getModel()` 返回模型就代表 API Key 可用。
6. 对远程模型目录/认证操作不设置超时。
7. 忽略 `extensionsResult.errors`、资源 diagnostics 或 settings I/O errors。
8. 在 HTTP、WebSocket、Electron IPC 或 React 组件中持有权威会话状态。
9. 用 `agent_end` 作为绝对结束信号，忽略 `willRetry` 和 `agent_settled`。
10. 混用 `@mariozechner/*` 与 `@earendil-works/*`，或混用不同版本线。
11. 通过扩展试图注入一个预构建 Agent；扩展并不改变构造边界。
12. 将第三方扩展/技能当作无权限数据，而不是会在宿主权限下运行的可信代码。

## 19. 公开能力速查

包根主要公开能力包括：

- 工厂/运行时：`createAgentSession`、`createAgentSessionRuntime`、`AgentSessionRuntime`；
- runtime services：`createAgentSessionServices`、`createAgentSessionFromServices`；
- 模型/认证：`ModelRuntime`、`ModelRegistry`、`CredentialSynchronizationError`、模型解析 helpers；
- 资源：`DefaultResourceLoader`、`ResourceLoader`、`createEventBus`；
- 会话/设置：`SessionManager`、`SettingsManager`；
- 工具：`defineTool`、`createCodingTools`、`createReadOnlyTools` 和各内置工具 factory；
- 路径：`getAgentDir`、`getPackageDir`、`getReadmePath`、`getDocsPath`、`getExamplesPath`；
- 模式：`InteractiveMode`、`runPrintMode`、`runRpcMode`；
- 类型：创建选项/结果、扩展 API、工具定义、技能、提示模板等。

以当前安装包的 `dist/index.d.ts` 和相关公开声明为最终准绳；最新文档描述的是 latest，不能无检查地复制到较旧锁定版本。

## 20. v0.84.0 基础升级摘要

### 新增功能
- 全屏 TUI 模式（`--tui-mode fullscreen`）、运行时模式切换、粘性 dock、可拖动滚动条。
- 交互式对话中渲染 Mermaid 与 LaTeX。
- 通过 `AGENTS.override.md` 实现按目录上下文覆盖。
- 自定义采样参数 `samplingParams` 与 vLLM `thinking_token_budget`。
- Baseten 提供商（`BASETEN_API_KEY`）。

### 破坏性变更
1. `ModelRegistry.getApiKeyAndHeaders()` 返回 `ProviderHeaders`，值类型为 `string | null`（保留 `null` 删除标记）。
2. `ModelRegistry.refresh()` 接收 `ModelsRefreshOptions` 并返回 `ModelsRefreshResult`。
3. `ModelRuntime.setRuntimeApiKey()` 增加可选 `AuthOperationOptions`；需要刷新状态时单独调用 `refresh({ providers, signal })`。
4. 扩展 OAuth `refreshToken(credentials, signal)` 必须接受并响应 abort signal。
5. 动态提供商刷新改为只读 `context.stored` 与 generation-guarded `context.publish({ persist, update })`，不再直接读写 store。
6. 远程会话列表摘要替换为 `SessionMetadata`；运行时状态只在获取到的 `SessionSnapshot` 中暴露。

### Octopus 相关
- v0.84.0 建立了当前会话、模型运行时和扩展 API 的基础契约。
- Octopus 产品化构建仍需设置 `piConfig.name = "Dr_Octopus"`、`piConfig.configDir = ".dr-octopus"`；`name` 必须符合可移植环境变量标识符约束，只使用 ASCII 字母、数字和下划线，并以字母或下划线开头。
- 自动 Rebrand 的环境变量仍只有 `DR_OCTOPUS_CODING_AGENT_DIR` 与 `DR_OCTOPUS_CODING_AGENT_SESSION_DIR`；其余 `PI_*` 变量名称不变。
- 若产品还需要替换交互式 onboarding 或系统提示中的品牌名称，应作为独立定制复核，不能仅依赖 `piConfig`。

## 21. v0.84.1–v0.84.3 升级摘要

v0.84.1 延续 v0.84.0 的公开 API 基线，没有发布新的破坏性变更。SDK 与宿主集成需要关注以下增量：

- 新增内置 `qwen-token-plan-individual` 提供商，默认模型为 `qwen3.8-max`，使用国际区 `QWEN_TOKEN_PLAN_API_KEY`。
- CLI 新增认证预检：`pi auth check --provider <provider>` 或 `pi auth check --model <provider/model>`；支持 `--json`、`--credentials` 和 `--no-refresh`。`--credentials` 会输出敏感凭据，只应在受控进程间集成中使用。
- 扩展阻止 `tool_call` 时可返回 `{ block: true, reason, terminate: true }`。只有同一批次所有最终工具结果均带终止语义时，Agent 才跳过自动后续模型调用；不要把单个 `terminate` 当作立即中止整个并行批次。
- `Agent.reset()` 在 Agent 非 idle 时会拒绝操作。宿主应先取消并等待 idle/settled，再重置状态。
- 全屏 TUI 增加双击选词、三击选段、按粒度拖选和半页滚动动作；Windows 右键粘贴及扩展 TUI 方法委托问题已修复。

v0.84.2–v0.84.3 在该基线上新增可配置 `defaultTools`、可选 PowerShell 工具、Session-scoped 模型与 thinking 选择、`session_compact_failed` 事件，以及 RPC tool-call 元数据和 usage 修复。公开破坏性变更仅涉及 Google thinking-level 类型重命名；资源包 glob 语义改用 Node.js 内置实现，升级时应重新验证第三方包资源发现。

本技能已用本地 `0.84.3` 的公开声明、CLI 参数实现、RPC wire types 及模型解析表复核以上契约。
