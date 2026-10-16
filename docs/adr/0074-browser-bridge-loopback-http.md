# ADR-0074：浏览器 Bridge 复用回环 HTTP

- 日期：2026-10-01
- 状态：已接受，连接与有限 Browser 工具阶段已实施
- 范围：Browser Native Host → 唯一 Utility Runtime；不决定外部 MCP stdio 的后续适配。

## 决定

复用现有 `127.0.0.1` HTTP 监听器，增加独立 `/browser-bridge` 协议，使用有界长轮询维持连接。浏览器 Service Worker 仍通过 Native Messaging 启动固定原生启动器，再运行随包 Node 24.20.0 与 Host bundle。用户已明确确认该推荐方案。

浏览器角色凭据与 MCP 客户端令牌分开；接口不接受 MCP 调用、授权管理、启动 Runtime 或任意代码。当前协议 v2 提供版本握手、连接身份、心跳以及仅由 Runtime 授权任务发出的有限请求和关联结果，接入 PageController，见 [Browser 契约](../architecture/executor-browser.md)。旧版本只报告握手不兼容，不执行旧协议命令。

## 认证与生命周期

默认关闭，由受信管理窗口显式启用。Runtime 使用 SID 私有、不可覆盖的顺序记录保存用户选择与当前登录绑定的 bootstrap，每次 Runtime 启动及开关变化生成新凭据。固定 Host 校验实际进程 Authentication LUID/Windows Session、配置 ACL 与扩展来源。扩展不持有 HTTP 凭据。

HTTP 拒绝网页 Origin、错误 Host、错误角色与凭据；登录标识 HTTP header 用于绑定 bootstrap，不宣称 HTTP 可以读取对端 Windows 令牌。此方案防止网页、其他普通扩展及其他用户滥用；不能保证隔离已经控制当前账号并读取私有材料的程序。扩展 public key 固定侧载 ID，不作为密码学来源证明或商店发行身份承诺。

每个安装实例使用独立连接 ID；新握手替换旧连接，旧轮询不能恢复新连接状态。单帧 256 KiB，最多 16 个安装实例、24 个桥接请求、1 MiB 总输入缓冲；一个连接只允许一个十秒轮询。无轮询活动超过 25 秒标记断开。关闭及退出释放轮询和定时器，不自动重放动作。

## 后果

减少另一套业务 IPC 的实现和部署，但长轮询共享 HTTP 资源上限，必须保留独立鉴权与并发预算。本阶段不再要求 Browser Named Pipe 的 DACL/对端令牌检查；本地 Host 依旧检查实际登录身份。总体设计中相冲突的 Browser 私有 IPC 描述由本 ADR 覆盖。外部 stdio 的内部传输已随后由 [ADR-0075](0075-executor-stdio-loopback-http.md) 单独决定。

发行前仍须验证正式 Chrome、Edge、商店身份及干净机器离线安装。当前 Chromium 与本机开发构建证据不替代 G4/G6。
