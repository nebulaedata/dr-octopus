# Docker Compose 成品镜像安装

[English](README.md)

从 `docker.io/nebulaedata01/dr-octopus` 拉取成品镜像。需要 AMD64 Linux 容器环境、Docker Engine、Docker Compose v2.20+，并能访问 Docker Hub 和扩展下载站点。用户无需安装 Node.js、pnpm，也无需源码或现场构建镜像。首期不支持 ARM64。

## 下载与安装

在 [GitHub Releases](https://github.com/nebulaedata/dr-octopus/releases) 中选择版本，下载 `dr-octopus-docker-<镜像标签>.zip`。只有镜像发布并验证成功后才会出现该安装包；没有安装包的 Release 尚不能视为 Docker 安装就绪，npm 发布成功不代表镜像已发布。

解压到独立目录，在该目录执行：

```bash
cp .env.example .env
# 按需要编辑 .env。
docker compose pull
docker compose up -d --wait --wait-timeout 660
```

仅首次安装执行 `cp`，避免覆盖配置。安装包已固定经过验证的 `IMAGE_TAG`。源码仓库模板默认使用 `IMAGE_TAG=latest`。安装包解压后也可以将其改为 `latest`，跟随稳定版本；需要固定版本时填写 Docker Hub 上的精确标签。

在浏览器打开 `http://服务器IP:3000`，将“服务器IP”替换为 Docker 所在服务器的可访问 IP，配置模型提供商和凭据。服务器防火墙及云安全组需放行 TCP 3000（修改 `HTTP_PORT` 后放行对应端口）。直接通过 IP 访问不需要反向代理。首次启动仍可能联网下载扩展，不属于离线安装；启动等待预留约十分钟。健康检查验证 Gateway，不验证模型凭据或外部模型服务。

## 配置和远程访问

| 变量                  | 用途                                                                    |
| --------------------- | ----------------------------------------------------------------------- |
| `IMAGE_TAG`           | 仓库模板默认 `latest`；Release 安装包固定对应版本，也可自行指定精确标签 |
| `BIND_ADDRESS`        | 宿主机绑定地址，默认 `0.0.0.0`，监听所有网卡                            |
| `HTTP_PORT`           | 宿主机端口，默认 `3000`；容器内部保持 `3000`                            |
| `SERVER_CORS_ORIGIN`  | 实际浏览器访问来源，多个用逗号分隔，如 `https://octopus.example.com`    |
| `LOG_LEVEL`           | 默认 `info`                                                             |
| `NPM_CONFIG_REGISTRY` | 容器运行时 npm 下载源，默认 `https://registry.npmjs.org`                |

通过 IP 同源访问时，`SERVER_CORS_ORIGIN` 可以留空；使用域名时填写实际浏览器来源，包含协议和非默认端口，不使用通配符、URL 路径或尾部斜杠。安装配置没有包含反向代理、DNS 或证书。

应用没有用于公网部署的内置登录边界，CORS 不是登录认证。面向不受信任的公网用户时，按照[安全政策](https://github.com/nebulaedata/dr-octopus/blob/main/SECURITY.md)配置认证和 HTTPS，覆盖 HTTP、WebSocket、SSE。如果使用宿主机上的反向代理，可将 `BIND_ADDRESS` 改为 `127.0.0.1`，避免绕过代理直接访问后端。`0.0.0.0` 是监听地址，浏览器应填写服务器实际 IP 或域名。

Compose 环境变量优先于 Web 中持久化的同名配置。修改 `.env` 后执行 `docker compose up -d --wait --wait-timeout 660`；仅执行 `restart` 不会应用修改。

## 国内 npm 下载源（可选）

在安装目录的 `.env` 中设置淘宝 npm 镜像：

```dotenv
NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
```

然后执行 `docker compose up -d --wait --wait-timeout 660` 重建容器并应用配置。首次安装时可在启动前设置。项目统一使用 npm 官方环境变量 `NPM_CONFIG_REGISTRY` 配置运行依赖和 Pi 扩展的下载源，直接传给 npm，无需变量转换。可运行 `docker compose exec -T dr-octopus npm config get registry` 检查实际配置。

不设置或留空时使用 npm 官方源。切换源无需重新构建镜像，也不会重新安装已有扩展。它不改变 Docker Hub 拉取地址、镜像内已安装的依赖或 GitHub Actions 构建源，也不代理 GitHub 和其他二进制下载站点。镜像源可能存在版本同步延迟；指定版本尚不可用时可等待同步或改回官方源。

镜像构建也使用同名的 `NPM_CONFIG_REGISTRY` build arg，控制 Dockerfile 内应用和运行依赖的安装。官方 Actions 使用其默认值 `https://registry.npmjs.org`。自行构建时传入 `--build-arg NPM_CONFIG_REGISTRY=https://registry.npmmirror.com`，并同时指定 `--build-arg DR_OCTOPUS_VERSION=<已发布版本>`。构建参数与部署 `.env` 在不同阶段读取，部署时修改 `.env` 不会改变已经构建好的镜像。

旧安装 ZIP 中的 Compose 若没有这项映射，仅修改 `.env` 不会生效。可在现有 `compose.yaml` 的 `services.dr-octopus.environment` 下添加 `NPM_CONFIG_REGISTRY: ${NPM_CONFIG_REGISTRY:-https://registry.npmjs.org}`，再执行上述重建命令。

## 数据与日常运维

| 卷            | 容器路径                        | 内容                             |
| ------------- | ------------------------------- | -------------------------------- |
| `server-data` | `/home/node/.dr-octopus/server` | 数据库、会话、附件、Server 设置  |
| `agent-data`  | `/home/node/.dr-octopus/agent`  | Agent 配置、凭据和扩展           |
| `workspaces`  | `/workspaces`                   | 工作区文件；在此目录下创建工作区 |

Compose 项目名保持 `dr-octopus`，卷名默认带 `dr-octopus_` 前缀。容器使用 `node` 用户（UID/GID 1000），新命名卷继承目录权限；改用宿主机目录挂载时，需要提供对应读写权限。不要挂载覆盖整个 `/home/node` 或 `.dr-octopus`，镜像内的版本化运行依赖必须保持可用。持久化目录以外的文件会在容器重建时丢失。

```bash
docker compose ps
docker compose logs -f --tail 100
docker compose exec -T dr-octopus dr-octopus gateway health --json
docker compose exec -T dr-octopus dr-octopus --version
docker compose stop
docker compose up -d --wait --wait-timeout 660
```

## 升级、恢复与旧部署迁移

升级前停止服务并备份三个卷，记录镜像标签及 `.env`。固定版本部署先修改 `IMAGE_TAG`；使用 `latest` 时保持不变，然后执行：

```bash
docker compose pull
# 只有拉取成功后才继续。
docker compose up -d --wait --wait-timeout 660
```

`0.0.10-r1` 之类的镜像修订标签保留同一 npm 应用版本，仅修订容器镜像。`latest` 指向已晋升的最新稳定镜像，正式部署仍建议固定精确标签。更新 `latest` 时必须先执行 `docker compose pull` 再执行 `up`；仅运行 `up` 不保证下载新镜像。

单实例替换期间会短暂中断。拉取失败不会替换现有容器；启动失败时检查 `docker compose ps --all` 和 `docker compose logs --tail 150`。不自动回滚数据库。回退旧镜像前先确认数据兼容性，否则恢复对应备份。`docker compose down` 保留数据卷；**`down -v` 会删除数据**。

从原来的服务器本地构建方案迁移时，先备份，再替换 Compose，并在原 `.env` 增加 `IMAGE_TAG`。保留端口和域名设置。如果已有 `.env` 设置了 `BIND_ADDRESS=127.0.0.1`，需要直接远程访问时将其改为 `0.0.0.0`。`DR_OCTOPUS_VERSION` 不再作为成品镜像部署输入；部署 `.env` 中的 `NPM_CONFIG_REGISTRY` 控制运行时 npm 下载，自行构建则通过同名 build arg 配置。保持原项目名（包括自行设置的 `-p` / `COMPOSE_PROJECT_NAME`）及卷映射，才能复用旧数据；不要并行启动两套配置。

## 内部 Harbor 镜像

镜像同步后，可在部署 `.env` 设置 `IMAGE_REPOSITORY=harbor.n.nebulaedata.com/nebulae/dr-octopus`；不设置或留空时仍使用 Docker Hub。`IMAGE_TAG` 填写已同步标签，私有项目需先在部署机器执行 `docker login`。账号准备、同步脚本、摘要校验及旧 Compose 的修改方式见[Harbor 同步说明](https://github.com/nebulaedata/dr-octopus/blob/main/deploy/docker/HARBOR.md)。

## 维护者说明

维护者本地执行现有 npm 发布，创建 GitHub Release 后由 GitHub Actions 远程构建镜像，本地不需要 Docker。具体执行位置见[设计文档中的步骤表格](https://github.com/nebulaedata/dr-octopus/blob/main/docs/architecture/docker-distribution.md)。Dockerfile、发布辅助脚本和测试公开在 Git 中，但不包含在用户安装 ZIP 中。
