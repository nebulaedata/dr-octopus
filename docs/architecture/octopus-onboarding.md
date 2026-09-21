# Dr.Octopus Onboarding 模块详细架构设计

> 文档版本：v1.4  
> 日期：2026-08-12  
> 模块位置：`packages/agent/src/extensions/onboarding`  
> 架构风格：Feature-first + Definitions + Services + Validators + Lib + Extension + SDK  
> 目标：指导 Dr.Octopus 首次模型配置、本地模型接入、云端模型认证，以及 TUI / RPC / Web 多入口开发

---

# 1. 文档目标

本文定义 Dr.Octopus `onboarding` 模块的最终目录结构、职责边界、依赖关系和开发规范。

Onboarding 模块负责：

- 首次启动模型检查
- 首次模型配置
- 本地模型运行时接入
- 云端模型认证
- 默认模型设置
- 模型可用性验证
- 配置异常恢复
- Pi Extension 生命周期接入
- 对 `apps/server` 暴露稳定 SDK
- 兼容 Pi RPC 模式下的 Extension UI

第一阶段模型来源：

```text
本地模型
├── Ollama
├── vLLM
└── LM Studio

云端模型
└── Pi Native Providers
```

---

# 2. 最终架构原则

Onboarding 的全部源码统一放在：

```text
packages/agent/src/extensions/onboarding/
```

最终采用：

```text
definitions/
services/
validators/
lib/
extension/
sdk/
index.ts
```

不再保留：

```text
domain/
application/
infrastructure/
ports/
policies/
shared/
rpc/
```

核心思想：

```text
definitions
    数据长什么样

services
    业务怎么运行

validators
    输入和状态是否合法

lib
    底层具体怎么实现

extension
    Pi 怎么进入

sdk
    其他模块怎么调用
```

---

# 3. 最终目录结构

```text
packages/agent/src/extensions/onboarding/
├── definitions/
│   ├── onboarding.ts
│   ├── model.ts
│   ├── local-runtime.ts
│   ├── auth.ts
│   ├── operation.ts
│   ├── repository.ts
│   └── runtime.ts
│
├── services/
│   ├── onboarding-service.ts
│   ├── local-model-service.ts
│   ├── native-model-service.ts
│   ├── model-config-service.ts
│   └── onboarding-runtime-coordinator.ts
│
├── validators/
│   └── onboarding-validator.ts
│
├── lib/
│   ├── errors.ts
│   │
│   ├── persistence/
│   │   ├── file-onboarding-repository.ts
│   │   ├── pi-model-config-repository.ts
│   │   └── pi-settings-repository.ts
│   │
│   ├── runtime/
│   │   └── pi-model-runtime.ts
│   │
│   ├── providers/
│   │   ├── local/
│   │   │   ├── openai-compatible-client.ts
│   │   │   ├── ollama-provider.ts
│   │   │   ├── vllm-provider.ts
│   │   │   └── lmstudio-provider.ts
│   │   │
│   │   └── native/
│   │       └── pi-auth-provider.ts
│   │
│   └── utils/
│       ├── atomic-write.ts
│       ├── timeout.ts
│       └── retry.ts
│
├── extension/
│   ├── index.ts                  # Pi InlineExtension 入口，默认导出
│   ├── lifecycle.ts
│   ├── commands.ts
│   ├── tools.ts
│   └── ui.ts
│
├── sdk/
│   └── onboarding-sdk.ts
│
└── index.ts
```

---

# 4. 分层规则总览

| 目录           | 职责                              | 是否允许运行时代码 |
| -------------- | --------------------------------- | ------------------ |
| `definitions/` | 类型、接口、输入输出契约          | 否                 |
| `services/`    | 业务流程、业务编排                | 是                 |
| `validators/`  | 输入、状态、配置校验              | 是                 |
| `lib/`         | 文件、Runtime、Provider、底层工具 | 是                 |
| `extension/`   | Pi Extension 接入                 | 是                 |
| `sdk/`         | 对外公共 API / Service Facade     | 是                 |

---

# 5. Definitions 层

`definitions/` 只放静态类型定义。

必须遵守：

```text
definitions = zero-runtime
```

允许：

```text
type
interface
import type
export type
```

不建议使用会生成运行时代码的 TypeScript `enum`。

禁止：

```text
class
function
const
let
new
z.object()
fetch()
fs
Pi API
side effect
```

`definitions/` 不负责：

- 业务判断
- 运行时校验
- 文件操作
- Provider 调用
- Pi Runtime 调用
- Error Class

---

# 6. definitions/onboarding.ts

定义 Onboarding 本身的数据结构。

