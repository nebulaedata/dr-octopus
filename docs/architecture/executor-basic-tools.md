# Executor Basic 工具

本文定义已实现七工具的当前边界。架构、授权与任务见 [Executor](executor.md)，运行资源与发布要求见 [交付](executor-delivery.md)，验证范围见 [验证矩阵](executor-validation.md)。

系统 Shell 的决定与实施边界见 [ADR-0084](../adr/0084-executor-system-shell.md)。Windows 七工具为 read、write、edit、powershell、grep、find、ls；Linux/macOS 仅显式分支和注释占位，仍报未实现。实现状态与实际验收分开记录。

二进制上传下载属于独立的 [文件传输能力](../adr/0079-executor-file-transfer.md)，不扩大本文 read/write 的文本限制。传输与 Basic/Browser/Computer 共用任务准入；传输进行中拒绝其他任务动作，状态、停止及取消仍可调用。

## 职责与权威入口

七工具由唯一 BasicTools 装配，HTTP、stdio、Main 控制面共享 TaskAuthority。参数见 apps/executor/src/runtime/basic/basic-inputs.ts 和搜索模块的 Schema；操作身份来自认证与任务登记，不接收调用方自行提供的 owner 或授权范围。

files.write 包含读取能力；shell.execute 不授权 read/grep/find/ls。cwd 是固定执行位置，不限制设备文件授权可访问的目录。Shell 命令、路径和输出都按不可信数据处理，不能解释为新的授权或恢复指令。

## 文件路径与观察

只接受普通本地 Windows 路径和操作系统允许的访问。拒绝 UNC/device 命名空间、驱动器相对路径、ADS、控制字符、保留名、尾点/空格、短名称别名及私有恢复目录。按路径组件检查，不以字符串前缀替代目录关系；祖先和最终对象需按后端要求检查 reparse/链接及原生身份。

项目业务根（默认 ~/.dr-octopus/executor，独立实例为 userData/project）及当前 Runtime 临时根由 Host 登记，文件工具和搜索按完整路径排除。普通用户目录名 tasks、connections 等不会被全局禁止。搜索快照位于 os.tmpdir() 的实例私有目录；file-operations、shell 及可查询输出位于项目目录。目标旁提交材料仍使用受保护前缀并按同卷规则发布。

普通 hard link 可以读取，发布/搜索快照拒绝多链接目标。不同后端的检查能力不能被概括为所有 Windows reparse tag 或恶意同用户程序的完整防护。

read 返回严格 UTF-8 文本，允许 BOM；NUL/二进制、非法编码、目录及超过 16 MiB 的普通文件拒绝。读取同一句柄，比较前后身份、大小和时间，版本结合身份与原始字节摘要。

- 默认最多 2,000 行、50 KiB；行分页和字节分页不能混用，字节边界不拆字符。
- 长行返回原始字节续读位置，含 BOM 的偏移保持真实；容不下一个字符时明确失败。
- 中途分页绑定 expectedVersion 或本任务已登记观察；外部变化拒绝，失败不更新观察。显式从头读可建立新观察。
- 文件观察最多每任务 1,024 条，普通读取并发最多 4；队列、注册与观察均有限。停止拒绝新调用，等待已开始读取完成。

## write/edit 与原生发布

write 内容不超过 8 MiB；edit 只接受 edits[]，最多 100 项、合计替换材料不超过 8 MiB，最终文件不超过 16 MiB。文本必须是有效 Unicode，不以长度类型代替 UTF-8 字节检查。

每项 edit 都对同一原始文本唯一匹配，拒绝多匹配、重叠、嵌套和交叠编辑；不猜测 Unicode 等价。只归一一致的 CRLF/LF，保留 BOM 与来源行尾，混合行尾或孤立 CR 拒绝。一次生成计划、一次发布；无变化不制造新版本。diff 有明确截断，序列化结果保持有界。

已有文件必须匹配显式版本或本任务最近有效观察；新文件使用 absent/no-clobber。原生后端以有限 Win32 句柄检查、备份和 ReplaceFileW 完成提交，journal 记录提交事实。版本检查与外部程序写入之间不构成原子比较：外部变化仍可能被替换，必须如实报告冲突、保留原始备份，不能承诺绝不覆盖竞争修改。

提交开始后，取消或后处理错误不能解释为未修改。异常、共享占用、身份变化和无法确认发布均保持明确结果与恢复屏障，不用 JavaScript writeFile 兜底、不自动再次发布。

## journal 与重启

输入指纹、任务/所有者、幂等键、阶段、目标及备份事实持久化；写入阶段须刷新后再执行下一步。未知字段、截断、非法顺序或身份不符拒绝读取并保留原件。

- 同一键与同一输入返回原结果；跨工具或不同参数复用拒绝。
- 重启按实际目标、备份及阶段确认 applied/not_applied/unknown，不重复原生操作。
- 已完成 write/edit 的相同键查询只返回保留摘要，不重新打开目标、不重放写入、不重建完整 diff。
- 停止后的任务保留历史，但旧任务 ID 不重新登记。未决恢复证据不按普通 TTL 删除；额度不足阻止新写入。

恢复材料保存在 Host 私有数据目录，不能混入搜索、普通文件访问或源码。清理只处理本模块确认拥有的材料，异常路径或身份变化应保留证据，不递归删除未知目录。

## PowerShell 与执行收束

