# Executor 构建、交付与离线验收

产品为 Dr.Octopus Executor 0.0.1，目标 Windows x64，当前只交付未签名验收安装程序和 ZIP。新构建已按用户决定启用 Computer 固定受管入口，独立电脑、跨电脑及正式发行验收尚未完成；现有旧安装包不会随源码更新。

Windows 命令执行使用系统 Windows PowerShell 5.1，不装配或分发 PortableGit；Linux/macOS 仅声明未实现分支。实现契约见仓库 docs/adr/0084-executor-system-shell.md，实际验收和新包身份以验证记录为准，既有旧包不更新。Node/Python 等其他私有资源不随该替换删除。

本文维护固定资源、构建准备、产物契约与离线验收，也作为独立 acceptance-kit 的 README 使用。其中开发构建仅针对源码环境；独立验收从“独立电脑携带与预检”开始。构建快速入口在仓库 README.dev.md / README.dev.zh-CN.md，完整架构与验证状态在 docs/architecture/executor.md 和 executor-validation.md 维护；用户日常操作以产品的 INSTALLATION.md 为准。

## 固定资源与可信来源

实际版本、URL、长度、摘要、依赖和补丁以 vendor、package.json、pnpm-lock.yaml 及最终清单为准，不用旧 ADR 的候选版本代替发行描述。

| 资源          | 当前固定基线与责任                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------- |
| Electron      | Main/Preload/Renderer/Utility 外壳，实际内嵌 Node 版本由最终清单记录                                |
| 私有 Node/npm | Node 24.20.0、npm 11.19.0，供 Bridge、PowerShell 与验收工具使用                                     |
| 系统 Shell    | Windows PowerShell 5.1 由目标 Windows 提供；清单声明系统需求，预检独立检查，不记录开发机 Shell 哈希 |
| 搜索          | ripgrep 15.2.0、fd 10.5.0 Windows x64 MSVC 包                                                       |
| Computer      | 固定私有 Python、官方未修改 Windows-MCP 0.8.8 wheel、完整依赖与私有解释器配置                       |
| 原生组件      | 文件提交、PowerShell/Computer Job supervisor、两个启动器、stdio 退出后备                            |
| 扩展          | Chrome/Edge 版本以插件 package.json 和构建记录为准，固定 PageController 构建变换、图标与许可证      |
| 品牌          | 本应用 assets/brand 的原始资源，不在构建或启动时读取 Web 项目                                       |

私有运行资源位于实际 resources/executor，UI 位于完整性校验的 ASAR；私有执行资源不从 ASAR、系统 PATH、用户环境或临时下载取得。系统 Shell 是明确例外：固定系统路径选择 Windows PowerShell，业务子命令可使用筛选后的本机 PATH。运行时不编译原生插件。私有 Python 使用固定配置，comtypes 包标记由原版库在构建期初始化并按固定摘要入清单，运行期类型包装器在内存生成，不修改第三方源码或在用户缓存中生成代码；发行依赖与许可闭包不能因当前未调用某后端而随意裁剪。

Computer 启动不做资源完整性预检；构建与打包仍核验资源。Node 从验证过的原始归档生成清单，将其摘要编译进 Runtime，启动验证完整资源目录、每次命令复查入口，不从已安装目录重建信任锚，也不保证整个目录在恶意同用户修改下原子不变。

## 开发构建

以下开发命令均从仓库根目录的 PowerShell 执行，每一步成功后再执行下一步。开发环境遵循根规范：Node 22.19+、pnpm 11+。Executor 原生构建需要 Windows x64、MSVC C++ Build Tools/Windows SDK 和固定 Node 24.20.0 headers/import library。

### 首次环境与资源准备

安装仓库锁定的依赖：

```powershell
pnpm install --frozen-lockfile
```

build:native 默认查找当前用户主目录下的 `AppData/Local/node-gyp/Cache/24.20.0`。默认缓存未准备时，使用现有脚本在一个不存在的新目录取得并校验固定开发头文件；示例目录只创建一次：

```powershell
$executorHeadersCache = Join-Path $PWD 'apps/executor/build/node-headers-cache'
$env:EXECUTOR_NODE_HEADERS = node ./apps/executor/scripts/resources/assemble-node-headers.mjs --cache-dir $executorHeadersCache
```