```ts
import type { ModelSource } from './model';

export type OnboardingPhase =
  | 'unknown'
  | 'checking'
  | 'setup_required'
  | 'configuring_local'
  | 'authenticating_native'
  | 'selecting_model'
  | 'verifying'
  | 'ready'
  | 'error';

export type OnboardingReason =
  | 'FIRST_RUN'
  | 'NO_MODEL'
  | 'AUTH_MISSING'
  | 'LOCAL_RUNTIME_OFFLINE'
  | 'MODEL_REMOVED'
  | 'CONFIG_INVALID'
  | 'ONBOARDING_UPGRADE_REQUIRED';

export interface OnboardingState {
  version: number;
  completed: boolean;
  phase: OnboardingPhase;
  source?: ModelSource;
  providerId?: string;
  modelId?: string;
  reason?: OnboardingReason;
}

export interface OnboardingStatus {
  ready: boolean;
  completed: boolean;
  version: number;
  phase: OnboardingPhase;
  source?: ModelSource;
  providerId?: string;
  modelId?: string;
  reason?: OnboardingReason;
}
```

---

# 7. definitions/model.ts

```ts
export type ModelSource = 'local' | 'native';

export interface ModelInfo {
  providerId: string;
  modelId: string;
  name?: string;
  reasoning?: boolean;
  vision?: boolean;
}

export interface ModelProviderInfo {
  id: string;
  name: string;
  authenticated?: boolean;
}
```

内部统一使用：

```text
local
native
```

而不是：

```text
local
commercial
```

因为 `native` 表示由 Pi Native Provider / Auth / ModelRuntime 管理。

---

# 8. definitions/local-runtime.ts

```ts
export type LocalRuntimeType = 'ollama' | 'vllm' | 'lmstudio';

export interface LocalRuntimeInfo {
  id: LocalRuntimeType;
  name: string;
  defaultBaseUrl: string;
}

export interface LocalModelInfo {
  id: string;
  name?: string;
}

export interface LocalRuntimeDetectionResult {
  reachable: boolean;
  models: LocalModelInfo[];
}
```

---

# 9. definitions/auth.ts

```ts
export type ModelAuthStatus = 'authenticated' | 'unauthenticated' | 'expired' | 'unknown';

export interface AuthTextPrompt {
  message: string;
  placeholder?: string;
}

export interface AuthSecretPrompt {
  message: string;
}

export interface AuthInteraction {
  openUrl(url: string): Promise<void>;

  promptText(request: AuthTextPrompt): Promise<string>;

  promptSecret(request: AuthSecretPrompt): Promise<string>;

  showMessage(message: string): Promise<void>;
}

export interface NativeAuthResult {
  providerId: string;
  authenticated: boolean;
}
```

---

# 10. definitions/operation.ts

统一定义 SDK / Service 使用的操作输入。

```ts
import type { LocalRuntimeType } from './local-runtime';

export interface DetectLocalRuntimeInput {
  runtime: LocalRuntimeType;
  baseUrl: string;
}

export interface CompleteLocalSetupInput {
  runtime: LocalRuntimeType;
  baseUrl: string;
  modelId: string;
}

export interface StartNativeAuthInput {
  providerId: string;
}

export interface CompleteNativeSetupInput {
  providerId: string;
  modelId: string;
}
```

---

# 11. definitions/repository.ts

持久化抽象统一放这里。

```ts
import type { OnboardingState } from './onboarding';

export interface OnboardingRepository {
  load(): Promise<OnboardingState | null>;

  save(state: OnboardingState): Promise<void>;

  remove(): Promise<void>;
}

export interface ModelConfigRepository {
  upsertProvider(providerId: string, config: unknown): Promise<void>;
}

export interface SettingsRepository {
  setDefaultModel(providerId: string, modelId: string): Promise<void>;
}
```

这些只是接口，不包含实现。

---

# 12. definitions/runtime.ts

```ts
import type { ModelInfo, ModelProviderInfo } from './model';

import type { AuthInteraction, ModelAuthStatus } from './auth';

export interface AgentModelRuntime {
  getProviders(): Promise<ModelProviderInfo[]>;

  getAvailableModels(): Promise<ModelInfo[]>;

  getAuthStatus(providerId: string): Promise<ModelAuthStatus>;

  login(providerId: string, interaction: AuthInteraction): Promise<void>;

  refresh(): Promise<void>;

  findModel(providerId: string, modelId: string): Promise<ModelInfo | undefined>;
}
```

---

# 13. Services 层

`services/` 是 Onboarding 的业务核心。

目录：

```text
services/
├── onboarding-service.ts
├── local-model-service.ts
├── native-model-service.ts
├── model-config-service.ts
└── onboarding-runtime-coordinator.ts
```

Service 可以依赖：

```text
definitions/
validators/
其他 services/
```

但禁止直接依赖：

```text
lib/
```

中的具体实现。

具体实现通过构造函数或 Factory 注入。

---

# 14. onboarding-service.ts

这是 Onboarding 的主业务入口。

主要用例：

```ts
export class OnboardingService {
  async getStatus() {}

  async completeLocalSetup(input) {}

  async completeNativeSetup(input) {}

  async reset() {}
}
```

