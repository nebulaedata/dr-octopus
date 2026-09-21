# ADR-0037: 使用结构化 Workspace Mention 协议

## Status

Accepted

## Context

Web Composer 的 `FileMentionNode` 已保存 Workspace 相对路径、类型和展示标签，但实时提交只发送
`root.getTextContent()` 生成的纯文本。模型只能从 `@path` 猜测引用语义，可能先用 Shell 探测文件再调用
`read`，产生冗余 I/O。浏览器和模型也不应依赖不可移植的 Host 绝对路径。

Pi 0.84.3 的公开 RPC 用户消息只支持 text/image，没有通用结构化文件引用字段。Dr.Octopus 必须保持 Pi
Session 为 Agent 对话权威，并保持现有 Host 消息投影、附件适配和请求关联语义。

## Decision

1. Composer 同时提交用户可见纯文本和由真实 `FileMentionNode` 生成的 `workspaceReferences`；手工输入的
   `@path` 只作为文本，不获得结构化引用身份。
2. 引用只包含 Workspace 相对 `path` 和 `file | directory` 类型。浏览器不提交、模型不接收 Host 绝对路径。
3. Shared Protocol 使用 Zod 定义最多 32 个、单路径最多 1024 字符的闭合运行时契约；实时协议版本升级为 5。
4. Workspace Service 是引用验证权威：规范化路径、验证存在性和类型、拒绝绝对路径、遍历、NUL、符号链接及
   canonical Workspace 越界。
5. Session Channel 将验证后的引用序列化为私有 `<host_workspace_references>` prompt suffix。Pi 持久化完整
   模型输入，Host 消息投影在 Web 回显前移除私有 suffix。
6. `prompt`、`steer` 与 `follow-up` 使用同一引用适配流程；附件仍由既有 Host 生命周期独立持有。
7. Productization Extension 在 system prompt 中指示模型：文件引用直接使用 `read`，不得仅为预检而先运行
   `ls`、`wc`、`stat` 或 `test`；目录引用才使用列举工具，`read` 失败后方可诊断。
8. V1 不自动内联 Workspace 文件内容。显式附件与按需文件工具保持不同语义。

## Consequences

### Positive

- 模型获得无歧义且经过 Host 验证的引用语义，常规文件读取缩减为一次 `read`。
- 相对路径可以跨主机、Workspace checkout 和工作树恢复。
- 路径验证、模型输入和用户可见消息各有明确边界。
- 不修改 Pi 私有协议，也不增加数据库迁移。

### Negative

- Server 需要维护 text-only Pi 协议上的私有 manifest 与回显剥离逻辑。
- 模型工具选择仍具有非确定性，system prompt 只能显著降低而不能数学上禁止冗余 Shell 调用。
- 提交时文件已删除、类型变化或成为符号链接会拒绝整条用户消息，用户需要修复引用后重试。

### Neutral

- 没有 `workspaceReferences` 的旧消息继续作为纯文本执行，但协议握手版本随共享契约升级。
- 文件内容仍由 Pi `read` 工具按其既有限额和错误语义读取。

## Alternatives Considered

- **继续只发送 `@path` 文本**：实现最少，但模型无法区分真实选择与手工文本，拒绝。
- **发送绝对路径**：工具调用直接，但泄露 Host 布局且不可移植，拒绝。
- **自动内联所有引用内容**：可以消除读取调用，但上下文、二进制、陈旧内容和持久化成本不可控，V1 拒绝。
- **私有扩展 Pi RPC files 字段**：结构最直接，但形成长期维护 fork，拒绝。

## References

- [ADR-0006](./0006-pi-web-semantic-parity.md)
- [ADR-0007](./0007-web-control-and-realtime-protocol.md)
- [ADR-0009](./0009-session-channel-module-boundary.md)
- [ADR-0021](./0021-host-owned-attachment-lifecycle.md)
- [ADR-0023](./0023-domain-organized-shared-protocol.md)
