# Executor 项目规范

根 AGENTS.md、[代码开发规范](../../docs/code-development-standards.md) 始终适用；涉及 Electron 进程、IPC、窗口或发行时遵守 [Electron 开发规范](../../docs/electron-development-standards.md)。

## 职责与阅读入口

apps/executor 是 Windows 本地工具执行器，不运行模型、Pi 会话/CLI/RPC、用户扩展或第二套 Agent Loop。Basic 自研，Browser 使用自有扩展/PageController，Computer 使用固定私有本机后端。apps/desktop 留作未来 Web 智能体客户端。

本文件维护项目约束；操作步骤、设计、验证状态分别由以下文档维护，不追加阶段进度：

| 文档                                                            | 范围                                     |
| --------------------------------------------------------------- | ---------------------------------------- |
| [开发指南](../../README.dev.zh-CN.md#executor-与浏览器插件构建) | 构建快速命令、产物位置与操作入口         |
| [Executor](../../docs/architecture/executor.md)                 | 架构、MCP、授权、任务、界面与 ADR        |
| [Basic](../../docs/architecture/executor-basic-tools.md)        | 文件、PowerShell、恢复与搜索             |
| [Browser](../../docs/architecture/executor-browser.md)          | Bridge、页面身份、工具、反馈与恢复       |
| [Computer](../../docs/architecture/executor-computer.md)        | 后端、捕获/输入、彩屏与独立电脑矩阵      |
| [交付](../../docs/architecture/executor-delivery.md)            | 固定资源、打包、离线验收与门禁           |
| [验证](../../docs/architecture/executor-validation.md)          | 实际通过、原始失败与未验证项             |
| [签名发布 SOP](RELEASE.md)                                      | 证书、签名范围、清单顺序、发行验证与分发 |

用户操作见 [INSTALLATION.md](INSTALLATION.md)。用户已确认边界优先于旧候选与示例，冲突应修正文档，不能因此扩大产品范围。

## 目录与依赖

- main 负责单实例、窗口/托盘、安全、IPC、凭据及 Runtime 监管；preload 仅有具名有限 API；renderer 仅管理安全投影。
- runtime 拥有唯一任务、授权、工具和持久结果，不绑定窗口/路由生命周期；bridge 只转换协议并连接同一 Runtime。
- contracts 只放跨进程 DTO/Schema；内部类型靠近实现。跨应用纯 Browser 协议进入现有 packages/shared；文件传输仅由本应用消费，工具与传输 Schema 保持在 runtime/transfer。
- 扩展独立放 apps/browser-extension，不反向导入本项目；PageController 不进入 Main/Runtime。
- native 是有限 Windows 原语，vendor 固定后端/版本/哈希/小补丁；scripts 的 compile/resources/package 放 package.json 可调用的 .mjs 工程入口，lib 放辅助模块，使用 node 直接执行，不依赖 TS loader。
- scripts/lib 放纯 JavaScript 工程辅助模块，不反向导入命令入口，不承载授权、任务、备份恢复等业务规则。需要应用契约时先编译为 JS 再读取，不复制业务实现；业务维护代码归 src/maintenance，平台安装代码归 src/installation/<platform>，验收探针归 test/packaging。
- 平台差异通过 scripts/lib/platform.mjs 的显式 if/else 分支选择；当前仅 Windows x64 实现，macOS/Linux 保留明确未实现错误，不假装跨平台可用。应用源码和开发测试可继续使用 TypeScript；生产与工程入口不直接执行 TS。
- Host 专属能力保持在本项目，不为统一目录新增共享 Runtime/Contracts。Agent Core、共享 shadcn 源组件的保护规则继续适用。
- 生成资源、缓存、二进制、测试输出和用户数据不进入源码，不预建空目录模板。

## 当前产品不变量

- 业务持久化统一使用 `~/.dr-octopus/executor`：settings.json、device、connections、tasks、browser、file-operations、shell、transfers、settings-recovery。AppData 仅由 Electron 管理缓存；可丢弃搜索材料位于 os.tmpdir() 的实例私有目录。同卷发布暂存跟随目标卷。独立实例/测试使用 userData/project，不导入旧路径。Basic 文件与搜索工具按完整路径排除业务根和临时根；PowerShell 仍按当前用户权限运行。传输限额只约束执行体磁盘，重启生效。见 [ADR-0083](../../docs/adr/0083-executor-project-storage.md)。

- 授权绑定设备客户端与能力，不选择工作区。cwd 是执行上下文，Browser/Computer 不依赖文件目录；操作系统、路径、任务所有者、能力与撤销仍校验。
- 创建授权与复制/可选下载分离，Main 加密持有凭据，Renderer 只见占位符和安全摘要，不取得 Bearer、命令或通用 IPC。
- 所有入口共享唯一 TaskAuthority，身份来自认证，工具参数不能登记任务或扩大权限。旧任务、已撤销授权和不同输入的幂等键不得复用。
- 文件采用版本检查、原生备份与 journal，不保证外部原子比较。提交后的取消/后处理失败不能当作未修改，未知结果不重放。
- Browser 只关闭新派发，允许在途动作完成；不增加许可世代、强停止确认、reconcile 或 Browser 恢复隔离。不泛化为放弃 PowerShell/Computer 的 Job 清理。
- Computer 只操作本机；固定受管后端随 Runtime 启动，握手和当前可用状态确认后才允许显式桌面授权与工具发现，不提供任意后端或环境变量/Renderer/MCP 开关，展示名为“桌面控制工具”。独立电脑与正式发布验收继续单独记录，不将启用视为验收通过。
- Computer 启动完整性预检已明确删除：不读清单、不算摘要、不遍历资源、不保留开关。构建/打包校验、固定入口、握手、授权、防护、Job 监管继续保留，Node/文件原生摘要不删除。
- 受管 stdio initialize 30 秒/总体 45 秒，回环 HTTP 10/15 秒，discovery/动作 10 秒。失败不重试或扩大能力，一次性阶段/字节采集接口已删除。
- Computer 彩屏覆盖任务/思考间隙，未知持续提示；多屏透明渐变、连续流动、reduced-motion，不恢复逐调用闪退/实色边条。输入前取得实际绘制确认。
- Computer 活动期间，本机无修饰键的实体 Esc 与托盘停止入口取消当前桌面任务并关闭固定后端；忽略注入键、重复按下和旧活动/Runtime 回调。确认后台退出并收束在途调用后才清除彩屏，未知效果及持久隔离不重置；本次进程内不重新启用后端，需完整重启。
- 界面为状态、连接、设置三页，原生 Window Controls Overlay 与默认控件尺寸；关闭默认系统托盘，可选任务栏或完整退出，保存偏好保留。不恢复底部按钮或废弃最小化 IPC。
- Host 自动维护只迁移当前完整身份集合匹配的本产品注册，不兼容旧身份集合，未知/丢失 manifest 拒绝，旧卸载只删仍属自己的注册；授权、桥接启用、扩展更新独立。
- 远端智能体使用已确认的可信内网/VPN 显式 HTTP 与独立 Bearer，默认回环，保存网络设置后完整重启；不自动改防火墙，不公开桥接路由。

## 构建与交付规则

- 从仓库根目录执行包命令；快速构建见[开发指南](../../README.dev.zh-CN.md#executor-与浏览器插件构建)，首次头文件/资源/打包工具装配及离线验收见[交付指南](../../docs/architecture/executor-delivery.md)。本文件保留约束，不复制操作教程。
- 原生构建要求 Windows x64、MSVC/Windows SDK 和固定 Node 开发头文件。根 build/test 排除 Executor，使用 build:executor/test:executor 或聚焦命令。
- 首次联合构建按 shared → browser-extension → executor 顺序；兼容更新可独立构建对应应用，不要求另一端同步升版或重建。任何本次构建失败即停止，不以旧输出冒充成功；打包复用独立完成且校验通过的客户端和插件产物，插件双目标及依赖许可证随产品交付。
- Browser 身份只在构建期从插件 browser-identity.json 唯一解析，两个商店 ID 在所有模式下必填；客户端不读取根 .env 或身份环境变量，将同一精确来源集合编入 launcher、Host、Runtime 与注册脚本；运行时不读取 .env 或接受身份覆盖。生成模块随构建缓存恢复，不手工改生成文件。
- 客户端校验核对当前身份策略 fingerprint、协议版本和已完成构建的消费者摘要，不读取插件输出；策略不含插件 profile 或产品版本。打包另核对所附插件各渠道身份、协议、产物模式和 manifest 版本；不要求两端完整身份指纹相同。未知身份、不兼容协议或产物记录失配即失败。正式签名若改变消费者字节，在受控签名步骤之后重新生成身份摘要，再生成最终 runtime-manifest。
- package:acceptance 只打包已有输出，不自动 build 或准备缺失资源；每次生成 release/<version>-unsigned-<UUID>/ 下的新 EXE、ZIP、清单和验收工具。保留既有产物，不把源码/文档更新当作旧包已更新。
- 产品展示版本与 package.json、src/contracts/product.ts 一致；应用 ID/数据目录/Host 不随展示名改变。
- 固定私有 Node/Python、搜索、原生组件、品牌和许可随包；普通 build/start 不下载资源，Node 只用 assemble:node。Shell 按 [ADR-0084](../../docs/adr/0084-executor-system-shell.md) 使用固定系统 Windows PowerShell 5.1，不内置 PortableGit、不通过 PATH 选择解释器。业务子命令可使用经过筛选的本机 PATH；Linux/macOS 仅显式 if-else、注释与未实现错误，不宣称已支持。
- Node 清单从验证归档生成并编译摘要，Computer 清单只供构建/打包；最终 runtime-manifest 在 PE/Fuse 修改后生成，不在运行时重建信任锚。
- 验收入口保持 unsigned 行为；prepare:acceptance-kit 只新增 UUID 工具目录，不改安装程序/ZIP 或覆盖报告。按[签名发布 SOP](RELEASE.md)维护正式流程，待接入配置与可执行命令分开，签名标记依据最终实际验证，不靠命名或环境变量冒充成功。
- dev:executor 用于开发，Main/Preload/Runtime 改动重启，Renderer 支持 HMR。
- 开发构建先检查 build/native 和 dist/native 是否可写；文件占用时由独立原生提示选择复用已有实例、关闭后重试或取消，不强杀进程、不覆盖已加载模块。复用不宣称新代码已经构建。编译诊断统一 UTF-8，流式解码并等待输出管道关闭。

## 验证规则

- 先 build，再按范围 lint/typecheck/test/integration/packaging；test 含 native。构建与加载原生 DLL 的测试串行，GUI 串行，完整预算和资源期限分别验证。
- 测试只用独立数据、拥有的窗口/Profile、唯一 Host 和扩展副本，不改正式注册/日常环境，不按进程名强杀。输入只进入专属窗口，Win32 前台未满足必须拒绝；可用既有夹具等待用户人工激活。
- 冻结/丢弃状态改变与拒绝时不附着网页调试器；普通激活、显式 CDP 解冻、刷新和人工操作分别报告，旧 tab/document/snapshot 不自动映射。
- 首次失败保留，按原条件复验，不放宽期限/跳过断言或用暖态成功消除未知根因。字节/许可、协议、真实硬件、最终发行分别验收。
- 干净机器需无系统 Node/Python/Git、断网安装首启及升级卸载证据；G1–G6 未完成不标记正式通过。独立电脑/跨电脑暂缓不提升门禁。
- 仅文档变更检查格式、索引、链接和决定一致性，不把全部运行/硬件验收作为文档编辑的前置条件。
