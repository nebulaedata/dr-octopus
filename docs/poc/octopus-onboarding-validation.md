# octopus-onboarding：概念验证与验收

架构设计：[原设计](../architecture/octopus-onboarding.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

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
