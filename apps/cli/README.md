# Octopus CLI

`apps/cli` 可以启动终端 TUI Agent，也可以管理当前 OS 用户的唯一 Gateway（Web Agent 入口），并适配 Agent 已有的独立 Scheduler。生命周期见 [ADR-0042](../../docs/adr/0042-cli-managed-gateway-distribution.md)，发布方式见 [ADR-0046](../../docs/adr/0046-configured-npm-bootstrap.md)，Gateway 与 Server 的职责边界见 [ADR-0044](../../docs/adr/0044-cli-owned-gateway-server-lifecycle.md)。

## 版本发版

在仓库根目录执行 `pnpm release`，交互选择 patch、minor、major 或预发布版本；选择后自动更新根 `release.config.json` 的 `manifest.version`，创建 `chore(release): v<版本>` 提交、`v<版本>` annotated tag，并推送当前分支和 tag。

```powershell
pnpm release:dry patch           # 预览，不修改文件、不提交、不创建或推送 tag
pnpm release                    # 交互选择版本，其余步骤自动执行
pnpm release patch              # 直接发布下一个 patch 版本
pnpm release minor --preRelease=beta  # 例如 0.1.0 → 0.2.0-beta.0
```

版本操作由根 [.release-it.json](../../.release-it.json) 配置，要求已提交当前改动、当前分支有 upstream，且本机拥有远端 Git 推送权限。使用当前分支的 upstream；目前是 Gitee，迁移 GitHub 后更新 Git remote/upstream 即可。正式命令会推送代码，应先使用 `release:dry` 检查版本和目标远端。

开发包的 package.json 版本与 pnpm 锁文件不随发版更新。版本发版不构建产物、不执行 npm publish、不创建 GitHub/GitLab Release；本机无需 npm 或 GitHub API Token。未来由 tag 触发 GitHub Actions，校验 tag 与发布配置版本一致，再构建、发布 npm 和创建 GitHub Release。

`pnpm release:build` 仍仅负责本地构建交付包，两条命令用途不同。首次要给当前 `0.1.0` 创建 tag，可执行 `pnpm release --no-increment`；必须先提交该版本的源码与配置。遇到推送失败，先检查本地提交、tag 和远端状态；已存在的本地版本提交和 tag 可直接重试 Git push，不要为重试再次执行 patch 升版。

## 构建与安装

开发环境需要 Node 22.19+、pnpm 11+。开发根 package.json 保持 private，不注册 bin；npm 发布清单从独立的 [release.config.json](../../release.config.json) 全量生成。

```powershell
pnpm install
pnpm build
pnpm release:build
cd release
npm pack # 检查交付文件
npm publish
```

`pnpm release:build` 已包含构建步骤。发布脚本先组装临时目录，验证资源后替换输出；已有目录被 Gateway、Scheduler 或安装器占用时拒绝替换。不会在构建时安装运行依赖或发布到 registry。

发布构建直接继承终端的 stdout/stderr，保留构建工具自身的颜色判断；不强制添加颜色。用于解析包列表和状态的输出仍通过管道捕获。

默认产物如下，路径由配置决定：

```text
release/
  README.md             # 从根 README.md 复制的 npm 说明
  package.json          # npm 清单：bin、精确 files、固定版本 pnpm dependency
  bin/dr-octopus.mjs       # 已内联管理和安装代码的 CLI
  release-layout.json   # 构建自动生成的路径索引及归档校验和
  payload/runtime.tar.gz
```

npm 只安装普通外层包及其 pnpm 依赖。内部归档保留原 workspace 的 package.json、锁文件、workspace 配置、补丁和构建产物，npm 不解析其中的 workspace 引用。归档不包含 node_modules。

对外命令为 `dr-octopus`，与 Agent 的 `octopus` 区分；npm 包名为 `dr-octopus`。用户安装与启动：

