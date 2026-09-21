# Dr.Octopus

[English](./README.md) | 简体中文

基于 Pi、本地优先、以 Workspace 为边界的通用智能体系统，提供终端 TUI 和 Web 界面。

## 让智能体帮你安装

复制下面这段提示词，粘贴给能够执行本机终端命令的智能体：

```text
请在我的电脑上安装并启动 Dr.Octopus：先检查 Node.js >= 22.19.0 和 npm；如果缺少或版本不符合要求，先帮我完成环境准备。然后依次执行 npm install -g dr-octopus@latest、dr-octopus deps install、dr-octopus gateway start --yes，再运行 dr-octopus --version、dr-octopus gateway status 和 dr-octopus doctor 验证结果。失败时根据实际日志排查并报告未解决的问题，不要宣称安装成功。完成后告诉我实际 Web 访问地址（默认 http://127.0.0.1:3000），并引导我在界面中配置模型提供商和凭据。如果你无法执行本机命令，请明确说明并提供逐步操作指南。
```

智能体需要具备本机命令执行权限和网络访问能力；普通聊天型智能体只能提供操作指导。安装完成后仍需配置自己的模型凭据。

## 安装

需要 Node.js 22.19.0 或更高版本。

```sh
npm install -g dr-octopus
```

首次启动 TUI 或 Gateway 时，会询问是否安装运行依赖。安装需要网络连接，运行环境保存在用户目录的 `~/.dr-octopus/runtimes`。也可以提前安装：

```sh
dr-octopus deps install
```

运行依赖包含原生模块；没有适用的预编译包时，需要目标平台的编译工具链。

## 快速开始

启动 Web 界面：

```sh
dr-octopus gateway start
```

默认访问地址为 <http://127.0.0.1:3000>。模型凭据和相关设置需在使用前配置。

在当前终端启动 TUI：

```sh
dr-octopus tui
```

在脚本或非交互环境中，使用 `dr-octopus deps install` 提前安装依赖，或显式允许启动时安装：

```sh
dr-octopus gateway start --install-deps
```

## 非交互安装与镜像

智能体或脚本可以通过 `--yes`（简写 `-y`）跳过安装确认。它只授权安装，不自动切换下载源：

```sh
dr-octopus --yes
dr-octopus gateway start --yes
```

如果默认源下载超时，可以显式指定淘宝 npm 镜像：

```sh
dr-octopus deps install --yes --registry https://registry.npmmirror.com
dr-octopus gateway start --yes --registry https://registry.npmmirror.com
dr-octopus tui --yes --registry https://registry.npmmirror.com
```

`deps install` 本身已代表同意安装，无需额外确认。裸命令及启动命令在非交互环境下缺少依赖时，必须提供 `--yes` 或 `--install-deps`；单独传 `--registry` 不代表同意安装。TUI 的安装参数放在 Agent 参数前，`--` 后的内容原样传给 Agent。

源优先级为本次 `--registry`、已有 npm/pnpm 配置、包管理器默认源。镜像参数仅对本次运行依赖安装生效，不修改全局配置或发布锁文件；保留 scoped registry 与对应认证设置。不会检测地区、自动换源或额外重试。

“非交互”不表示关闭日志：安装仍输出进度与错误，失败返回非零退出码。原生模块可能从其他站点下载二进制或需要本机编译，换 npm 源不一定能解决这些错误。请根据失败阶段检查网络、凭据、下载目标或编译工具链。

该参数不影响先前的全局 npm 包安装；若这一步也需要镜像，可使用 npm 自身的参数：

```sh
npm install -g dr-octopus --registry https://registry.npmmirror.com
```

## 常用命令

```sh
dr-octopus --help
dr-octopus --version
dr-octopus gateway status
dr-octopus gateway restart
dr-octopus gateway stop
dr-octopus doctor
dr-octopus runtimes list
dr-octopus runtimes prune --dry-run
```

`--help`、`--version` 和 Gateway 的 status/stop 不会触发依赖安装。`gateway stop` 不停止独立运行的 Scheduler。

## 配置与数据

默认用户数据保存在 `~/.dr-octopus/server` 和 `~/.dr-octopus/agent`，独立于 npm 安装目录和版本化运行环境。

Web 设置中的“环境变量”可用于管理运行配置。也可以通过进程环境设置 `SERVER_HOST`、`SERVER_PORT`、`SERVER_DATA_DIR` 和 `DR_OCTOPUS_CODING_AGENT_DIR`。发布入口不读取源码仓库的 `.env`。

修改 Server 配置后，执行 `dr-octopus gateway restart` 使其生效。

## 更新

```sh
npm install -g dr-octopus@latest
dr-octopus gateway restart
```

新版本首次运行时按需安装对应运行依赖。可先用 `dr-octopus runtimes prune --dry-run` 预览旧运行环境，再执行 `dr-octopus runtimes prune` 清理未使用的旧版本。

## 许可证

Dr.Octopus 原创代码采用 [MIT License](./LICENSE)。第三方组件保留各自的许可证与权利，详见 [第三方声明](./THIRD_PARTY_NOTICES.md)。
