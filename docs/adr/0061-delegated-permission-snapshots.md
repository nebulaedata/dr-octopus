# ADR-0061: 子代理复用权限判定并提供只读诊断

## Status

Accepted

## Context

活动工具并不代表每次调用都获得授权。ADR-0060 的工具名单与父活动工具交集没有包含父会话 ask/auto/full 模式、静态 deny/ask 和参数级判定。需要补齐这些语义，同时保持按名称接入，不引入父进程工具代理或实时撤销服务。

## Decision

- CLI 组合根将同一个 PermissionModeService 传给父权限扩展和 subagent-bridge；独立嵌入宿主也应显式传入自己的 service。未传入时以独立 ask 模式读取配置，不假定 full。
- 委派前重新读取父工作区有效配置与 project trust，捕获 version=1 的权限模式和配置快照。配置无效时阻断委派。快照不包含 session approval、凭证或模型输入。
- 交互权限服务与子工具共用纯 evaluatePermissionRequest 和 normalizePermissionRequest。工具级 deny/ask 不进入可执行快照；每次子工具调用仍按真实参数、子 cwd 重新判定，敏感输入和外部路径规则继续生效。
- 子代理仅执行 allow。ask 返回 CHILD_PERMISSION_REQUIRED，要求父会话处理权限后重新委派，不自动批准、不触发子会话交互。父会话的一次性或 session approval 不跨会话复制。
- 固定快照只约束本次委派；父模式或配置的后续变化影响下一次委派，不声称即时撤销运行中任务。既有无权限快照入口必须重新生成才能执行。
- 提供 /subagent-tools [tool-name] 只读命令，报告不在名单、父定义缺失、未激活、知识模式关闭、权限 ask/deny 和 Memory 配对依赖。命令不写子入口、不启动服务、不加载第三方 provider；它明确不检查特定子代理白名单或运行服务。纯诊断接口另支持调用者提供 childTools 白名单。
- 子入口检查重复注册、缺失定义和名单完整性，测试确保 CHILD_TOOLS 名称唯一且可加载。新增共享工具仍只修改名称名单。

## Consequences

默认 ask 模式下，未配置为 allow 的 custom 工具不会因为父菜单可见就委派。包括独立模型工具：需要父模式或显式权限配置允许，OCR 的实际路径仍在执行时检查。诊断中的 eligible 仅说明空参数的工具级准入，不能替代实际参数授权、服务可用性或子代理白名单。

本次仅覆盖 Octopus 桥接的内置工具，不声称为第三方扩展或 Pi 基础工具提供完整权限沙箱。实时撤销、跨进程交互批准和服务健康查询不在本次范围内。
