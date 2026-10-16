# ADR-0073：Windows-MCP 本机执行与智能体远程接入

## 状态

Accepted（2026-10-01，范围修正）。用户确认“只控制本机，智能体可以在远端”，取代将远程连接解释为控制其他 Windows 主机的候选。

## 决策

调用链为智能体 → 本机 Executor MCP → 本机 Windows-MCP → 本机桌面。智能体位置、MCP 传输和桌面执行位置分别定义，不提供其他 Windows 主机目标选择。

- 正式后端为固定私有 Python/Windows-MCP 和产品防护扩展，经受管 stdio 连接；无任意 command/args、系统 Python或启动下载。
- 内部 HTTP 只作为同机连接协议，需显式启用/私有 Bearer，接受数字回环 127.0.0.1/::1，拒绝其他主机、DNS、嵌入凭据、重定向和 TLS 忽略。配置区分 stdio/http，不以 local/remote 推断地点。
- 远端智能体使用已实施的显式可信内网/VPN Executor HTTP 入口，见 [ADR-0076](0076-executor-private-network-http.md)。它不改变内部桌面目标，不静默绑定 wildcard。
- Computer 只提供八个有限产品工具，不透传原版 PowerShell/Process/Clipboard/Type 或通用 callTool。实际版本与 Schema 必须满足产品防护契约。
- 彩屏属于本机任务，与智能体位置/传输无关；观察不派发键鼠，任务期间反馈持续。未知结果保留提示、不重放。
- 停止关闭新派发并等待已有动作，完整退出另清理本应用拥有的进程树；关闭外部 HTTP 连接不证明执行停止。

## 取舍与当前边界

固定本机目标简化会话、坐标和安全边界。代价是远端智能体必须连接该设备的明确入口，不能把浏览器桥接或内部桌面 HTTP 当作远端访问服务。

私有后端与唯一 Runtime owner 已装配，生产 Computer 验收门禁保持关闭，不授予能力或公布可执行入口。受管 initialize/总体预算为 30/45 秒，内部 HTTP 为 10/15 秒；启动前资源完整性预检已按用户决定删除，构建/打包核验和 Job、防护、授权保留。

当前工具、输入/观察和独立电脑矩阵见 [Computer](../architecture/executor-computer.md)，实测与未验证项见 [验证矩阵](../architecture/executor-validation.md)。本机有限成功不替代锁屏/UAC、多 DPI、原生部分输入或正式发行验收。
