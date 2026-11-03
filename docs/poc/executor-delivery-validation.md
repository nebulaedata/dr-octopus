# executor-delivery：概念验证与验收

架构设计：[原设计](../architecture/executor-delivery.md)。

2026-11-03 从架构正文迁入；计划与实际结果以原文标记为准，不代表新增验收通过。


## 源码环境的真实跨机文件验收

本节只针对带仓库依赖和已完成 Executor 构建的开发电脑，不是 acceptance-kit 的离线命令。被测远端只需运行 Executor，不安装探针或 Agent 桥接程序。普通 MCP SDK 负责元数据，本机已有系统 curl 负责完整文件流。

在远端手动准备文件写入授权（含读取）、内网/VPN HTTP 配置和一个已存在的独立目录。将配置通过可信方式保存到开发电脑的 Git 忽略目录，不能把 Bearer、配置正文或文件正文粘贴到报告。探针只接受一个明确的私有网络目标，拒绝本机网络接口，并核对预期地址和设备名称；任务仅申请 files.write。

从仓库根目录执行，替换示例目标与配置文件路径。输出目录必须为新的原生私有目录，以 octopus-executor- 开头；每次生成 UUID，失败输出不覆盖：

```powershell
$taskAcceptanceOutput = 'apps/executor/build/transfer-verification/octopus-executor-cross-machine-' + [guid]::NewGuid().ToString('N')
node apps/executor/test/packaging/cross-machine-transfer.mjs --config 'apps/executor/build/transfer-verification/remote-transfer.private.json' --remote-directory 'D:\下载\Executor-跨机验收-20261016' --output-directory $taskAcceptanceOutput --expected-host 192.168.0.11 --expected-device-name LAPTOP-LH
```

探针验证零字节、约 8 MiB 和 64 MiB 二进制往返及本机落盘摘要，覆盖中文/空格路径、临时凭据边界、原键查询和真实在途上传取消。私有 curl 配置在子进程收束后删除，报告不含凭据；任务与 MCP 会话收束独立记录。输出文件及远端已发布测试文件保留供复核，后续清理由使用者确认，不自动删除其他文件、撤销既有授权或重放未知发布。该范围不代替跨机 2 GiB、其他操作系统、满盘/掉电或发行门禁。

## 人工验收顺序

| 项目         | 通过条件与证据                                                                        |
| ------------ | ------------------------------------------------------------------------------------- |
| 断网首启     | 无系统 Node/Python/Git 依赖、无下载，唯一 Runtime 启动；记录真实健康状态              |
| 普通权限安装 | 无提权，正确快捷方式、资源、Chrome/Edge Host；安装失败可能留下文件，应保留错误        |
| 浏览器加载   | 实际人工加载对应完整扩展，启用桥接、选择实例、验证工具就绪与网站权限                  |
| 客户端       | 使用已确定的 Dr.Octopus Web 或另行明确的客户端，授权专用能力并运行 Basic/Browser 专项 |
| 生命周期     | 窗口隐藏/重建不影响连接，完整退出确认拥有的 Runtime/Job/Host 收敛                     |
| 主题与 DPI   | 应用、安装/卸载、任务栏、托盘图标及菜单在真实明暗主题/多 DPI 下可辨识                 |
| 升级/恢复    | 运行中拒绝升级，停止后覆盖安装；旧数据保留、损坏拒绝、恢复字节核对                    |
| 卸载         | 只删仍属本安装的 Host 注册，数据与恢复记录保留；明确撤销后凭据不可用                  |

每项记录 passed/failed/not-tested，不以代码存在或报告存在判断通过。Computer 专项按验收工具内 COMPUTER-ACCEPTANCE.md 执行，仓库来源为 executor-computer.md。

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$kit/record-acceptance.ps1" -ArtifactDirectory . -Scenario computer -Outcome not-tested -Observation '独立电脑尚未到位；未执行锁屏、UAC、混合 DPI 专项' -ReportPath ./computer-not-tested.json
```

记录工具只处理显式观察和证据名称/大小/摘要，不采集桌面、不开放能力、不改变门禁。报告不包含私有配置、令牌或用户材料。
