# ADR-0006: Pi Web 采用会话语义对齐

## Status

Accepted

## Context

Pi CLI/TUI 同时包含 Agent 会话能力和终端专属交互。Web 需要覆盖 Pi RPC 可表达的完整会话能力，但浏览器无法也不应复制 fullscreen TUI、终端鼠标、任意终端组件或直接 Shell 控制台。

## Decision

1. “功能对齐”定义为会话语义对齐：消息、thinking、工具、队列、模型、压缩、重试、取消、命令、附件、历史派生和标准 Extension UI 在 Web 中具有等价结果。
2. Web 使用原生路由、对话框、命令面板、富内容和响应式布局，不复制终端像素与输入机制。
3. `ctx.ui.custom()` 等 TUI 专属组件必须由扩展提供 Web/RPC 降级；Server capability 明确声明可用能力。
4. Provider 登录、Pi 包管理、直接 Shell 控制台和多用户权限不属于第一阶段。

## Consequences

- CLI/TUI 与 Web 可以共享 Pi 会话契约，而分别采用适合宿主的交互。
- 每项 UI 能力必须能追溯到共享 DTO、HTTP 用例或实时命令，不能依赖浏览器解释 Pi 内部对象。
- 新增 Pi 能力时先扩展 capability 和协议，再开放 Web 入口。

## References

- [Pi Web 架构](../architecture/octopus-web.md)
- [ADR-0005](./0005-host-owned-session-runtime-processes.md)
