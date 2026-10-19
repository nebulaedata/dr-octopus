# Dr.Octopus Executor 0.0.1 安装与连接

当前为 Windows x64 **未签名验收版本**，尚未完成干净机器、跨电脑和正式发行验收。Basic/Browser 已接通，新构建启用桌面控制工具，后端就绪后需显式创建桌面控制授权（截图和 UIA 同样需要）。具体包身份与检查范围以同级 acceptance-artifacts.json 为准，旧包不会随源码更新。

## 安装、ZIP 与数据

安装版文件名以 `-setup-unsigned.exe` 结尾；免安装版以 `-unpacked-unsigned.zip` 结尾。

安装程序无需管理员权限，安装到当前用户目录，创建快捷方式并配置 Chrome/Edge 连接组件；不下载运行环境、不启用桥接、不创建授权。ZIP 必须完整解压到稳定的可写目录，运行 Dr.Octopus Executor.exe；解压版不创建快捷方式。

Runtime 启动成功后，客户端自动维护当前资源/数据目录的 Host 注册，可迁移已识别的本产品旧注册；未知、丢失 manifest 或不可写目录会报错。旧版卸载只删除仍指向自身的注册，不影响新安装。注册成功不表示 Worker 已握手；此维护不迁移授权数据或更新已加载扩展。

正式业务数据保存于用户主目录 `.dr-octopus/executor`：settings.json 为设置，device 为设备身份，connections 为加密凭据和客户端配置，tasks 为授权及任务历史，browser 为桥接记录，file-operations、shell、transfers、settings-recovery 为操作记录和恢复材料。AppData 只保留 Electron 缓存；可丢弃搜索材料使用系统临时目录。用于原子提交的暂存仍放在目标同卷目录。卸载保留正式业务数据，销毁凭据需明确撤销授权。移动 ZIP 或变更连接配置位置后需重新复制 stdio 配置。

首次升级会校验并导入已有设置和传输记录，保留原件；正式文件已经存在时不覆盖、不回退旧记录。损坏或无法确认的恢复材料会阻止启动。使用显式 `--user-data-dir` 的独立实例将正式设置和传输记录放在所选目录的 `project` 子目录，不共用主目录设置。

设置页的“文件传输”提供上传单文件上限、下载单文件上限、本机临时存储总额度及最低剩余磁盘空间，单位均为 MiB。默认分别为 2048、2048、8192、512；单文件最大仍为 2 GiB，总额度不能低于任一方向的单文件上限。设置只管理执行体磁盘，智能体客户端保持独立额度。保存后完整重启生效，不影响在途传输。

## 窗口与设置

界面分状态、连接、设置三页。关闭默认留在系统托盘，可选任务栏或关闭窗口和服务，已保存偏好保留。隐藏/重建界面保持同一 Runtime、连接与任务；完整退出使用托盘“退出执行器”或明确的完整退出行为。

端口和网络设置保存后，完整退出再打开才生效，关闭到后台不应用监听。地址不可用或端口冲突时明确失败，不自动换端口或静默降级。

## 停止桌面控制

彩屏显示 Computer Use 进行中或状态未知时，可在这台被操作的电脑上按无修饰键的 **Esc**，也可点击系统托盘中的“停止桌面控制 (Esc)”。它会取消当前桌面任务、关闭桌面后台，确认收束后移除彩屏；智能体发送的 Escape 不触发紧急停止。

停止后由智能体明确结束旧任务，再显式创建新的桌面任务可重新启用；清理未确认时仍拒绝重新启用。停止不会撤销之前已完成的操作，结果未知的记录仍会保留。若后台退出未确认或 Esc 无响应，请使用托盘“退出执行器”。通过远程桌面操作时需让按键送达目标电脑；不同 RDP 客户端的转发行为需单独验证。

## 授权与客户端配置

1. 连接页“创建授权”，填写名称并勾选所需能力。
2. 该授权“配置客户端”，选择本机 HTTP、stdio 或已启用的内网/VPN HTTP。
3. 直接复制，或按需下载私有文件，添加到智能体 MCP 设置。
4. 核对真实协议会话和工具结果；需要时明确撤销该授权。

创建不强制导出，也不选择工作区。文件/PowerShell 按当前 Windows 用户权限执行；files.write 含读取，Shell 单独授权。cwd 是任务执行位置，不是文件沙箱，Browser/Computer 不依赖文件目录。

配置包含私有凭据，不上传截图、公开仓库或日志。界面预览只显示占位符，明确复制/下载才得到配置；已有私有文件不覆盖，地址/目录变化可为同一授权重新生成。

stdio 必须先打开 Executor，使用生成的固定启动器，不依赖系统 Node。长调用分别核对授权等待与客户端请求超时；Dr.Octopus Web 使用现有 MCP requestTimeoutMs 设置。当前 600 秒等待保留停止/封装时间，PowerShell 有效期限可为 590 秒。

## Windows 命令执行

Windows 提供 powershell 工具，使用系统 Windows PowerShell 5.1，不要求安装 Git、Bash 或 PowerShell 7。工具不加载用户 profile，每次调用独立执行；runtime_status.shell 提供实际版本和可用性。系统 Shell 不可用时，powershell 不进入工具发现，其他独立工具仍可使用。

