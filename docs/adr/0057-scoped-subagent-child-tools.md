# ADR-0057: 用不可变入口快照传递子代理只读工具

## Status

Accepted

## Context

pi-subagents 0.68.0 的原生子会话不继承父 Pi 的内联扩展。后台 runner 还跨进程运行，不能直接复用父扩展实例。知识库需要保留工作区、集合范围和父会话工具限制，Memory 需要保留全局 off 策略与只读存储。

## Decision

- 共享 Agent CLI/RPC 组合根装配 bridge，使用上游公开 `required-child-extensions` API。
- 将宿主上下文固化为内容寻址的无参默认入口，用 requiredExtensions 强制传递给前台和后台；不写会话级全局环境变量。
- 对会话文件路径和 UUID 分别注册同一快照，兼容 0.68.0 不同启动路径的身份传递。shutdown 统一注销，部分注册失败回滚，委派前注册失败则阻断。
- 子入口复用现有 Knowledge/Memory 只读工具与业务规则，不启动 daemon，不注册交互或写工具。
- 只暴露固定只读集合与父会话活动工具的交集，不绕过知识模式限制。知识问答委派的产品权限调整不属于本次变更。
- 为兼容上游固定白名单的存在性预检，注册完整只读定义，再隐藏未授权工具并在执行前拒绝。不能只省略注册，否则仅 Memory 父会话也无法启动 explorer；不能仅依赖菜单隐藏来授权。
- 保留生成入口供 detached child 使用；不在父会话退出时删除，不存储凭证或会话正文。

## Alternatives

- 依赖父工具注册表或 `PI_SUBAGENT_PI_BINARY`：不适用于当前原生子会话架构。
- 只添加 agent tools 白名单：扩展仍未加载，无法提供工具。
- 把 workspaceId 和集合范围写入 process.env：前台会话同进程，存在范围串扰。
- fork 上游或读写内部 Symbol 注册表：增加升级耦合，公开 API 已足够。

## Consequences

前后台采用同一只读实现与范围快照，支持可重复的真实 Pi 集成验证。代价是显式 jiti 运行时依赖和少量缓存入口文件；无运行中子代理时才可离线清理缓存。后台任务采用启动时范围，跨构建升级兼容不保证。普通产品模式仍主要获得 Memory 继承；知识通道只有在宿主同时授权 knowledge 与 subagent 时可用。

详细契约与测试见[子代理工具继承设计](../architecture/octopus-subagent-child-tools.md)。
