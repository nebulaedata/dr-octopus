# 将 Docker Hub 镜像同步到内部 Harbor

公开发布仍以 Docker Hub 为主仓库。内部同步是维护者手动执行的独立操作，不需要重新构建应用，也不会触发 npm 或 GitHub Release。

| 项目            | 默认值                                        |
| --------------- | --------------------------------------------- |
| 源仓库          | `docker.io/nebulaedata01/dr-octopus`          |
| Harbor 登录地址 | `harbor.n.nebulaedata.com`                    |
| Harbor 项目     | `nebulae`                                     |
| 目标仓库        | `harbor.n.nebulaedata.com/nebulae/dr-octopus` |
| 镜像标签        | `latest`，可通过 `--tag` 指定精确版本         |

## 1. 准备和登录

执行同步的电脑需要 Node.js 22.19+、Docker CLI 和支持 `imagetools create --prefer-index=false` 的 Buildx；可以是 Windows、macOS 或 Linux。交互模式使用项目已有的 `@clack/prompts`，首次需要在源码仓库根目录运行 `pnpm install --frozen-lockfile`（pnpm 11+）。非交互模式和预览不加载该依赖。执行机器需要同时访问 Docker Hub 和内部 Harbor。镜像数据通过执行同步的机器传输。

在 [Harbor 项目页面](https://harbor.n.nebulaedata.com/harbor/projects) 确认已有普通项目 `nebulae`，并使用具有该项目拉取和推送权限的账户。代理缓存项目不支持推送。交互脚本会引导执行 `docker login`，账号密码仍由 Docker 提示输入；使用已有登录凭据时 Docker 会尝试重新认证：

```bash
pnpm install --frozen-lockfile
docker buildx version
```

登录地址不包含 `https://` 或 `/harbor/projects`。交互模式实际调用 `docker login`，成功后才进入项目和标签输入。脚本不接收密码参数，也不在源码或 `.env` 中保存密码；凭据由 Docker 管理。自动化场景可由执行环境通过 `docker login --password-stdin` 注入机器人账号凭据。Harbor 使用内部 CA 时，先按组织要求安装可信证书，不关闭 TLS 校验。以上项目和登录要求见 [Harbor 官方文档](https://goharbor.io/docs/main/working-with-projects/working-with-images/pulling-pushing-images/)。

## 2. 执行同步

在源码仓库根目录运行：

```bash
# 预览：读取 Docker Hub 的实际摘要，不写入 Harbor，也不验证 Harbor 权限。
node deploy/docker/sync-harbor.mjs --dry-run

# 进入交互向导，默认同步 latest。
pnpm docker:sync

# 或将指定版本预填到交互向导，目标使用相同标签。
node deploy/docker/sync-harbor.mjs --tag 0.0.10
```

交互步骤如下，命令行参数会成为输入框的初始值：

| 步骤          | 操作                                      |
| ------------- | ----------------------------------------- |
| ① Harbor 地址 | 默认 `harbor.n.nebulaedata.com`，可修改   |
| ② 登录        | 确认后调用 `docker login`；失败则停止     |
| ③ 项目和标签  | 默认项目 `nebulae`、标签 `latest`，可修改 |
| ④ 同步确认    | 展示实际源摘要与目标地址，确认后才推送    |
| ⑤ 验证        | 校验目标摘要，成功后显示结果              |

读取源摘要、同步镜像、核实中断后的目标状态、校验摘要和重试等待期间，向导会显示带计时的 Clack spinner。当前没有可靠的字节传输总量，因此不显示百分比进度条。登录和确认输入期间暂停动画，终端交给 Docker 或输入框。

推送前按 Ctrl+C 或拒绝确认会结束向导，不推送镜像；推送开始后按 Ctrl+C 会停止当前命令及后续重试，但目标可能已有部分数据，需要核实 Harbor 状态。`--dry-run` 跳过交互和登录，直接预览参数指定的目标；它和 `--yes` 保留普通日志输出。

源标签必须已在 Docker Hub 发布。脚本先将源标签解析成不可变摘要，然后通过 Docker Buildx 复制清单和镜像层，最后检查目标标签的摘要。只有摘要一致才输出 `Verified`。采用 [`imagetools create --prefer-index=false`](https://docs.docker.com/reference/cli/docker/buildx/imagetools/create/) 保留源清单格式；不会重新构建，也不会根据本机 CPU 架构筛选平台，源镜像目前为 Linux AMD64。

每次只同步指定标签。同步 `0.0.10` 不会自动更新 Harbor 的 `latest`；同步 `latest` 也不会创建版本标签。目标标签已存在时，会指向本次读取的源摘要；不要让多个任务并发更新同一个目标标签。需要保护精确版本时，在 Harbor 配置版本标签不可变规则，并为 `latest` 保留更新能力。

```bash
# 其他 Harbor 或项目可显式覆盖默认值。
node deploy/docker/sync-harbor.mjs --registry harbor.example.com --project team --tag latest
node deploy/docker/sync-harbor.mjs --help
```

自动化环境需要提前登录，并显式使用 `--yes`；它跳过向导和登录，使用现有 Docker 凭据。没有终端且未指定 `--yes` 或 `--dry-run` 时，脚本报错而不会推送：

```bash
docker login harbor.n.nebulaedata.com
node deploy/docker/sync-harbor.mjs --project nebulae --tag latest --yes
```

网络、认证、推送或摘要校验失败都会以非零状态退出。修复后可以重跑；如果失败前已上传部分数据，脚本不会删除这些数据或自动回滚标签。预览成功只证明源标签可读取，不能代替真实同步验证。该脚本不会定时运行，每次需要更新内部镜像时手动执行。

### Docker Hub 令牌请求出现 EOF

如果 Harbor 显示登录成功，随后在 `https://auth.docker.io/token` 出现 `EOF`，表示 Docker Hub 令牌请求的连接中断，不能据此判定 Harbor 密码错误。源清单读取成功也不保证后续每次令牌或镜像层请求都成功。

脚本对已识别的断线、连接超时、限流和临时服务错误最多尝试 3 次，重试间隔为 2 秒、5 秒。同步始终使用确认时固定的源摘要，不会在重试时重新解析 `latest`。推送中断后先读取目标摘要：目标已一致则继续最终校验；明确不存在或仍指向其他摘要时才重试复制。无法核实目标状态时停止自动重推。认证拒绝、证书错误、用户取消和摘要不一致不会自动重试。

若仍失败，检查执行机器到 `auth.docker.io`、`registry-1.docker.io` 和 Harbor 的访问及终端代理设置，然后重新运行 `pnpm docker:sync`。无需重新发布 npm 包，也不要通过关闭 TLS 校验来绕过网络问题。

## 3. 国内服务器从 Harbor 部署

使用当前版本的 Docker Compose 安装文件，在安装目录 `.env` 设置：

```dotenv
IMAGE_REPOSITORY=harbor.n.nebulaedata.com/nebulae/dr-octopus
IMAGE_TAG=latest
NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
```

`IMAGE_TAG` 也可填写已同步的精确版本。第三项仅用于容器运行时 npm 下载，是可选配置。镜像同步不会替代 Pi 扩展、模型服务或其他外部下载所需的网络。

如果 Harbor 项目私有，部署机器也需要先登录，然后拉取并启动：

```bash
docker login harbor.n.nebulaedata.com
docker compose pull
docker compose up -d --wait --wait-timeout 660
```

如果旧安装包的 Compose 将 Docker Hub 地址写死，只修改 `.env` 不会生效。先把 `services.dr-octopus.image` 改为下面这一行，保留原项目名及三个数据卷：

```yaml
image: ${IMAGE_REPOSITORY:-docker.io/nebulaedata01/dr-octopus}:${IMAGE_TAG:?Set IMAGE_TAG in .env}
```

使用 `latest` 时，先同步内部镜像，再在部署机器执行 `pull` 和 `up`。更换仓库或升级前仍按常规流程备份；脚本不操作部署服务器或数据卷。