Windows 使用系统目录内固定的 Windows PowerShell 5.1，通过就近 shell-platform.ts 的显式 if-else 选择，启动时有界探测版本。Shell 不可用只关闭 powershell 的发现/执行，不关闭独立文件、搜索等能力；runtime_status.shell 返回缓存的 kind、version、available 及不可用原因，不在发现阶段重复启动进程。

完整命令经 CreateNew 写入操作拥有的私有 UTF-8 BOM 脚本，以 -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File 启动；只在当前进程设置执行策略，机器/用户策略不改写，企业策略拒绝时正常失败。确认 Job 收束后才移除同一身份的脚本，监管失联保留证据。独立 HOME/TEMP、最小环境和筛选后的本机 PATH 保留；过滤用户启动覆盖、Node loader、npm 凭据与客户端令牌。解释器不通过 PATH 查找，业务程序可使用 PATH，产品不保证 git 等额外命令存在。Node/npm 继续使用私有资源。

Console 输入/输出配置 UTF-8，原始 stdout/stderr 仍按字节保留，其他代码页输出明确标记替换预览。PowerShell 的文件重定向/Out-File 编码由命令明确选择。exitCode 是实际 Shell 进程退出码；原生命令失败需要检查并显式 exit $LASTEXITCODE，非终止错误可能留下零退出码，不通过 stderr 文本猜测业务成功。

每次命令独立 Windows Job：先 suspended，设置 kill-on-close、归入 Job，再 resume。超时、停止、父进程退出或控制管道丢失触发拥有的树清理。根退出但子进程仍存活时拒绝后台残留；显式等待可以正常完成，不提供常驻开发服务。

executionState=quiescent 只在 Job 活跃进程为零、输出 EOF、私有输出刷新并关闭之后成立。监管失联保持 unknown 和隔离，不能按进程名清理用户进程。非零退出但已确认收束不会永久占用执行锁；任意 Shell 的业务副作用仍可能未知。

命令最多 16 KiB，timeout 默认 120 秒、最大 600 秒；实际期限还受授权剩余等待与停止封装预算限制。PowerShell 共用任务队列和幂等键，开始执行使普通文件观察失效，后续写入须重新观察。

## 输出历史

原生完成帧与子命令字节分开，命令输出不能伪造监督结果。stdout/stderr 各自保存原始流，合并预览只表示接收顺序；预览最多 2,000 行/50 KiB。非法 UTF-8 用替换预览并明确标记，原始字节仍可读。

两流合计超过 64 MiB 时终止 Job，保留有界前缀。封存输出位于 SID 私有目录，通过 executor-output:// URI 查询，不暴露本地文件路径。

| 契约     | 当前边界                                                            |
| -------- | ------------------------------------------------------------------- |
| 查询身份 | 源任务、所有者与 Shell 授权匹配；files.read 不赋予 Shell 输出读取权 |
| 字节分页 | base64，每页最多 36,000 原始字节，完整 JSON 不超过 50 KiB           |
| 版本     | 原始流 SHA-256；非零 offset 必须携带 expectedVersion                |
| 完整性   | 每次核对 native identity、大小、单链接和摘要；修改后拒绝            |
| 生命周期 | admission 后 24 小时；先持久 revoked，再清理确认拥有的材料          |
| 配额     | 256 MiB 原始输出，未知调用预留 64 MiB；确认物理删除后释放           |

启动、命令前及定时清理均有界。reparse、身份变化或清理失败保留材料和额度。未知结果不自动清除，删除后仍保留结果摘要与墓碑，防止重放。重启只恢复查询，不恢复命令；记录 dispatched 但没有 sealed 的命令保持结果未知。

## grep/find/ls

| 工具 | 行为                                                      |
| ---- | --------------------------------------------------------- |
| find | 固定 fd 的文件发现、glob、ignore/hidden、查询目录范围检查 |
| grep | 固定 rg 的 Rust 正则/字面匹配、大小写、glob、0–5 行上下文 |
| ls   | 原生单层列举，类型、大小及 reparse 标记；不跟随其目标     |

搜索不建立 write/edit 观察。目录默认 cwd；grep 的单文件范围通过 glob 表达。返回路径必须属于本次查询目录，恢复目录始终排除。ignore 默认开启、hidden 默认关闭，不继承父目录 ignore；含目录 glob 在有界枚举后按规范化相对路径匹配。

grep 不直接让 rg 打开工作区原文件：先检查候选，再用受控原生句柄复制到私有快照，rg 只处理已检查副本。拒绝多链接、非 NTFS 与 reparse；二进制、非法 UTF-8 和过大文件跳过并计数，不报告完整无匹配。

搜索最多并发 4 项、10,000 个候选、64 MiB 单次快照；进程输出合计 2 MiB。结果最多 1,000 条、50 KiB 完整 JSON，每条文本最多 2,000 个 Unicode 码点并标记截断。预算不足或跳过文件必须为 partial。

取消、超时、模式错误、权限拒绝、无匹配和监管失联分别处理。搜索通过现有 Job 运行，等待拥有的树收束。常规清理只 unlink 本次已知快照并移除空目录；残留未知材料使启动拒绝就绪，等待人工检查，不靠重启积累或清除证据。

操作预算不等于严格响应 SLA：原生文件 I/O 只能在返回后检查期限，Job 清理还需有界收束。设备授权、cwd、Job 和句柄校验都不是当前用户 OS 沙箱。