负责：

- 首次启动状态判断
- 本地模型配置入口
- 云端模型配置入口
- Onboarding 完成状态
- 状态恢复
- Reset

---

# 15. local-model-service.ts

负责：

```text
列出 Local Runtime
→ 检测 Runtime
→ 获取模型
→ 判断模型是否存在
```

例如：

```ts
export class LocalModelService {
  async getRuntimes() {}

  async detect(input) {}

  async listModels(input) {}
}
```

不直接使用：

```text
fetch
Ollama API
vLLM API
LM Studio API
```

这些属于 `lib/providers/local/`。

---

# 16. native-model-service.ts

负责：

```text
Pi Native Provider
→ 查询认证状态
→ 发起认证
→ 获取可用模型
```

只依赖：

```text
definitions/runtime.ts
definitions/auth.ts
```

不直接写 Pi SDK 细节。

---

# 17. model-config-service.ts

负责：

- 更新 Provider Config
- 更新 Default Provider
- 更新 Default Model
- 协调配置写入

不直接操作：

```text
fs
models.json
settings.json
```

而是依赖 Repository Contract。

---

# 18. onboarding-runtime-coordinator.ts

负责跨 Service 的复杂流程编排。

本地模型配置：

```text
completeLocalSetup
       │
       ▼
LocalModelService.detect
       │
       ▼
确认 model
       │
       ▼
ModelConfigService
       │
       ▼
Runtime.refresh
       │
       ▼
验证 model
       │
       ▼
更新默认模型
       │
       ▼
保存 onboarding state
```

Coordinator 不关心：

- 文件路径
- HTTP URL 拼接
- Pi ModelRuntime 具体 API
- JSON 文件写入细节

---

# 19. Validators 层

```text
validators/
└── onboarding-validator.ts
```

负责：

- 输入是否合法
- Base URL 是否符合基本要求
- 当前状态能否完成 Onboarding
- 当前模型是否满足 Ready 条件
- Local Runtime 状态判断
- Native Auth 状态判断

例如：

```ts
export class OnboardingValidator {
  validateReadiness(...) {}

  validateLocalSetup(...) {}

  validateNativeSetup(...) {}
}
```

如果使用 Zod：

```ts
z.object(...)
```

也放到 `validators/`，因为 Zod Schema 是运行时代码。

---

# 20. Lib 层

所有底层具体实现统一收敛到：

```text
lib/
```

内部继续分：

```text
lib/
├── errors.ts
├── persistence/
├── runtime/
├── providers/
└── utils/
```

原则：

> `lib/` 可以复杂，但必须通过子目录明确隔离，不能平铺成杂物目录。

---

# 21. lib/errors.ts

业务运行时 Error Class 统一放：

```text
lib/errors.ts
```

例如：

```ts
export class LocalRuntimeUnavailableError extends Error {}

export class ModelNotFoundError extends Error {}

export class ProviderAuthFailedError extends Error {}

export class ConfigWriteFailedError extends Error {}
```

不放：

```text
definitions/
```

因为 Error Class 会产生运行时代码。

当前 Error 数量较少，不单独建立：

```text
lib/errors/
```

如果未来错误类型明显增多，再拆目录。

---

# 22. lib/persistence

```text
lib/persistence/
├── file-onboarding-repository.ts
├── pi-model-config-repository.ts
└── pi-settings-repository.ts
```

---

# 23. file-onboarding-repository.ts

实现：

```ts
OnboardingRepository;
```

管理：

```text
~/.dr-octopus/agent/onboarding.json
```

建议内容：

```json
{
  "version": 1,
  "completed": true,
  "modelSource": "local",
  "local": {
    "runtime": "ollama",
    "baseUrl": "http://127.0.0.1:11434/v1"
  },
  "lastConfiguredProvider": "ollama",
  "lastConfiguredModel": "qwen3-coder",
  "completedAt": "2026-08-12T00:00:00.000Z"
}
```

禁止保存：

- API Key
- OAuth Token
- Access Token
- Refresh Token

---

# 24. pi-model-config-repository.ts

管理：

```text
~/.dr-octopus/agent/models.json
```

本地模型最终统一注册到 Pi 原生 `models.json`。

禁止创建：

```text
local-models.json
dr-octopus-models.json
```

作为第二套模型 Registry。

---

# 25. pi-settings-repository.ts

管理：

```text
~/.dr-octopus/agent/settings.json
```

负责 Merge：

```json
{
  "defaultProvider": "ollama",
  "defaultModel": "qwen3-coder",
  "defaultThinkingLevel": "medium"
}
```

禁止整体覆盖 Pi Settings。

---

# 26. Atomic Write

以下文件必须原子写入：

```text
models.json
settings.json
onboarding.json
```

推荐：

```text
target.tmp
   │
   ▼
write
   │
   ▼
close
   │
   ▼
rename
   │
   ▼
target
```

具体工具：