```powershell
npm install -g dr-octopus
dr-octopus                  # 首次交互运行询问是否安装依赖，完成后显示帮助
dr-octopus gateway start    # 启动 Gateway / Web Agent，缺少依赖时同样询问
dr-octopus tui              # 在当前终端启动 TUI Agent
# 脚本或自动化环境：
dr-octopus gateway start --install-deps
# 或单独安装：
dr-octopus deps install
```

`--help`、`--version` 和 Gateway status/stop 不触发安装。首次安装须明确同意，默认拒绝；Ctrl+C 或 EOF 取消。非交互终端和 `--json` 模式不询问，缺少依赖时提示显式安装。`--install-deps` 也可放在命令前，仅在运行依赖检查失败时安装。Scheduler start/restart 使用相同规则；status/stop 需要已有 Agent SDK。

CLI 使用 npm 随包安装的固定版本 pnpm，通过当前 Node 执行其入口，不依赖全局 pnpm、PATH 或 Corepack。缺少或版本不符时给出重装 npm 包的提示。归档经 SHA-256 校验并拒绝链接/越界路径后，解压到 OS 用户主目录下配置的 runtimeDirectory；子目录按归档哈希、系统、架构和 Node ABI 隔离。默认位置为 `.dr-octopus/runtimes/<hash>-<platform>-<arch>-<abi>/`，不会向 npm 全局安装目录写入运行依赖。升级或 Node ABI 改变会使用独立目录，旧运行目录暂不自动清理。

`deps install` 持有独占安装锁，使用归档内原始锁文件执行 `pnpm --filter-prod '@octopus/cli...' install --prod --frozen-lockfile`，然后验证实际包解析与 SQLite、sharp、canvas、koffi 等原生模块。过滤器由配置维护。中断后可重试；已确认退出的安装进程遗留锁可恢复，活跃或无法确认的锁拒绝并发安装。运行中的同版本 Gateway/Scheduler 会阻止修改依赖。原生模块缺少预编译包时仍需要平台编译工具链。Pi 扩展继续由 Server 启动时处理。

### 非交互安装与镜像

`--yes`（`-y`）与 `--install-deps` 均可授权首次安装；`deps install` 自身即代表安装授权。`--registry <url>` 指定本次安装的默认 npm 源，单独使用不授予安装权限。两类参数支持根命令和相关安装/启动子命令，TUI 参数须放在 Agent 参数前，`--` 后仍原样透传。

```sh
dr-octopus --yes
dr-octopus deps install --yes --registry https://registry.npmmirror.com --json
dr-octopus gateway start --yes --registry https://registry.npmmirror.com
```

