<p align="center">
  <img src="https://raw.githubusercontent.com/nebulaedata/dr-octopus/main/apps/web/public/brand/logo-256.png" alt="Dr.Octopus logo" width="144" height="144" />
</p>

<h1 align="center">Dr.Octopus</h1>

<p align="center">
  <strong>本地优先 · Workspace 隔离 · TUI 与 Web 双界面 · 知识库 · 定时任务 · 记忆</strong><br />
  基于 Pi 的通用智能体系统。
</p>

<p align="center">
  <a href="https://github.com/nebulaedata/dr-octopus/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-3b82f6" alt="License: MIT" /></a>
  <a href="https://github.com/earendil-works/pi"><img src="https://img.shields.io/badge/built_with-Pi-ef4444" alt="Built with Pi" /></a>
  <a href="https://pnpm.io/"><img src="https://img.shields.io/badge/pnpm-11.18.0-f69220?logo=pnpm&amp;logoColor=white" alt="pnpm 11.18.0" /></a>
</p>

<p align="center">
  <a href="https://github.com/nebulaedata/dr-octopus/blob/main/README.md">English</a> · <strong>简体中文</strong> · <a href="https://github.com/nebulaedata/dr-octopus/blob/main/README.dev.zh-CN.md">开发文档</a>
</p>

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

## Docker 安装

Linux AMD64 服务器可直接部署 [Docker Hub 成品镜像](https://hub.docker.com/r/nebulaedata01/dr-octopus)。需要 Docker Engine 和 Docker Compose v2.20 或更高版本，无需安装 Node.js、pnpm、克隆源码或构建镜像。目前不支持 ARM64。

1. 打开 [GitHub Releases](https://github.com/nebulaedata/dr-octopus/releases)，在所选版本的 **Assets** 中下载 `dr-octopus-docker-<镜像标签>.zip`。选择 Docker 安装 ZIP，不是源码压缩包。安装包包含 Compose 配置并已固定镜像版本；尚未提供该 ZIP 的 Release 不能视为 Docker 安装就绪。
2. 将 ZIP 解压到服务器上的独立目录，并在该目录打开终端。
3. 创建配置并启动服务：

   ```sh
   cp .env.example .env
   # 如需修改宿主机端口或绑定地址，先编辑 .env。
   docker compose pull
   docker compose up -d --wait --wait-timeout 660
   ```

仅首次安装复制 `.env.example`，避免覆盖已有配置。确认镜像拉取成功后再启动。首次启动可能联网下载扩展，需要几分钟，服务器需具备出站网络访问能力。

在浏览器打开 **`http://服务器IP:3000`**，将“服务器IP”替换为服务器实际可访问的 IP，然后在 Web 界面配置模型提供商和凭据。服务器防火墙及云安全组需放行 TCP `3000` 端口。如果 Docker 运行在自己的电脑上，可访问 <http://localhost:3000>。

| `.env` 配置           | 默认值                       | 用途                             |
| --------------------- | ---------------------------- | -------------------------------- |
| `IMAGE_TAG`           | 安装 ZIP 已固定              | 镜像标签，也支持 `latest`        |
| `BIND_ADDRESS`        | `0.0.0.0`                    | 监听宿主机所有网卡，允许远程访问 |
| `HTTP_PORT`           | `3000`                       | 浏览器访问的宿主机端口           |
| `NPM_CONFIG_REGISTRY` | `https://registry.npmjs.org` | 扩展安装等运行时 npm 下载源      |

国内部署可在 `.env` 中设置 `NPM_CONFIG_REGISTRY=https://registry.npmmirror.com`，再执行 `docker compose up -d --wait --wait-timeout 660`。无需重新构建镜像；Docker Hub 拉取和发布构建仍使用原有源。已有部署的配置方式见[国内 npm 下载源说明](https://github.com/nebulaedata/dr-octopus/blob/main/deploy/docker/README.zh-CN.md#国内-npm-下载源可选)。

直接通过 IP 访问不需要反向代理。面向公网访问时，按照 [Docker Compose 安装说明](https://github.com/nebulaedata/dr-octopus/blob/main/deploy/docker/README.zh-CN.md#配置和远程访问)通过反向代理配置认证和 HTTPS；应用没有用于公网部署的内置登录边界。安装 ZIP 不包含反向代理或证书。

在安装目录查看状态和日志：

```sh
docker compose ps
docker compose logs -f --tail 100
```

Server 数据、Agent 配置和工作区分别保存在三个 Docker 持久化卷中。请在容器的 `/workspaces` 下创建工作区。`docker compose down` 保留数据卷；**`docker compose down -v` 会删除卷内数据**。

升级前停止服务并备份三个卷和 `.env`，将 `IMAGE_TAG` 改为 Docker Hub 上已存在的版本（使用 `latest` 时保持不变以跟随稳定版），再依次执行 `docker compose pull` 和 `docker compose up -d --wait --wait-timeout 660`。Docker 部署使用这些 Compose 命令管理；下文的 npm 命令适用于本机直接安装。域名访问、备份和故障排查详见 [完整 Docker Compose 安装说明](https://github.com/nebulaedata/dr-octopus/blob/main/deploy/docker/README.zh-CN.md)。

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

源优先级为本次 `--registry`、npm 官方环境变量 `NPM_CONFIG_REGISTRY`、已有 npm/pnpm 配置、包管理器默认源。镜像参数仅对本次运行依赖安装生效，不修改全局配置或发布锁文件；保留 scoped registry 与对应认证设置。不会检测地区、自动换源或额外重试。

项目统一使用 npm 官方环境变量 `NPM_CONFIG_REGISTRY` 配置运行依赖和 Pi 扩展的下载源。源码开发时在根目录 `.env` 设置 `NPM_CONFIG_REGISTRY=https://registry.npmmirror.com`，然后重启开发进程；Docker 部署则在安装目录 `.env` 设置同名变量。单独执行 npm 或 CLI 命令时，需要在 Shell 中设置该环境变量；npm 不会自动读取项目 `.env`。

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

## 开发

源码环境搭建、开发命令和架构文档请参阅[开发指南](https://github.com/nebulaedata/dr-octopus/blob/main/README.dev.zh-CN.md)。

## 许可证

Dr.Octopus 原创代码采用 [MIT License](https://github.com/nebulaedata/dr-octopus/blob/main/LICENSE)。第三方组件保留各自的许可证与权利，详见 [第三方声明](https://github.com/nebulaedata/dr-octopus/blob/main/THIRD_PARTY_NOTICES.md)。