```text
lib/utils/atomic-write.ts
```

---

# 27. lib/runtime

```text
lib/runtime/
└── pi-model-runtime.ts
```

实现：

```ts
AgentModelRuntime;
```

只有这里直接处理 Pi 的：

- ModelRuntime
- ModelRegistry
- Provider Auth
- Runtime refresh
- Model lookup

Pi 升级导致的兼容调整尽量限制在这一层。

---

# 28. lib/providers/local

```text
lib/providers/local/
├── openai-compatible-client.ts
├── ollama-provider.ts
├── vllm-provider.ts
└── lmstudio-provider.ts
```

三个 Runtime 尽量共享：

```text
OpenAICompatibleClient
```

---

# 29. OpenAICompatibleClient

负责：

```text
healthCheck
listModels
testModel
```

示例：

```ts
export class OpenAICompatibleClient {
  async healthCheck() {}

  async listModels() {}

  async testModel(modelId: string) {}
}
```

---

# 30. Ollama Provider

默认 Base URL：

```text
http://127.0.0.1:11434/v1
```

Provider ID：

```text
ollama
```

模型：

```text
ollama/qwen3-coder
```

---

# 31. vLLM Provider

默认：

```text
http://127.0.0.1:8000/v1
```

必须允许用户修改 Base URL。

典型场景：

- Docker
- WSL
- GPU Server
- Remote Host

---

# 32. LM Studio Provider

默认：

```text
http://127.0.0.1:1234/v1
```

Provider ID：

```text
lmstudio
```

---

# 33. lib/providers/native

```text
lib/providers/native/
└── pi-auth-provider.ts
```

云端认证完整复用 Pi Native Auth。

不要重新实现：

- OpenAI Login
- Anthropic Login
- Google Login
- GitHub Copilot Login
- OpenRouter Login

Dr.Octopus 只负责：

```text
选择 Provider
→ 调用 Pi Native Auth
→ 选择模型
```

---

# 34. lib/utils

```text
lib/utils/
├── atomic-write.ts
├── timeout.ts
└── retry.ts
```

只放：

> 无明确 Onboarding 业务语义的基础工具。

禁止把 Service 或 Provider 实现塞到 `utils/`。

---

# 35. 本地模型配置流程

```text
选择本地模型
      │
      ▼
选择 Runtime
      │
 ┌────┼────────┐
 ▼    ▼        ▼
Ollama vLLM LM Studio
      │
      ▼
确认 Base URL
      │
      ▼
检测 Runtime
      │
      ▼
获取模型列表
      │
      ▼
选择模型
      │
      ▼
生成 Pi Provider Config
      │
      ▼
merge models.json
      │
      ▼
刷新 ModelRuntime
      │
      ▼
验证模型
      │
      ▼
merge settings.json
      │
      ▼
保存 onboarding.json
      │
      ▼
READY
```

---

# 36. 云端模型配置流程

```text
选择云端模型
      │
      ▼
获取 Pi Native Providers
      │
      ▼
选择 Provider
      │
      ▼
Pi Native Auth
      │
      ▼
认证成功
      │
      ▼
刷新 Model Runtime
      │
      ▼
获取 Provider Models
      │
      ▼
选择模型
      │
      ▼
设置默认模型
      │
      ▼
保存 onboarding.json
      │
      ▼
READY
```

---

# 37. Extension 层

```text
extension/
├── index.ts                  # Pi InlineExtension 入口，默认导出
├── lifecycle.ts
├── commands.ts
├── tools.ts
└── ui.ts
```

Extension 是 Pi `InlineExtension` 接入层。

其中：

```text
extension/index.ts
```

是唯一入口文件，并默认导出 Extension Factory。最终通过：

```ts
await runPiCli(args, {
  extensionFactories: [
    createOnboardingExtension({
      onboarding: onboardingSDK,
    }),
  ],
});
```

注入 Pi Runtime。TUI 与 `--mode rpc` 使用同一套 InlineExtension，不维护两份实现。

不承担：

- Runtime 实现
- 文件持久化
- Provider HTTP
- 核心业务编排

---

# 38. extension/index.ts

`extension/index.ts` 是 Onboarding 的 Pi `InlineExtension` 唯一入口文件。

推荐默认导出 Extension Factory：

```ts
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import { registerLifecycle } from './lifecycle.js';

import { registerCommands } from './commands.js';

import { registerTools } from './tools.js';

import type { OnboardingSDK } from '../sdk/onboarding-sdk.js';

export interface OnboardingExtensionOptions {
  onboarding: OnboardingSDK;
}

export default function createOnboardingExtension(options: OnboardingExtensionOptions) {
  return function onboardingExtension(pi: ExtensionAPI) {
    registerLifecycle(pi, options);
    registerCommands(pi, options);
    registerTools(pi, options);
  };
}
```

最终由 Dr.Octopus Bootstrap 注入：