源优先级为 CLI 指定值、安装上下文中的 pnpm 有效配置、默认源；不修改全局配置、scoped registry 或冻结锁文件。不会检测地区、自动换源或额外编排重试。安装器对日志进行凭据脱敏，网络下载、认证和原生模块失败给出不同建议；无法可靠识别时保留诊断而不猜测原因。JSON 模式的安装日志写入 stderr，结构化结果写入 stdout。详细用户操作见根 [发布 README](../../README.zh-CN.md#非交互安装与镜像)。

## 清理旧运行目录

```powershell
dr-octopus runtimes list                 # 查看版本、逻辑大小（字节）、当前版本及占用状态
dr-octopus runtimes prune --dry-run      # 预览候选目录及预计回收字节数，不写文件
dr-octopus runtimes prune                # 删除未使用的旧运行目录
dr-octopus runtimes list --json          # 使用统一 service/action/result JSON 输出
```

开发与安装后的 CLI 共用清理逻辑，均操作本机配置的 runtime 目录，不触发依赖安装。开发时直接运行 `pnpm dev:cli runtimes prune`，可加 `--dry-run` 预览。清理保留当前 CLI 对应的发布 runtime（如果有），跳过正在使用、安装中或无法验证的目录。不要在清理过程中同时启动旧版本。

只有名称与 `.payload-sha256` 匹配且具有有效发布索引的直接子目录才可删除。未知目录、提取中间目录及符号链接/junction 会保留；`server`、`agent` 用户数据不在清理范围内。Knowledge 的永久锁文件保留在目录旁，不通过删除锁文件解除占用。

输出的 `sizeBytes` 和 `reclaimedBytes` 为普通文件的逻辑字节数，不跟随依赖链接；pnpm 硬链接可能共享磁盘块，所以实际释放空间可能更小。预览中的 `would-remove` 是候选状态，实际清理仍可能因占用变化或无法取得锁而跳过；实际结果中只有 `removed` 表示已删除。

## 独立发布配置

日常发布调整只编辑根 `release.config.json`，不要手改生成的 release-layout.json 或 release/package.json。npm 包说明在根 [README.md](../../README.md) 和 [README.zh-CN.md](../../README.zh-CN.md) 维护，由 `readme` 字段指定仓库相对路径，构建时原样复制为 `release/README.md`。

| 字段                         | 维护内容                                                      |
| ---------------------------- | ------------------------------------------------------------- |
| `readme`                     | npm 说明文件的仓库相对路径，发布为包根 `README.md`            |
| `manifest`                   | 对外包名、版本、描述、关键词、Node 要求；不继承开发清单       |
| `command`、`bootstrap`       | 命令名、入口所属包、包内产物路径和 npm 包内目标路径           |
| `outputDirectory`、`archive` | 发布输出目录与内部归档路径                                    |
| `buildArgs`                  | 传给开发 pnpm 的构建参数，默认走现有 Turbo 构建图             |
| `pnpmVersion`                | 随 npm 包安装的精确 pnpm 版本，必须与开发 packageManager 一致 |
| `installFilter`              | 运行安装根，默认 CLI 及其生产依赖图                           |
| `artifacts`                  | 按包名选择产物目录；`*` 为默认值，包级配置覆盖默认值          |
| `paths`                      | CLI、Server、Gateway 入口和 Web 资源的包名与包内相对位置      |
| `runtimeDirectory`           | OS 用户主目录下的运行环境存储位置                             |

源码包位置由 pnpm workspace 列举结果发现。只移动包目录且包名、包内构建约定不变时，无需修改发布脚本；改变产物位置时更新本配置及所属包构建配置。新增依赖仍在所属 package.json 声明，由 pnpm 和锁文件处理。依赖探针使用 Server/Agent 的公开包接口，业务接口变更仍需要对应适配，发布配置不能消除这类语义约束。

脚本校验配置、包身份、必需入口、补丁与路径边界，配置错误直接失败。测试使用独立 fixture 同时改变包目录、产物目录、CLI 入口和归档位置，验证组装与脱离仓库后的 CLI 行为。

## 为什么使用 tsdown

CLI 的 Commander、YAML、归档处理和轻量控制代码内联到一个入口，安装引导无需先安装完整服务依赖。Gateway 另行构建，通过 Node 子进程运行并加载 Server；Scheduler 通过子进程调用 Agent 公开接口。Server、Agent 与原生模块安装在内部 workspace。tsdown 只负责打包代码，npm 的 bin 负责注册命令；二者职责不同。目标机器始终需要 Node.js。

## TUI Agent

`dr-octopus tui` 调用 `@octopus/agent` 声明的 `octopus` bin 默认交互入口，复用 Agent 的 Workspace、配置、扩展与引导流程。Agent 没有 `tui` 子命令，因此不会把 `tui` 作为提示词传给它。进程继承当前工作目录、环境变量与终端输入输出，退出码传回 CLI。

```powershell
dr-octopus tui
dr-octopus tui --install-deps --workspace general
dr-octopus tui --workspace general --model <model-id>
dr-octopus tui --help        # CLI 启动帮助，无需安装依赖
dr-octopus tui -- --help     # Agent 自身帮助，需要运行依赖
pnpm dev:cli tui            # 开发环境先执行 pnpm build
```

TUI 启动沿用依赖检查和首次安装确认规则；`--install-deps` 应放在 Agent 参数前，也可放在 `tui` 前。其余参数透传给 Agent。TUI 直接使用终端，不输出 CLI 的 JSON 结果包装；`--json` 等透传参数的含义由 Agent 决定。

## 命令

```text
gateway run [--file-log | --no-file-log] [--inspect 127.0.0.1:9230]
gateway start [--file-log | --no-file-log] [--timeout 180000]
gateway restart [--file-log | --no-file-log]
gateway stop
gateway status --json
gateway health --json
scheduler start|stop|restart|status [--agent-dir <absolute-path>] [--json]
doctor --json
migrate --json
```

上述管理操作支持 `--json`，stdout 使用 `{service, action, ok, result|error}`，进度、子进程输出与告警进入 stderr。`migrate` 返回 `NOT_IMPLEMENTED` 和非零退出码。

进度按阶段变化输出完整文本行，不使用 spinner 或接管 stdin；前台 Ctrl+C 由 CLI/Gateway 的信号处理器关闭服务。生产环境连接交互终端时，Server 日志按时间、级别、消息和缩进字段排版，不添加颜色；生产输出重定向到文件或管道时保留 JSON，文件日志仍为 JSONL。开发环境继续使用彩色 pretty 日志。

Gateway 使用 OS 用户主目录下固定的 `.dr-octopus/server/state/gateway` 发现位置，以及进程持有的 OS 文件锁。端口、数据目录、安装目录、`HOME` 和 `USERPROFILE` 环境覆盖不会改变锁的范围。控制命令通过实例标识和随机 token 校验本地管道/socket，不能仅凭 PID 或 HTTP 成功响应认领实例。锁文件永久保留，进程退出由 OS 释放锁；不要删除正在使用的锁文件。

`gateway stop` 不停止 Scheduler。超时回收通过已认证的控制通道请求 Gateway 自身退出，不按 PID 杀死整棵进程树。后台启动输出保存在固定发现目录的 `launcher.log`，应用 JSONL 日志仍由 Server 负责轮转和清理。

文件日志开关优先级：显式参数、当前 `SERVER_FILE_LOG_ENABLED`、restart 前记录的生效值、默认 false。`status` 同时报告开关、实时日志健康状态和实际目录。健康检查只说明基础服务就绪，不代表所有扩展、模型凭据和模型调用均可用。

Server 默认绑定 `127.0.0.1:3000`；端口和数据目录沿用 `SERVER_PORT`、`SERVER_HOST`、`SERVER_DATA_DIR`、`DR_OCTOPUS_CODING_AGENT_DIR`。发布入口不读取源码仓库 `.env`。`SERVER_WEB_ROOT` 是可选的 Vite 客户端绝对目录，由发布 CLI 根据生成的路径索引自动设置。Server 使用 `@fastify/vite` 生产 SPA 模式，支持深链访问和刷新。保留 Web 包的 package.json 和构建生成的 dist/vite.config.json，插件按包目录解析相对路径；Server 在内存中兼容 Windows 构建的路径分隔符，不改写配置文件。

## 运行环境配置

Server / Agent / CLI 开发入口读取仓库根 `.env`；生产入口不读取或发布该文件。前端 `VITE_*` 独立放在 `apps/web/.env*`，在构建时写入 Web 资源，详见 [Web 配置](../web/README.md#环境变量)。Server 配置保存在 `<SERVER_DATA_DIR>/environment.json`，Agent 配置保存在 `<DR_OCTOPUS_CODING_AGENT_DIR>/environment.json`，默认分别为 `~/.dr-octopus/server/environment.json` 和 `~/.dr-octopus/agent/environment.json`。两者独立于 npm 安装目录和版本化 runtime。

可以在 Settings → 环境变量中编辑，也可以在服务停止时修改 JSON。值使用字符串，例如 `{"SERVER_PORT":"3001","SERVER_FILE_LOG_ENABLED":"true"}`。优先级为显式命令参数、进程环境（开发时包含 `.env`）、对应 JSON、代码默认值。启动目录仍通过环境变量或已有 CLI 参数指定，不在 JSON 内配置。

Server 修改后执行 `dr-octopus gateway restart`；已有 Agent / Scheduler 需要重启，新启动的 Agent 读取新配置。`doctor` 与 Gateway 启动预检同样读取 Server JSON。SDK 契约及并发写入处理见 [env-loader](../../packages/env-loader/README.md)。

## 开发与验证

本地使用已构建的发布目录：

```powershell
pnpm release:link        # 在 release 目录执行 npm install 和 npm link
dr-octopus --version
dr-octopus --help
```

`release:link` 不重新构建，先安装发布包声明的引导依赖（pnpm），再将全局命令链接到当前 release 目录。首次启动仍按 CLI 的规则询问安装运行依赖，也可以执行 `dr-octopus deps install`。重新生成 release 后再次执行 release:link。正式发布前可用 `npm pack --dry-run` 检查打包文件。

根目录的 `pnpm build/test/lint/typecheck` 统一使用 Turbo 任务图。CLI 通过 workspace dependencies 声明运行依赖；`pnpm --filter @octopus/cli test` 会先重新构建 CLI，避免测试旧产物。

日常开发使用 `pnpm dev`，或分别执行 Server/Web 的 dev 脚本。`pnpm dev:cli` 直接通过 tsx 运行 CLI 源码，参数原样传递，不依赖 Turbo 交互界面；不带参数时显示帮助并正常退出，不会启动服务：

```powershell
pnpm dev:cli
pnpm dev:cli --help
pnpm dev:cli gateway status --json
```

`dev:cli` 不自动构建 workspace 依赖。需要启动 Server 或 Scheduler 时，先执行 `pnpm build` 准备运行产物。CLI 前台源码调试必须显式指定 Server 入口：

```powershell
pnpm dev:cli gateway run --dev-entry "<REPO_ROOT>/apps/server/src/runtime.ts"
```

`--dev-entry` 指向导出 `createServerRuntime()` 的模块，CLI 的 Gateway 入口仍持有同一把锁。独立 Server 的 `src/index.ts` / `dist/index.js` 和 `createServerRuntime()` 不获取 Gateway 锁，不参与 `gateway status/stop`；它们由自己的入口负责退出，监听端口和数据目录仍须避免冲突。

```powershell
pnpm --filter @octopus/server build
pnpm --filter @octopus/server test
pnpm --filter @octopus/cli build
pnpm --filter @octopus/cli test
pnpm --filter @octopus/cli test:release "C:/isolated/node_modules/dr-octopus"
```

最后一项要求仓库外 npm 包已执行 deps install，且该 OS 用户没有运行中的 Gateway。它使用隔离数据，验证实际后台启动、静态页面、WS/SSE、Agent RPC、Scheduler 独立性、日志与附件 Worker；不会发送模型请求。测试会保留隔离目录用于检查，结束时停止本次测试服务。

首期不提供系统服务安装、开机启动、崩溃自动重启、版本迁移或回滚。Windows、Linux 和 macOS 的发布依赖必须分别安装验证，不能交付另一平台的 node_modules。

### 第三方许可声明

`pnpm release:build` 将根目录 `LICENSE` 与 `THIRD_PARTY_NOTICES.md` 原样放入 npm 包和运行时压缩包。必要的第三方许可原文统一保存在 `THIRD_PARTY_NOTICES.md`，不生成独立的许可证目录或依赖扫描索引。更新内置二进制、复制源码或已打包依赖时，同步核对并更新合并声明。