command 使用 PowerShell 5.1 语法，不接受 Bash 语法或 PowerShell 7 专属语法。调用本机原生程序后检查 $LASTEXITCODE，需要传播失败时显式 exit $LASTEXITCODE；非终止错误可能不使进程退出码非零，exitCode=0 或 quiescent 均不证明业务成功。Console 配置为 UTF-8，重定向及 Out-File 等文件写入仍应明确指定编码。私有 Node/npm 继续随包，命令可显式使用 node、npm.cmd、npx.cmd；git 等其他程序仅在目标机器已安装且路径可用时存在。

旧 MCP 的 bash 工具已移除，客户端需重新发现工具并更新硬编码调用。shell.execute 授权和 HTTP/stdio 接入保持不变。应用未发布，不兼容旧 Shell journal；发生不兼容错误时保留原件，完整退出并备份后使用独立数据目录，不通过删除任务或恢复材料强行启动。Linux/macOS 尚未实现。

## 设备名称与多设备接入

设置页显示设备 ID 和当前生效名称。首次名称取系统计算机名，可修改为“办公电脑”等易辨认名称；保存后通过系统托盘完整退出，再重新打开执行器。最小化或关闭到托盘不会使新名称生效，客户端需重新连接或重新发现工具。

智能体可通过 `runtime_status` 读取设备名称和 ID，工具发现说明也包含同一身份。名称可重名，核对目标时以完整 ID 区分。身份标识当前用户数据实例，不是硬件认证或额外授权。

新配置使用 `octo` 加完整实例 ID 的稳定连接键，支持多台设备同时接入。改名不改变连接键或授权；旧 `octopus-executor` 配置仍可连接，重新复制时替换旧条目，避免同一设备重复接入。多个授权对应同一设备；需要同时接入时，可自行给外部连接设置不同别名。

另一台设备应独立初始化，不复制用户数据和凭据目录。普通重启、升级、同机安装路径移动和同机数据恢复保持 ID；全新数据目录生成新 ID。设备身份损坏或已初始化记录缺失时保留原件并拒绝启动，不自动重建身份。

## 应用已保存的待重启设置

有设置等待生效时，页面顶部显示 warning 提示，可点击“立即重启”完成整个执行器的重启。先保存或撤销未保存的更改；正在保存时按钮不可用。重启会停止当前执行服务、任务及客户端连接，随后使用已保存设置重新启动。客户端需重新连接或重新发现 MCP；连接地址改变时更新客户端配置。

## Chrome / Edge 本地安装

商店入口尚未发布，客户端显示“尚未上架”。

1. 连接页展开浏览器桥接“安装与连接说明”，选择本地安装及 Chrome/Edge，打开对应完整插件目录。
2. 扩展管理页开启开发者模式，加载已解压目录，保留文件夹，不混入旧产物。
3. 连接组件通常已自动配置；失败时点击“配置浏览器连接”，检查实际资源/数据目录，不删除授权或降低来源/权限检查。
4. “启用浏览器桥接”，必要时在弹窗恢复/重连，分别核对实例已连接与工具就绪。
5. 创建 browser 能力授权并复制客户端配置，网站访问权限另在插件详情确认。

更新后重新加载新目录，旧包不会自动更新。工具栏固定由用户管理：Chrome 图钉，Edge“在工具栏中显示”。暂停保存并停止自动重连，重开弹窗/Worker 不自动恢复；关闭弹窗不关闭后台。已派发动作可能继续、结果可能未知，不自动重放。

## 内网 / VPN

“配置客户端”显示目标设备名称、完整设备 ID 和稳定连接标识。设备改名不改变连接标识；名称重复时核对设备 ID，不通过名称猜测操作对象。可以点击“复制给智能体”，把当前连接方式的 MCP 配置、设备信息及配置验证步骤一起复制给可信智能体。配置和连接文档都可能包含授权凭据，页面预览仍使用占位符。

本机 stdio 使用执行器所在电脑的程序和私有配置路径；回环 HTTP 仅指向智能体自身环境。远程智能体应使用内网 / VPN HTTP。

只用于明确可信网络。设置中显式启用本机私有 IPv4，保存后完整重启，再选择网络 HTTP 配置。默认回环，不支持公网、DNS、通配或自动转发；防火墙由用户管理。

安全传递独立所需授权配置。Host/stdio 保持回环，网络不开放桥接路由。禁用网络重启只关闭监听，不撤销已有授权。

## 跨机文件传输

无需安装专用客户端。智能体必须具备读取自身机器或容器中的文件并发起 HTTP 上传、或把 HTTP 下载直接保存到文件的本地工具。没有相应能力不要调用文件传输工具，并向用户说明缺少的能力。执行器的 PowerShell 无法读取远端智能体的本地路径。