```ts
const onboardingSDK = createOnboardingSDK();

await runPiCli(args, {
  extensionFactories: [
    createOnboardingExtension({
      onboarding: onboardingSDK,
    }),
  ],
});
```

因此 `extension/index.ts` 只负责：

```text
Pi InlineExtension Factory
→ lifecycle
→ commands
→ tools
→ ui
```

不承担 Service、Provider、Runtime 或持久化逻辑。

---

# 39. lifecycle.ts

启动检查：

```ts
pi.on('session_start', async (event, ctx) => {
  if (event.reason !== 'startup') {
    return;
  }

  const status = await onboardingSDK.getStatus();

  if (status.ready) {
    return;
  }

  await showSetupRequired(ctx, status);
});
```

不要在：

```text
new
resume
fork
```

时重复 First Run。

---

# 40. commands.ts

推荐：

```text
/setup
/octopus-model
```

用途：

- 手动重新配置
- 修复认证
- 修复本地 Runtime
- 模型设置入口

---

# 41. tools.ts

第一阶段只建议只读：

```text
get_model_status
list_available_models
check_local_runtime
```

高风险写操作不默认暴露给 LLM。

---

# 42. ui.ts

优先使用 Pi RPC-compatible UI：

```ts
ctx.ui.select();
ctx.ui.confirm();
ctx.ui.input();
ctx.ui.editor();
ctx.ui.notify();
```

不要让核心流程依赖：

```ts
ctx.ui.custom();
```

`custom()` 只用于 TUI-only 场景。

---

# 43. Onboarding 不实现自己的 RPC

正式删除：

```text
packages/agent/src/extensions/onboarding/rpc/
```

不再存在：

```text
control-protocol.ts
control-server.ts
auth-protocol.ts
auth-session-manager.ts
rpc-onboarding-client.ts
```

原因：

1. Pi Runtime 已有 Pi RPC。
2. Onboarding 业务通过 SDK 暴露给 Server。
3. Pi 已提供 Extension UI RPC Protocol。
4. 再做 Feature RPC 会产生重复抽象。
5. 第三方 Extension 也需要共用同一个 UI Bridge。

---

# 44. Pi Extension RPC 兼容

Onboarding Extension 只需要：

> 使用 Pi RPC-compatible UI API。

例如：

```ts
const source = await ctx.ui.select('选择模型来源', ['本地模型', '云端模型']);
```

TUI：

```text
ctx.ui.select
→ Terminal Dialog
```

RPC：

```text
ctx.ui.select
→ extension_ui_request
→ Server
→ Web
→ extension_ui_response
→ Promise resolve
```

Onboarding 自己无需感知底层 JSON RPC 协议。

---

# 45. Server 通用 Pi RPC 层

推荐：

```text
apps/server/src/lib/rpc/
├── pi-rpc-client.ts
├── pi-process-manager.ts
├── pi-rpc-protocol.ts
├── pi-event-handler.ts
└── extension-ui-bridge.ts
```

这一层负责所有 Pi Runtime RPC。

---

# 46. ExtensionUiBridge

`extension-ui-bridge.ts` 是通用能力。

流程：

```text
Pi Extension
     │
     ▼
ctx.ui.*
     │
     ▼
Pi RPC
     │
     ▼
extension_ui_request
     │
     ▼
apps/server
     │
     ▼
ExtensionUiBridge
     │
     ▼
WebSocket
     │
     ▼
Web UI
     │
     ▼
extension_ui_response
     │
     ▼
Pi RPC
```

这个 Bridge 不属于 Onboarding。

Workspace、Memory、第三方 Pi Extension 都可以复用。

---

# 47. SDK 层

最终只保留：

```text
sdk/
└── onboarding-sdk.ts
```

SDK 定义：

> Onboarding Feature Public API / Service Facade。

它是内部 Services 的统一扎口。

---

# 48. 为什么 SDK 必须保留

内部有：

```text
OnboardingService
LocalModelService
NativeModelService
ModelConfigService
OnboardingRuntimeCoordinator
```

这些都是内部实现细节。

Server 不应该知道这些拆分。

正确：

```text
apps/server
    │
    ▼
OnboardingSDK
    │
    ▼
Services
```

错误：

```text
apps/server
    ├── OnboardingService
    ├── LocalModelService
    ├── NativeModelService
    └── ModelConfigService
```

---

# 49. onboarding-sdk.ts

```ts
export interface OnboardingSDK {
  getStatus(): Promise<OnboardingStatus>;

  getLocalRuntimes(): Promise<LocalRuntimeInfo[]>;

  detectLocalRuntime(input: DetectLocalRuntimeInput): Promise<LocalRuntimeDetectionResult>;

  completeLocalSetup(input: CompleteLocalSetupInput): Promise<OnboardingStatus>;

  getNativeProviders(): Promise<ModelProviderInfo[]>;

  startNativeAuth(input: StartNativeAuthInput, interaction: AuthInteraction): Promise<NativeAuthResult>;

  completeNativeSetup(input: CompleteNativeSetupInput): Promise<OnboardingStatus>;

  reset(): Promise<void>;
}
```

