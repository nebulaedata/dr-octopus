# ADR-0075：外部 MCP stdio 复用受认证回环 HTTP

- 日期：2026-10-07
- 状态：已接受，用户已确认推荐方案；验收范围见实施记录。
- 范围：外部智能体 stdio → 固定原生启动器/私有 Node → 唯一 Utility Runtime `/mcp`。

## 背景与决定

执行器已经具备唯一任务、授权和 HTTP MCP 服务。原总体设计 6.1.2 候选为独立同用户/同登录会话私有 IPC；ADR-0074 只决定 Browser 角色，未覆盖 stdio。用户本轮明确选择 stdio 复用受认证回环 HTTP，本文覆盖外部 stdio 与原私有 IPC 方案冲突的描述。

适配器使用当前 MCP 身份凭据连接固定数字回环 `/mcp`，不使用 `/browser-bridge` 或 Browser 角色凭据。只转换标准 JSON-RPC 传输；工具、任务、授权、历史和资源回收仍由原 Runtime 决定，不增加第二套执行服务。

```mermaid
flowchart LR
  Agent[智能体客户端] -->|stdio JSON-RPC| Launcher[固定原生启动器 / Job]
  Launcher --> Node[随包私有 Node / stdio 适配器]
  Node -->|Bearer / 127.0.0.1 HTTP| Runtime[唯一 Utility Runtime]
  Runtime --> Authority[现有授权 / 任务 / 工具]
```

## 安全与生命周期

- 启动器只接受固定模式和一个绝对配置路径；固定执行相邻私有 Node 与 bundle，清除会影响 Node 启动/代理的环境配置，以 kill-on-close Job 拥有子进程。不下载、不依赖系统 Node、不启动 Runtime。
- 配置由 Main 导出并在写入前设为当前 SID 私有；适配器检查 ACL、普通路径、单链接、读取身份与 64 KiB 上限。stdio 配置中的 command 必须是当前包启动器，args 必须引用当前配置本身；不执行配置提供的任意命令。
- HTTP 的鉴权与 Origin/Host/协议版本检查继续由原入口负责。HTTP 不能验证对端 Windows 登录令牌；SID 私有配置也不隔离同账号的其他登录会话或已经控制该账号的程序。未宣称与原私有 IPC 的登录身份保护等价。
- stdout 仅协议帧，日志只向 stderr 写固定安全消息；每帧 24 MiB，待写 48 MiB，最多八个未完成请求和十二个在途发送。HTTP 响应有 UTF-8/尺寸边界，拒绝重定向。
- 断线、撤销或版本不兼容结束适配器，不自动重新初始化、恢复 SSE 或重放动作。Runtime 离线只返回连接失败；不保存待执行动作。
- EOF/信号停止本适配器的新派发，尝试有两秒期限的 HTTP DELETE，然后关闭流；进程退出总收敛期限为五秒。DELETE 未确认不表示在途动作已停止；任务查询/幂等历史和执行回收证据仍属 Runtime。突然终止启动器时，Job 只收束它的私有 Node，不终止共享 Runtime。
- Windows stdout 使用异步文件流保持 EOF/定时器可运行；阻塞输出的期限后备由随包有限原生 addon 只终止当前 stdio 进程、固定返回失败码。正常退出仍排空已写消息。该接口不进入工具或桌面 IPC，实测与新增资源见 [stdio 生命周期](../architecture/executor.md#mcp-接入与等待)。

## 取舍与替代方案

复用 HTTP 减少另一套协议、部署与授权投影，代价是共享现有 HTTP 请求/会话预算、保持客户端先打开执行器的运行要求，以及不具备私有 IPC 对端登录令牌验证。适配器不代替实际智能体客户端的配置格式与等待预算验收。

独立私有 IPC 能提供 Windows 对端身份检查，但需实现另一种会话与错误/取消传输；本轮未选用。直接在 stdio 子进程建立 Runtime 会分裂任务权威和资源生命周期，不采用。

## 参考与剩余验收

[MCP 2025-11-25 传输规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)规定 stdio 换行 JSON-RPC 和协议专用 stdout，HTTP 会话终止与取消仍按该协议处理。适配器不扩大现有 MCP 功能面。

当前接入契约见 [Executor](../architecture/executor.md#mcp-接入与等待)，已完成的实际 Web HTTP/stdio、长调用和 Browser 专项及原始失败见 [验证矩阵](../architecture/executor-validation.md)。Computer 独立电脑、跨电脑与正式离线发行仍待验收，不提升 G4/G5/G6。