1. 先通过 runtime_status 核对设备并按工具 Schema 创建任务。上传要求 files.write，下载要求 files.read；无需执行器的 Shell 权限。
2. 上传调用 file_upload_prepare，提供 taskId、执行器绝对目标 path、准确 totalBytes、稳定 idempotencyKey，可选提供本地工具计算的 sha256。目标父目录必须已存在，目标文件不能已存在。
3. 下载调用 file_download_prepare，提供 taskId、执行器绝对源 path 和稳定 idempotencyKey。
4. 准备是异步的。按 pollAfterMs 调用 file_transfer_status，直到 ready 且包含 content，再使用 content.method、content.url 和 content.headers 传输。不要用空参数探测工具。

文件由智能体已有本地工具直接发送或保存，不进入模型上下文。下面是 Bash 命令示意：UPLOAD_URL / DOWNLOAD_URL 来自 content.url；TRANSFER_AUTHORIZATION 是 content.headers.Authorization 加上头名称后的完整值，例如 Authorization: Bearer 临时凭证。不要替换成长期设备凭据。

```bash
# Agent 本地文件 → Executor；Windows 本地工具可使用 curl.exe。
curl --fail --show-error --upload-file "/workspace/report.xlsx" \
  --header "$TRANSFER_AUTHORIZATION" "$UPLOAD_URL"

# Executor → Agent；选择尚不存在的本地临时目标。
curl --fail --show-error --output "/workspace/report.part" \
  --header "$TRANSFER_AUTHORIZATION" "$DOWNLOAD_URL"
```

上传前由本地工具取得准确字节数；一次发送完整文件，无需分块或完成调用。上传后查询 file_transfer_status，只有 completed 表示执行器目标已发布，才能把该路径用于后续操作。

下载先保存到新的临时文件，由本地工具核对 totalBytes 和 sha256 并安全发布。下载 completed 仅表示执行器完成发送，不证明智能体已落盘，也不等于给用户发送附件。不要将响应正文、完整文件或 Base64 返回模型。

临时凭证仅绑定本次传输，任务停止、撤销或到期后失效。需要取消时调用 file_transfer_cancel。中断或响应丢失先查原 transferId；未查清发布事实不要重放，unknown 保留检查。确认未发布后，重新准备使用新操作键；不支持续传。

## 独立数据与高级注册

未发布旧存储布局、旧工作区授权、旧文件传输工具和状态格式、旧参数及旧 stdio 格式不兼容。保留旧材料，完整退出旧程序后使用新数据目录，不自动迁移/重置：

```powershell
& './Dr.Octopus Executor.exe' --user-data-dir "$env:APPDATA/Octopus Executor Device-0.0.1"
```

Host 必须对应同一 project 业务目录。MSIX 启动可能有 AppData 视图，客户端/脚本按目录句柄解析实际路径，不为“找不到目录”删除来源、登录或 ACL 检查。

高级手动配置先启动该目录的程序，再从所选产品根执行：

```powershell
powershell.exe -NoProfile -NonInteractive -File './resources/executor/setup/register-browser-host.ps1' install './resources/executor' "$env:APPDATA/Octopus Executor Device-0.0.1/project" -MigrateProduct
```

替换为实际数据目录。只迁移已识别本产品，未知注册拒绝；开发 dist 的路径不同，以开发文档为准。

## 升级、恢复与验收

首版无自动更新。完整退出应用/适配器，保留旧包和停止态数据备份后安装。运行中或无法检查占用时拒绝升级，不强杀；失败可能留下部分新文件，不声称事务回滚。

若安装程序报告 Browser Host 注册失败，先保存弹窗中的退出码、错误摘要及 Diagnostic log 指向的日志。日志包含安装/数据路径和注册脚本输出，不包含授权 token；分享前可遮盖个人目录名。旧验收包没有这些诊断信息，需使用独立验收工具中的 diagnose-browser-host.ps1 检查注册。

注册仍指向已移动或删除的解压目录时，旧 native-host.json 可能已经不存在。此时无法确认完整来源身份，安装程序会拒绝自动覆盖。优先恢复旧目录；确认注册已经失效后，先导出备份，再显式移除 Chrome/Edge 中对应的单个 com.octopus.executor.browser 注册键，然后重试安装。不要删除整个 NativeMessagingHosts 分支、正式业务目录或其他产品注册，也不要用新内容伪造旧 manifest 来绕过身份检查。中文路径受支持，注册与诊断统一按 UTF-8 读取 JSON。

独立 acceptance-kit 提供预检、完整 ZIP 清单核验、同用户备份恢复、Host 只读诊断、跨电脑只读探针。输出为新目录/报告，失败保留原件和部分材料；备份不含设备文件、外部配置或安装包，不是实时快照或跨用户迁移。

默认实例停机后备份用户主目录 `.dr-octopus/executor`；独立 `--user-data-dir` 实例备份其 `project` 子目录。业务恢复不依赖 AppData 缓存和系统临时目录。目标卷上的未决文件提交/上传材料不一定在项目目录内，不能在备份后随意删除；备份工具不会把外部目标文件或暂存材料自动打包。

hash、资源存在或本机协议通过不等于签名、干净安装或硬件验收。桌面功能的启用不代表硬件验收通过；锁屏/UAC、混合 DPI、原生部分输入只在专用电脑验证，当前任务授权、握手及输入防护持续生效。