脚本输出的路径包含 include/node 与 x64/node.lib。后续 PowerShell 会话复用该缓存时，设置实际头文件目录即可，不重复下载或删除原缓存：

```powershell
$env:EXECUTOR_NODE_HEADERS = (Resolve-Path './apps/executor/build/node-headers-cache/node-v24.20.0').Path
```

Node 开发头文件用于编译；assemble:node 装配随产品交付的私有 Node/npm，两者分别准备。显式装配固定运行资源和打包工具：

```powershell
pnpm --filter @octopus/executor assemble:node
pnpm --filter @octopus/executor assemble:search
pnpm --filter @octopus/executor assemble:computer
pnpm --filter @octopus/executor assemble:packaging
```

装配命令才允许取得固定归档并验证摘要；不要为重跑命令而删除未知资源。普通 build/dev/start 不在线补齐。Node 只使用 assemble:node，不保留旧兼容别名。下载缓存、dist、build、release、扩展 .output/.wxt 都是生成材料，不进入源码。

### 工程脚本与平台边界

工程命令使用普通 Node 执行 .mjs，package.json 保持原有 build、dev、assemble:*、package:acceptance 与 prepare:acceptance-kit 名称，新增 assemble:node-headers。scripts/compile 管理开发与编译，scripts/resources 管理固定资源准备，scripts/package 管理打包及验收工具装配。scripts/lib 中的辅助模块也使用 JavaScript，不使用 tsx、ts-node 或 Node 的 TS 类型擦除功能。

脚本只承担工程编排。应用 Schema 与文件安全实现仍由应用源码拥有，经 esbuild 编译到 build/tooling/application-api.mjs 后才由 Node 读取。数据备份恢复实现位于 src/maintenance/data-backup.ts；Windows Host 注册与安装钩子位于 src/installation/windows；网络探针和清单核验入口位于 test/packaging。产品分发仍只携带编译后的 JS、固定资源和对应平台安装材料。

ZIP 解压与清单读取统一使用 scripts/lib/resources/archives.mjs，校验路径越界、大小、大小写冲突及已有目标；不再启动 PowerShell。Node 头文件准备也改为 .mjs。scripts/lib/platform.mjs 显式选择 Windows x64；macOS/Linux 当前只提供待适配错误。通用归档代码使用平台无关 API，不据此宣称 Executor 已支持其他系统。

开发测试仍可通过 tsx 检验 TypeScript 应用源码；该开发测试机制不属于生产或工程入口的执行依赖。test/engineering-scripts.test.mjs 可直接由 node --test 执行，并关闭 Node TS 支持验证工程依赖边界。

### 日常重新构建与打包

资源和工具已准备好后，重新构建两应用并生成当前验收包：

