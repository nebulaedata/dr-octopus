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

仅首次安装执行 `cp`，避免覆盖配置。安装包已固定经过验证的 `IMAGE_TAG`。如果直接使用源码仓库中的部署文件，需要自行填写 Docker Hub 上已经存在的标签；仓库示例版本不代表该镜像已发布。

在浏览器打开 `http://服务器IP:3000`，将“服务器IP”替换为 Docker 所在服务器的可访问 IP，配置模型提供商和凭据。服务器防火墙及云安全组需放行 TCP 3000（修改 `HTTP_PORT` 后放行对应端口）。直接通过 IP 访问不需要反向代理。首次启动仍可能联网下载扩展，不属于离线安装；启动等待预留约十分钟。健康检查验证 Gateway，不验证模型凭据或外部模型服务。

## 配置和远程访问

| 变量                 | 用途                                                                 |
| -------------------- | -------------------------------------------------------------------- |
| `IMAGE_TAG`          | 已发布镜像标签，如 `0.0.10`、`0.0.10-r1`；正式部署固定版本           |
| `BIND_ADDRESS`       | 宿主机绑定地址，默认 `0.0.0.0`，监听所有网卡                         |
| `HTTP_PORT`          | 宿主机端口，默认 `3000`；容器内部保持 `3000`                         |
| `SERVER_CORS_ORIGIN` | 实际浏览器访问来源，多个用逗号分隔，如 `https://octopus.example.com` |
| `LOG_LEVEL`          | 默认 `info`                                                          |

通过 IP 同源访问时，`SERVER_CORS_ORIGIN` 可以留空；使用域名时填写实际浏览器来源，包含协议和非默认端口，不使用通配符、URL 路径或尾部斜杠。安装配置没有包含反向代理、DNS 或证书。

应用没有用于公网部署的内置登录边界，CORS 不是登录认证。面向不受信任的公网用户时，按照[安全政策](https://github.com/nebulaedata/dr-octopus/blob/main/SECURITY.md)配置认证和 HTTPS，覆盖 HTTP、WebSocket、SSE。如果使用宿主机上的反向代理，可将 `BIND_ADDRESS` 改为 `127.0.0.1`，避免绕过代理直接访问后端。`0.0.0.0` 是监听地址，浏览器应填写服务器实际 IP 或域名。

Compose 环境变量优先于 Web 中持久化的同名配置。修改 `.env` 后执行 `docker compose up -d --wait --wait-timeout 660`；仅执行 `restart` 不会应用修改。

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

升级前停止服务并备份三个卷，记录镜像标签及 `.env`。修改 `IMAGE_TAG` 后执行：

```bash
docker compose pull
# 只有拉取成功后才继续。
docker compose up -d --wait --wait-timeout 660
```

`0.0.10-r1` 之类的镜像修订标签保留同一 npm 应用版本，仅修订容器镜像。`latest` 指向已晋升的最新稳定镜像，正式部署仍建议固定精确标签。

单实例替换期间会短暂中断。拉取失败不会替换现有容器；启动失败时检查 `docker compose ps --all` 和 `docker compose logs --tail 150`。不自动回滚数据库。回退旧镜像前先确认数据兼容性，否则恢复对应备份。`docker compose down` 保留数据卷；**`down -v` 会删除数据**。

从原来的服务器本地构建方案迁移时，先备份，再替换 Compose，并在原 `.env` 增加 `IMAGE_TAG`。保留端口和域名设置。如果已有 `.env` 设置了 `BIND_ADDRESS=127.0.0.1`，需要直接远程访问时将其改为 `0.0.0.0`。`DR_OCTOPUS_VERSION`、`NPM_REGISTRY` 不再作为部署输入。保持原项目名（包括自行设置的 `-p` / `COMPOSE_PROJECT_NAME`）及卷映射，才能复用旧数据；不要并行启动两套配置。

## 维护者说明

维护者本地执行现有 npm 发布，创建 GitHub Release 后由 GitHub Actions 远程构建镜像，本地不需要 Docker。具体执行位置见[设计文档中的步骤表格](https://github.com/nebulaedata/dr-octopus/blob/main/docs/architecture/docker-distribution.md)。Dockerfile、发布辅助脚本和测试公开在 Git 中，但不包含在用户安装 ZIP 中。