---

# 50. SDK Composition Root

当前可以让：

```text
sdk/onboarding-sdk.ts
```

同时承担默认依赖组装。

示意：

```ts
export function createOnboardingSDK(
  options: OnboardingSDKOptions,
): OnboardingSDK {
  const onboardingRepository =
    new FileOnboardingRepository(...);

  const modelConfigRepository =
    new PiModelConfigRepository(...);

  const settingsRepository =
    new PiSettingsRepository(...);

  const modelRuntime =
    new PiModelRuntime(...);

  const localProviders = [
    new OllamaProvider(),
    new VllmProvider(),
    new LMStudioProvider(),
  ];

  // 创建 services
  // 注入 definitions contracts
  // 返回统一 SDK
}
```

如果未来组装复杂度明显上升，再单独增加：

```text
composition/
```

当前不需要。

---

# 51. SDK 是模块边界

`packages/agent/src/extensions/onboarding` 对外只暴露：

```text
createOnboardingSDK
OnboardingSDK
createOnboardingExtension
必要 Public Definitions
```

禁止外部 Deep Import：

```text
services/*
lib/*
validators/*
```

---

# 52. 根目录 index.ts

注意存在两个不同入口：

```text
onboarding/index.ts
```

是整个 Onboarding Feature 的 Public API 出口。

```text
onboarding/extension/index.ts
```

是 Pi `InlineExtension` 的默认入口。

两者职责不能混淆。

推荐根目录：

```ts
export { createOnboardingSDK } from './sdk/onboarding-sdk';

export type { OnboardingSDK } from './sdk/onboarding-sdk';

export { default as createOnboardingExtension } from './extension/index.js';

export type { OnboardingStatus } from './definitions/onboarding';

export type { LocalRuntimeInfo } from './definitions/local-runtime';
```

内部 Service / Lib 不 export。

---

# 53. Package Exports

推荐：

```json
{
  "exports": {
    "./onboarding": "./dist/extensions/onboarding/index.js",
    "./workspace": "./dist/extensions/workspace/index.js"
  }
}
```

外部统一：

```ts
import { createOnboardingSDK } from '@dr-octopus/agent/onboarding';
```

---

# 54. Web 启动策略

采用：

```text
Onboarding First
Pi RPC Second
```

流程：

```text
Dr.Octopus Server
        │
        ▼
OnboardingSDK.getStatus()
        │
   ┌────┴────┐
   │         │
 READY    NOT READY
   │         │
   ▼         ▼
Start Pi   Web Setup
 RPC         │
             ▼
       OnboardingSDK
             │
             ▼
        Setup Complete
             │
             ▼
         Start Pi RPC
```

---

# 55. 首次配置期间不启动 Pi RPC

避免：

```text
Server 修改配置
      │
      ▼
已启动 Pi RPC 持有旧 Runtime 状态
```

推荐：

```text
完成配置
   │
   ▼
落盘
   │
   ▼
验证
   │
   ▼
启动 Pi RPC
```

---

# 56. Runtime 模型切换

首次配置结束后：

```text
set_model
get_available_models
cycle_model
set_thinking_level
```

统一走 Pi RPC。

Onboarding 不重复实现 Model Switch。

---

# 57. `/login` 边界

TUI：

```text
/login
```

继续走 Pi 原生 Login。

Web：

```text
OnboardingSDK
→ NativeModelService
→ Pi Native Auth
```

禁止：

```text
Pi RPC prompt("/login")
```

把 built-in interactive command 当 RPC API 使用。

---

# 58. Extension Command

自己注册：

```text
/setup
/octopus-model
```

属于 Extension Command。

它们可以在 Pi RPC 模式下继续使用。

Pi Built-in：

```text
/login
/settings
```

不属于普通 Extension Command。

---

# 59. Ready 判断

`onboarding.completed === true` 不代表当前 Runtime 可用。

真正 Ready 应综合：

- Onboarding Version
- 当前模型存在
- Local Runtime 在线
- Native Auth 有效
- Provider 可用
- Model 可用

例如：

```json
{
  "completed": true,
  "ready": false,
  "reason": "LOCAL_RUNTIME_OFFLINE"
}
```

---

# 60. 异常恢复

## Local Runtime Offline

```text
LOCAL_RUNTIME_OFFLINE
```

UI：

```text
[重新检测]
[修改模型配置]
```

## Auth Missing

```text
AUTH_MISSING
```

UI：

```text
[重新登录]
[切换模型]
```

## Model Removed

```text
MODEL_REMOVED
```

UI：

```text
[重新选择模型]
[重新检测]
```

这些情况不应把：

```text
completed
```

重新改成 false。

---

# 61. Onboarding Version