先按[身份构建流程](../../apps/browser-extension/RELEASE.md#33-配置身份并重新构建)选择根 .env/CI 的 sideload 或 store 配置；三个官方身份仅从 browser-identity.json 读取，所有模式都要求完整配置。客户端稳定身份策略与插件产物模式分开：变更允许身份须重建客户端；仅改变插件 profile 或兼容版本只重建插件。首次联合构建按下面顺序，后续兼容更新可复用另一端已完成且验证通过的输出。客户端自身校验不依赖插件输出；打包另核对双目标渠道身份、协议、manifest 版本与 key，以及客户端消费者摘要，拒绝未知身份、不兼容协议和记录失配。

```powershell
pnpm --filter @octopus/shared build
pnpm --filter @octopus/browser-extension build
pnpm --filter @octopus/executor build
pnpm --filter @octopus/executor package:acceptance
```

`pnpm` 执行项目命令，`--filter @octopus/executor` 选择 Executor 子项目，`package:acceptance` 是其 package.json 定义的验收打包脚本，对应 scripts/package/package.mjs。它只读取已有 dist 和两份插件 .output，不自动 build；构建失败时停止，不把旧产物当作当前源码继续打包。

根 pnpm build/test 排除 Windows 专用 Executor；使用 build:executor/test:executor 或聚焦命令。dev:executor 启动开发窗口，Main/Preload/Runtime 变化后重启，Renderer 支持 HMR。检查顺序：

```powershell
pnpm --filter @octopus/executor lint
pnpm --filter @octopus/executor typecheck
pnpm --filter @octopus/executor test
pnpm --filter @octopus/browser-extension lint
pnpm --filter @octopus/browser-extension typecheck
pnpm --filter @octopus/browser-extension test
```

测试依赖当前 build；build 与加载 dist/native 的原生/集成测试串行执行，避免 DLL 占用。GUI 测试也串行，使用专属数据、窗口和 Profile。完整长预算、资源启动期限、普通协议回归分别执行，保留首次失败；不放宽期限或跳过断言使结果变绿。

### 浏览器插件独立构建、ZIP 与安装

独立插件先构建 shared，再构建 browser-extension。build 执行 WXT 的 Chrome/Edge 构建和 scripts/licenses.mjs，两个完整目录均带图标与依赖许可证；当前没有独立 ZIP/CRX package 脚本。

ZIP 命令与根目录、许可证、摘要检查统一在仓库 apps/browser-extension/RELEASE.md 第 4 节维护。成功产物归档到 .output 外的新版本/UUID 目录，不覆盖旧归档，不随下次构建被清理。商店分发尚未发布。

Executor 验收包已内置两份扩展，用户加载、连接、暂停/恢复和网站权限按随包的 INSTALLATION.md 操作。插件构建不启动 Executor、配置 Host、启用桥接或创建授权。

## 源码环境的真实跨机文件验收

本节只针对带仓库依赖和已完成 Executor 构建的开发电脑，不是 acceptance-kit 的离线命令。被测远端只需运行 Executor，不安装探针或 Agent 桥接程序。普通 MCP SDK 负责元数据，本机已有系统 curl 负责完整文件流。

在远端手动准备文件写入授权（含读取）、内网/VPN HTTP 配置和一个已存在的独立目录。将配置通过可信方式保存到开发电脑的 Git 忽略目录，不能把 Bearer、配置正文或文件正文粘贴到报告。探针只接受一个明确的私有网络目标，拒绝本机网络接口，并核对预期地址和设备名称；任务仅申请 files.write。

从仓库根目录执行，替换示例目标与配置文件路径。输出目录必须为新的原生私有目录，以 octopus-executor- 开头；每次生成 UUID，失败输出不覆盖：

```powershell
$taskAcceptanceOutput = 'apps/executor/build/transfer-verification/octopus-executor-cross-machine-' + [guid]::NewGuid().ToString('N')
node apps/executor/test/packaging/cross-machine-transfer.mjs --config 'apps/executor/build/transfer-verification/remote-transfer.private.json' --remote-directory 'D:\下载\Executor-跨机验收-20261016' --output-directory $taskAcceptanceOutput --expected-host 192.168.0.11 --expected-device-name LAPTOP-LH
```

探针验证零字节、约 8 MiB 和 64 MiB 二进制往返及本机落盘摘要，覆盖中文/空格路径、临时凭据边界、原键查询和真实在途上传取消。私有 curl 配置在子进程收束后删除，报告不含凭据；任务与 MCP 会话收束独立记录。输出文件及远端已发布测试文件保留供复核，后续清理由使用者确认，不自动删除其他文件、撤销既有授权或重放未知发布。该范围不代替跨机 2 GiB、其他操作系统、满盘/掉电或发行门禁。

## 验收包与清单

package:acceptance 生成 `apps/executor/release/<version>-unsigned-<UUID>/`，每次使用新目录，包含：

- `Dr.Octopus-Executor-<version>-win-x64-unsigned.exe`：当前用户安装程序，无需管理员权限；安装说明、私有资源和两份扩展随包。
- `Dr.Octopus-Executor-<version>-win-x64-unsigned.zip`：完整解压版，保留全部文件后运行 Dr.Octopus Executor.exe。
- `acceptance-artifacts.json`、win-unpacked/runtime-manifest.json：包身份、文件摘要与可用能力清单。
- `acceptance-kit-<UUID>/`：独立验收工具及文档，打包时自动生成。

安装、卸载、数据保留和浏览器目录加载按 apps/executor/INSTALLATION.md 操作。首次装配打包工具后，使用上面的日常命令构建并打包。只有需要为已有产物再生成一份独立验收工具时，单独执行：

```powershell
pnpm --filter @octopus/executor prepare:acceptance-kit 'D:/ExecutorAcceptance/selected-artifact'
```

此命令只为所选已有产物创建新的 acceptance-kit-UUID，不修改安装程序/ZIP、不覆盖旧工具和报告。Windows CI 配置为 .github/workflows/executor-windows.yml；配置存在或本机检查通过不等于已取得远程 CI 证据。

### GitHub Actions 未签名交付

`.github/workflows/executor-windows.yml` 的名称为 **Executor Windows unsigned delivery**，只交付 Windows x64 未签名验收包。提交并推送本次所需源码、vendor 固定配置、许可证及工作流后，相关路径的 PR 会触发检查；手动运行需工作流先进入默认分支，再在仓库 Actions 中选择该工作流、点击 Run workflow 并选择目标分支。PR 和不填写 release_tag 的手动运行只生成 Actions 附件，构建任务保持 contents:read。发布已有 GitHub Release 时，release:published 自动触发同一工作流并检出该 Tag；验收通过后，由独立的 publish-release 任务以 contents:write 将当前运行的已验证资源附加到该 Release。流水线使用 GitHub 内置令牌，不新增个人发布令牌或应用 Bearer，也不创建 Release。

执行顺序为：冻结依赖并显式准备 Electron/esbuild → 先构建 shared 的公开导出 → 准备固定头文件、Node、搜索、Computer 和打包工具 → 按扩展、Executor 顺序构建并检查 → 在本次运行独有目录生成 EXE/ZIP → 使用随包工具核验最终产品树与实际 ZIP 解压目录 → 从该 ZIP 运行六项有限包级回归 → 组装并复核交付物 → 上传。各步骤失败即停止后续交付，不选择本机已有 release 中的“最新包”，不自动重放构建或放宽期限。

有限包级回归包括备份恢复工具、双浏览器插件字节、完整清单、私有 Node 核验器、PE/Fuse/ASAR，以及原版 Computer 后端握手和确认退出后安装树不变。CI 明确禁用真实安装/注册用例，不执行 GUI 输入、锁屏/UAC 或硬件验收；用例筛选须实际通过六项，空选择或意外扩选都不能记为通过。

工作流成功后，从运行页面的 Artifacts 或 Summary 下载 `executor-windows-x64-unsigned-<run_id>-<run_attempt>`。GitHub 下载的外层归档解开后包含：

- 未签名 EXE、完整产品 ZIP、acceptance-artifacts.json 和 acceptance-kit-UUID。
- BUILD-INFO.json：版本、productBuildId、源提交、触发事件、运行链接、构建环境及实际检查范围。
- SHA256SUMS.txt：交付目录内所有其他文件的 SHA-256，供下载后核对；不认证发布者。
- verification/：最终产品树、ZIP 及暂存交付物的核验报告，保留 G4/G5/G6 pending。

交付物保留 14 天；独立的 `executor-windows-diagnostics-<run_id>-<run_attempt>` 保留 7 天，成功或失败均尝试上传构建/测试日志及已有报告。过期后需重新运行生成新产物，不把 Actions 附件当作永久发布源。完整 win-unpacked、资源下载缓存和本机测试私有配置不作为附件上传；产品 ZIP 内保留完整资源和隐藏配置文件。

Summary 展示上传结果、下载链接、源提交、版本、productBuildId 和 EXE/ZIP 摘要。它只说明本次 Actions 的自动检查结果；正式签名、独立电脑、真实硬件和安装卸载仍按后文门禁及 RELEASE.md 验证。首次远端执行或重跑的实际结果记入 executor-validation.md，不以本地脚本演练代替 GitHub runner 证据。

### GitHub Release Assets 与 Web 下载地址

正常发版沿用仓库根 pnpm release:publish：先成功发布 npm，再用个人发布身份创建对应 Tag 的 GitHub Release。Release 发布事件同时触发 Docker 与 Executor 流水线。新 Tag 必须包含本工作流及其工程脚本；不将当前 main 的产物附加到旧源码 Tag。仓库 Release 版本与 Executor 产品版本独立，例如 v0.0.13 可以分发 Executor 0.0.1。

发布任务只下载 acceptance 任务输出的单一 artifact-id，先验证完整 SHA256SUMS 清单、原始文件、产品身份、六项验收结论及实际检出提交，再查询目标 Release 的当前 Tag 提交；全部一致才允许上传。只给该任务 contents:write，PR 不运行发布任务。首次上传失败不自动重放；修复后使用原运行的 Re-run failed jobs，复用已验收的相同附件。与既有资产名称、大小和 SHA-256 一致时保留；冲突或未知摘要时失败，不使用 clobber 删除或替换已发布文件。

Release Assets 包含 Dr.Octopus-Executor-<executor-version>-win-x64-unsigned.exe、同名 ZIP，以及同前缀的 -BUILD-INFO.json、-acceptance-artifacts.json、-SHA256SUMS.txt。Release 专用摘要覆盖这四个实际公开文件；Actions 附件仍保留完整验收工具、报告及原始交付摘要。文件名中的 unsigned 和元数据 signed=false 保留，附加资产不意味着 Windows 签名发行或 G4/G5/G6 已通过。

需要补跑已发布的新版本时，在 Executor 工作流的 Run workflow 中填写 release_tag（例如 v0.0.13）。该输入会检出精确 Tag，并在验收后尝试上传到已有非草稿 Release；留空则只交付 Actions 附件。重建产物若与已上传字节不同会拒绝覆盖；应优先重跑原失败发布任务，需要更改源码时发布新版本。

Web 的 Vite 构建从 release.config.json 读取 Release Tag，从 apps/executor/package.json 读取独立产品版本，默认生成 https://github.com/nebulaedata/dr-octopus/releases/download/v<release-version>/Dr.Octopus-Executor-<executor-version>-win-x64-unsigned.exe 及 .zip。Turbo 构建缓存显式追踪这两份清单和 VITE_EXECUTOR_*，防止升版复用旧链接。可以通过 apps/web/.env.example 中的公开构建变量覆盖镜像地址；变量不设置时使用自动默认值，显式空字符串禁用对应格式。下载入口仍保留未签名验收说明。

runtime-manifest.json 在 builder 完成 PE/Fuse 修改后生成，覆盖最终 ZIP 树、实际组件版本、入口、Schema 投影及许可；acceptance-artifacts.json 锚定其摘要和 productBuildId。生产 JS、原生组件、私有资源与两份扩展必须属于同一产物，旧包不会随源码更新。

Fuse 限制 Node loader/inspector 注入并要求 ASAR 完整性。摘要证明字节一致，不认证发布者；未签名状态不能用本地 hash 掩盖。完整目录核验也不是原子安装锁，JSON Schema 投影不替代 Zod refinement、实际授权或 tools/list。

## 独立电脑携带与预检

携带同一产物的 unsigned.exe、完整 ZIP、acceptance-artifacts.json 和新验收工具目录。记录 OS、浏览器、运行权限、网络拓扑和产物身份。先把 ZIP 完整解压为 application，不向其中写报告或混入旧文件。

以下示例在材料根目录执行，将 kit 和路径替换为实际值；报告必须不存在。只对当前子进程使用 PowerShell 执行策略参数，不修改机器策略；策略仍拒绝时保留原错误。

```powershell
$kit = './acceptance-kit-实际标识'
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$kit/offline-preflight.ps1" -ArtifactDirectory . -ProductDirectory ./application -ReportPath ./offline-preflight.json
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$kit/verify-runtime-manifest.ps1" -ProductDirectory ./application -ReportPath ./runtime-inventory.json
```

预检只核对有限文件、摘要和环境，不启动应用、不改注册、不读凭据，不代替全部文件或功能检查。完整核验使用产品私有 Node，验证工具和 Node 摘要、全部文件/元数据、遗漏/新增/变化及可识别的链接/根别名，有三分钟期限。

完整核验针对独立 ZIP 解压目录或 win-unpacked；NSIS 生成的卸载程序不属于 ZIP 清单，不能拿安装目录的额外文件当作 ZIP 失败。不要为旧包现场生成清单并宣称它已携带。预检和核验报告的 G4/G5/G6 保持 pending。

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

## 手动升级与数据恢复

首版无自动更新服务。先从托盘完整退出当前应用及其适配器，保留旧包与同用户完整数据备份，再安装新版。安装器无法确认进程已停时拒绝继续，不强杀。覆盖失败可能改变部分文件，不声称事务回滚。

备份/恢复输出必须不存在、名称以 .octopus-executor-recovery- 开头；以下均为明确选定的绝对路径，同一 Windows 用户执行：

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$kit/data-backup.ps1" -Mode backup -ProductDirectory C:/ExecutorAcceptance/application -DataDirectory 'C:/ExecutorAcceptance/data/project' -SourceDirectory 'C:/ExecutorAcceptance/data/project' -OutputDirectory C:/ExecutorAcceptance/.octopus-executor-recovery-before-upgrade
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$kit/data-backup.ps1" -Mode restore -ProductDirectory C:/ExecutorAcceptance/application -DataDirectory 'C:/ExecutorAcceptance/data/project' -SourceDirectory C:/ExecutorAcceptance/.octopus-executor-recovery-before-upgrade -OutputDirectory C:/ExecutorAcceptance/.octopus-executor-recovery-restored
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$kit/diagnose-browser-host.ps1" -ProductDirectory C:/ExecutorAcceptance/application -ReportPath C:/ExecutorAcceptance/host-after-upgrade.json
```

工具复制私有停止态数据、核对字节、保留空目录并拒绝重解析路径；不包含设备文件、数据目录外的配置或安装包，不提供实时快照或跨用户凭据迁移。失败保留原件与部分输出，不自动清除或重试。恢复写入新目录，人工核对后按 INSTALLATION.md 处理，不能为了启动成功删除未知记录。

Host 诊断只读注册，不启动服务、不修改注册。新版可迁移已识别的本产品注册，未知/丢失 manifest 拒绝；旧版卸载不删除新目录的注册。注册路径存在仍不证明真实握手。移动安装目录后重新复制 stdio 配置，授权身份保持。

## 跨电脑网络专项

此项需要网络，和断网首启分开记录。在 Executor 设置中显式启用本机可信内网/VPN IPv4，完整重启；不自动改防火墙。另机客户端使用独立授权和私有配置，网络仅有 /mcp，Host/stdio 继续回环。

探针使用所选产品私有 Node，检查摘要后执行有限只读 MCP 调用，不启动 Runtime。只授予 files.read，在运行 Executor 的电脑准备专用 UTF-8 文本和 SHA-256，再安全传递配置。

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$kit/network-probe.ps1" -ProductDirectory C:/ExecutorAcceptance/application -ConfigPath C:/ExecutorAcceptance/private-network.json -ReportPath C:/ExecutorAcceptance/remote-read.json -FixturePath C:/ExecutorAcceptance/workspace/network-evidence.txt -ExpectedSha256 '实际SHA256'
```

保存两台电脑、客户端版本、拓扑、防火墙、请求结果和撤销/退出后的拒绝。targetIsLocalInterface=true 只能说明访问了探测机自身；false 也不自动证明 VPN/跨电脑条件。探针成功不替代真实智能体、Browser、长调用及完整退出测试。完成后明确撤销授权并处理配置副本。

Shell 离线专项另授权 shell.execute，携带本地 npm tar 包，核对 node/npm/npx 版本、offline install 生命周期、本地 CLI、实际 execPath 及未继承用户配置。在中文/空格安装目录复验。

## 发布门禁

| 门禁        | 必须有的真实证据                                              |
| ----------- | ------------------------------------------------------------- |
| G1 固定构建 | 依赖/原生 ABI、版本/摘要、上游与初始化产物、许可闭包          |
| G2 协议兼容 | 明确客户端版本/配置、三段 MCP、长预算与取消/结果恢复          |
| G3 文件恢复 | 真实 NTFS、占用/竞争、备份、崩溃和取消                        |
| G4 Browser  | 正式构建扩展、Native、补注入、分页、导航/生命周期、目标环境   |
| G5 Computer | 真实普通权限窗口、Unicode/剪贴板边界、多 DPI/GPU、输入中断    |
| G6 离线发行 | 独立停止/Job、干净 Windows 断网首启、安装卸载、升级恢复与许可 |

包级 GUI 测试只在独立副本替换 Host 注册步骤，不迁移日常浏览器注册；原样产品启动可能自动配置 Host，与安装卸载一样只在专用验收机显式启用。测试筛选不能替代副本隔离和入口保护。

本机回归、独立 ZIP 核验与人工有限用例分别记录，不合并为整体验收通过。商店/企业策略、签名、独立电脑、跨电脑及 Computer 真实硬件专项仍待完成；不能因整理文档提升门禁。