```ts
export const CURRENT_ONBOARDING_VERSION = 1;
```

未来加入：

- Memory
- Workspace
- MCP
- Skills
- Sandbox

可以升级：

```ts
CURRENT_ONBOARDING_VERSION = 2;
```

并返回：

```text
ONBOARDING_UPGRADE_REQUIRED
```

---

# 62. Security

禁止日志记录：

- API Key
- Access Token
- Refresh Token
- auth.json 内容

允许：

- providerId
- modelId
- runtime
- baseUrl
- auth status
- error code
- duration

Web API 只返回认证状态，不返回 Credential 内容。

---

# 63. 并发控制

以下写操作必须串行：

```text
models.json
settings.json
onboarding.json
credential mutation
```

例如：

```ts
await onboardingLock.runExclusive(async () => {
  // config mutation
});
```

---

# 64. Workspace 解耦

Onboarding 是 Global Agent Feature。

统一使用：

```text
~/.dr-octopus/agent
```

第一版不设计：

```text
<workspace>/.dr-octopus/models.json
```

Workspace-specific Model 留待后续独立设计。

---

# 65. Rebrand Patch 边界

继续维持 Small Pi Rebrand Patch。

只处理：

- 产品名称
- CLI 名称
- configDir
- agentDir
- 必要环境变量
- 必要默认路径

不修改：

- Pi Model Core
- Pi Provider Core
- Pi RPC Protocol
- Pi Login Core
- Pi Session Core

---

# 66. 依赖规则

推荐依赖关系：

```text
definitions
    ▲
    │
services
    ▲
    │
 ┌──┴───────────────┐
 │                  │
extension          sdk
```

`lib` 实现 `definitions` 中的接口，并在 SDK Composition 阶段注入 Services。

允许：

```text
services → definitions
validators → definitions
lib → definitions
sdk → services
sdk → lib
extension → sdk
```

禁止：

```text
definitions → services
definitions → lib
services → lib concrete implementation
apps/server → services/*
apps/server → lib/*
```

---

# 67. 推荐调用关系

Web：

```text
apps/server
    │
    ▼
OnboardingSDK
    │
    ▼
Services
    │
    ▼
Definitions Contracts
    ▲
    │ implements
    │
   Lib
```

Pi Extension：

```text
Pi Extension
    │
    ▼
OnboardingSDK
```

Pi Extension RPC UI：

```text
Pi Extension
    │
    ▼
Pi RPC
    │
    ▼
Server ExtensionUiBridge
    │
    ▼
Web
```

---

# 68. 测试策略

## Definitions

主要通过 TypeScript 编译保证。

## Services

重点 Unit Test：

```text
OnboardingService
LocalModelService
NativeModelService
ModelConfigService
OnboardingRuntimeCoordinator
```

使用 Mock：

```text
Repository
Runtime
Provider
```

## Validators

测试：

```text
Ready / Not Ready
Invalid Base URL
Missing Model
Missing Auth
Offline Runtime
```

## Lib

Contract Test：

```text
FileOnboardingRepository
PiModelConfigRepository
PiSettingsRepository
PiModelRuntime
OllamaProvider
VllmProvider
LMStudioProvider
PiAuthProvider
```

## Extension

测试：

```text
session_start
/setup
ctx.ui RPC-compatible flow
```

## SDK

测试：

```text
Public API
Service Facade
Dependency Composition
```

---

# 69. 第一阶段开发顺序

## Phase 1

实现：

```text
definitions/
```

## Phase 2

实现：

```text
validators/
services/
```

先使用 Mock Contract。

## Phase 3

实现：

```text
lib/persistence/
lib/utils/
```

## Phase 4

实现：

```text
lib/providers/local/
```

## Phase 5

实现：

```text
lib/runtime/
lib/providers/native/
```

## Phase 6

实现：

```text
sdk/onboarding-sdk.ts
```

`apps/server` 开始只通过 SDK 使用 Onboarding。

## Phase 7

实现 Web Onboarding。

## Phase 8

实现：

```text
Onboarding Preflight
→ Pi RPC Bootstrap
```

## Phase 9

实现：

```text
extension/
```

## Phase 10

Server 实现通用：

```text
extension-ui-bridge.ts
```

确保第三方 Pi Extension 也能 Web 化。

---

# 70. 第一阶段明确不做

v1 不做：

- Onboarding 自建 RPC
- RpcOnboardingClient
- 自动安装 Ollama
- 自动下载模型
- 自动启动 vLLM
- 自动启动 LM Studio
- GPU 检测
- Benchmark
- Workspace-specific Model
- 独立 Credential Store
- 自研 OAuth

v1 只负责：

```text
发现
配置
认证
选择
验证
恢复
```

---

# 71. 最终总体架构

```text
                            Dr.Octopus
                                 │
                    ┌────────────┴────────────┐
                    │                         │
                   TUI                       Web
                    │                         │
                    ▼                         ▼
              Pi Extension               apps/server
                    │                         │
                    │                         ▼
                    └────────────────── OnboardingSDK
                                              │
                                              ▼
                                           Services
                                              │
                                              ▼
                                    Definitions Contracts
                                              ▲
                                              │ implements
                                              │
                                             Lib
                              ┌───────────────┼───────────────┐
                              ▼               ▼               ▼
                         Persistence        Runtime        Providers
                                                              │
                                                     ┌────────┴────────┐
                                                     ▼                 ▼
                                                   Local             Native
```

Extension RPC UI：

```text
Pi Extension
     │
     ▼
Pi RPC
     │
     ▼
apps/server
     │
     ▼
ExtensionUiBridge
     │
     ▼
Web UI
```

---

# 72. 最终目录定稿

```text
packages/agent/src/extensions/onboarding/
├── definitions/
│   ├── onboarding.ts
│   ├── model.ts
│   ├── local-runtime.ts
│   ├── auth.ts
│   ├── operation.ts
│   ├── repository.ts
│   └── runtime.ts
│
├── services/
│   ├── onboarding-service.ts
│   ├── local-model-service.ts
│   ├── native-model-service.ts
│   ├── model-config-service.ts
│   └── onboarding-runtime-coordinator.ts
│
├── validators/
│   └── onboarding-validator.ts
│
├── lib/
│   ├── errors.ts
│   ├── persistence/
│   ├── runtime/
│   ├── providers/
│   │   ├── local/
│   │   └── native/
│   └── utils/
│
├── extension/
│   ├── index.ts                  # Pi InlineExtension 入口，默认导出
│   ├── lifecycle.ts
│   ├── commands.ts
│   ├── tools.ts
│   └── ui.ts
│
├── sdk/
│   └── onboarding-sdk.ts
│
└── index.ts
```

---

# 73. CLI / RPC Bootstrap 注入方式

Dr.Octopus CLI 最终通过 Pi `main()` 的 `extensionFactories` 注入内置 Extension。

推荐：

```ts
import { main as runPiCli } from '@earendil-works/pi-coding-agent';

import { createOnboardingSDK, createOnboardingExtension } from '@dr-octopus/agent/onboarding';

import { installBundledInfra, isBundledInfraInstalled } from '../infra/index.js';

import { prepareOfflineEnv } from './prepare-env.js';

import { renderStartupLogo, runWithInstallAnimation } from './terminal-ui.js';

export async function runOctopusCli(args: string[]): Promise<void> {
  prepareOfflineEnv();

  await renderStartupLogo(args);

  const isInstalled = await isBundledInfraInstalled();

  if (!isInstalled) {
    await runWithInstallAnimation(installBundledInfra);
  }

  const onboardingSDK = createOnboardingSDK();

  await runPiCli(args, {
    extensionFactories: [
      createOnboardingExtension({
        onboarding: onboardingSDK,
      }),
    ],
  });
}
```

未来加入 Workspace / Memory 后：

```ts
await runPiCli(args, {
  extensionFactories: [
    createOnboardingExtension({
      onboarding: onboardingSDK,
    }),
    createWorkspaceExtension({
      workspace: workspaceSDK,
    }),
    createMemoryExtension({
      memory: memorySDK,
    }),
  ],
});
```

同一套 `extensionFactories` 同时用于 TUI 与 RPC 模式。Extension 内部只对 TUI-only UI 能力使用 `ctx.mode` 做必要分支。

---

# 74. 最终结论

Onboarding 模块最终采用：

```text
Definitions
Services
Validators
Lib
Extension
SDK
```

并明确：

`definitions/`

> 只放静态类型定义和接口契约。

`services/`

> 放全部核心业务流程和业务编排。

`validators/`

> 放运行时输入、状态和配置校验。

`lib/`

> 放全部底层具体实现，并按 persistence / runtime / providers / utils 隔离；业务 Error Class 当前统一放 `lib/errors.ts`。

`extension/`

> 只负责 Pi InlineExtension 接入；`extension/index.ts` 是默认入口，并使用 Pi RPC-compatible UI。

`sdk/`

> 是 Services 的统一扎口，也是整个 Onboarding Feature 对外稳定 Public API。

正式删除：

```text
domain/
application/
infrastructure/
ports/
policies/
shared/
rpc/
rpc-onboarding-client.ts
```

Pi RPC 不属于 Onboarding 私有能力。

Extension RPC UI 兼容统一由：

```text
apps/server/src/lib/rpc/extension-ui-bridge.ts
```

负责。

最终原则：

> Feature 内部可以持续重构，Server 永远只依赖 SDK；Extension 只是 Pi 入口；Lib 只是底层实现；Definitions 只定义契约；Services 承担业务；Validators 负责校验；Pi RPC UI 兼容由 Server 通用桥接层统一处理。

本设计作为 Dr.Octopus Onboarding 模块后续开发的正式架构基线。
