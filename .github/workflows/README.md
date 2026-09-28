# Docker 镜像发布配置

本目录的 [docker-release.yml](./docker-release.yml) 负责在 GitHub Actions 上构建、验证并发布 Docker Hub 成品镜像。需要手动添加的 Actions Secrets 只有两个：`DOCKERHUB_USERNAME` 和 `DOCKERHUB_TOKEN`。

## 每一步在哪里执行

| 步骤                            | 执行位置       | 做什么                                                             |
| ------------------------------- | -------------- | ------------------------------------------------------------------ |
| ① 执行 `pnpm release:publish`   | 维护者电脑     | 构建应用，发布 npm 包，然后创建 GitHub Release                     |
| ② 自动触发 `docker-release.yml` | GitHub Actions | 收到 GitHub Release 发布事件，启动远程任务                         |
| ③ 等待并构建 Docker 镜像        | GitHub Actions | 等待 npm 包公开可下载，由 Docker 官方组件构建精确版本镜像          |
| ④ 验证并发布                    | GitHub Actions | 验证启动和数据持久化，官方组件推送镜像，检查匿名拉取并上传安装 ZIP |
| ⑤ 安装应用                      | 用户服务器     | 下载安装 ZIP，执行 `docker compose pull` 和 `docker compose up`    |

正常发布不需要维护者电脑安装 Docker。本地命令完成后，远程镜像任务可能还在执行，可在 GitHub 的 Actions 页面查看。这个工作流不登录用户服务器，不需要服务器 IP、SSH 账号或服务器密码。

## 官方组件与项目脚本的分工

| 文件或组件                   | 负责什么                                                                    |
| ---------------------------- | --------------------------------------------------------------------------- |
| `docker-release.yml`         | 固定维护的流程定义，安排步骤，不是发布时生成的文件                          |
| `docker/setup-buildx-action` | 准备构建器                                                                  |
| `docker/build-push-action`   | 先构建并加载镜像供测试；测试通过后复用同一个构建器的缓存推送版本镜像        |
| `docker/login-action`        | 使用 Secrets 登录 Docker Hub                                                |
| `npm-ready.mjs`              | 限时等待 npm 精确版本及其下载包公开可用                                     |
| `smoke.mjs`                  | 检查版本、启动、Web 和数据持久化                                            |
| `release.mjs`                | 核对 Release、检查标签、准备安装文件、判断是否允许更新 `latest`；不执行推送 |

`docker/*` 由 Docker 官方维护，运行在 GitHub Actions 平台上。流程采用 Docker 的[推送前测试方案](https://docs.docker.com/build/ci/github-actions/test-before-push/)：两次调用构建组件使用相同的基础镜像摘要、版本参数和构建器；第二次复用缓存并推送。匿名拉取后再次核对镜像 ID，通过后才上传安装包。工作流最后用可直接阅读的 `docker tag` / `docker push` 命令更新 `latest`，并且只有版本判断允许时才执行。

## 1. 准备 Docker Hub 账号和公开仓库

当前发布目标固定为：

```text
docker.io/nebulaedata01/dr-octopus
```

在 [Docker Hub](https://hub.docker.com/) 完成以下配置：

1. 注册或登录 Docker 账号。
2. 使用 Docker Hub 账号 `nebulaedata01`。
3. 确认该账号下的 [dr-octopus 仓库](https://hub.docker.com/repository/docker/nebulaedata01/dr-octopus/general)可见性设置为 **Public**。
4. 确认用于发布的账号有该仓库的推送权限。

GitHub 仓库仍为 `nebulaedata/dr-octopus`，Docker Hub 镜像仓库为 `nebulaedata01/dr-octopus`，两者账号相互独立。如果以后更换 Docker Hub 命名空间，需要同步调整工作流、[发布辅助脚本](../../deploy/docker/release.mjs)、[Compose](../../deploy/docker/compose.yaml) 和相关文档中的镜像地址。只修改登录用户名不会改变发布目标。

## 2. 创建 Docker Hub 访问令牌

登录 [Docker Home](https://app.docker.com/)，进入：

```text
头像 → Account settings → Personal access tokens → Generate new token
```

- 名称建议使用 `dr-octopus-github-actions`。
- 权限包含 **Read、Write**，不需要 Delete。
- 设置有效期，并在到期前更新对应 GitHub Secret。
- 生成后保存令牌，下一步将其填入 GitHub；使用访问令牌，不填写 Docker 账号密码。

具体入口和权限说明见 [Docker 个人访问令牌文档](https://docs.docker.com/security/access-tokens/personal-access-tokens/)。

## 3. 添加 GitHub Repository Secrets

打开 [Actions Secrets 设置](https://github.com/nebulaedata/dr-octopus/settings/secrets/actions)，路径为：

```text
GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret
```

添加以下两个 Secret，名称必须与工作流完全一致：

| Secret 名称          | 填写内容                                       |
| -------------------- | ---------------------------------------------- |
| `DOCKERHUB_USERNAME` | `nebulaedata01`，即 Docker Hub 登录账号        |
| `DOCKERHUB_TOKEN`    | `nebulaedata01` 账号创建的 Docker Hub 访问令牌 |

当前账号配置：`DOCKERHUB_USERNAME` 填 `nebulaedata01`，`DOCKERHUB_TOKEN` 填该账号创建的、具有 Read 和 Write 权限的个人访问令牌。GitHub 的用户名及本地 GitHub 发布令牌不因 Docker Hub 账号调整而改变。

这里使用 **Repository secrets**，不是 Variables；当前工作流也没有指定 Environment，不能只将凭据放在 Environment secrets 中。账号和令牌不写进 YAML、不提交到 Git。参阅 [GitHub Secrets 文档](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)。

## 4. 区分本地与远程 GitHub 令牌

| 使用位置                                          | 是否手动配置                                 | 用途                                  |
| ------------------------------------------------- | -------------------------------------------- | ------------------------------------- |
| 本地仓库根目录 `.env.publish` 中的 `GITHUB_TOKEN` | 需要，沿用现有发布配置                       | 本地发布脚本查询并创建 GitHub Release |
| 工作流中的 `${{ github.token }}`                  | 不需要，GitHub 自动提供                      | 查询 Release、上传 Docker 安装 ZIP    |
| 工作流步骤中的 `GH_TOKEN`                         | 不需要，YAML 已从 `${{ github.token }}` 注入 | 供发布辅助脚本和 `gh` 命令使用        |

本地 `.env.publish` 示例（仅为占位符）：

```dotenv
GITHUB_TOKEN=YOUR_GITHUB_PERSONAL_ACCESS_TOKEN
```

可以在 GitHub **Settings → Developer settings → Personal access tokens → Fine-grained tokens** 创建本地发布令牌：选择对应资源所有者，将仓库范围限定为 `nebulaedata/dr-octopus`，授予 **Contents: Read and write**。如果组织要求审批，需完成审批后再使用。该令牌负责 Release API；本地 `git push` 仍使用你已经配置的 Git HTTPS 或 SSH 凭据。参阅 [GitHub Release API 权限](https://docs.github.com/en/rest/releases/releases#create-a-release)。

工作流已经声明：

```yaml
permissions:
  contents: write
```

无需另建名为 `GITHUB_TOKEN` 或 `GH_TOKEN` 的 Actions Secret，也无需将本地 `.env.publish` 上传到 GitHub。

注意：由 Actions 自带 `GITHUB_TOKEN` 创建的 Release 不会再自动触发本工作流。当前设计是在维护者电脑上使用个人访问令牌或 GitHub App 令牌创建 Release，因此能够触发；如果今后调整为在另一个工作流中发布 Release，需要保留合适的事件触发方式，或使用手动入口。参阅 [GitHub 内置令牌与触发规则](https://docs.github.com/en/actions/concepts/security/github_token)。

## 5. 检查 Actions 设置并正常发布

1. 在仓库 **Settings → Actions → General** 启用 Actions，允许工作流使用的 `actions/*`、`docker/*`。仓库或组织策略也需允许声明的 `contents: write` 权限。
2. 当前工作流仅在 GitHub 仓库 `nebulaedata/dr-octopus` 中执行；更换仓库时需要修改工作流中的 `github.repository` 条件。
3. 提交并推送工作流、部署文件和发布辅助脚本，使新 Release 的 Git tag 包含这些文件。工作流也应存在于默认分支，便于手动触发。
4. 本地保持 npm 已登录并拥有 `dr-octopus` 包的发布权限，执行 `pnpm release:publish`。npm 的发布认证继续由本地现有流程负责，Docker 工作流只读取公开 npm 包，不需要 npm Token。
5. GitHub Release 创建后，打开 **Actions → Docker release** 查看构建、验证和发布结果。
6. 成功后确认 Docker Hub 中出现版本镜像，GitHub Release 中出现 `dr-octopus-docker-<镜像标签>.zip`。

没有 Docker 安装 ZIP 的 Release 尚不能视为 Docker 安装就绪。若任务在更新 `latest` 时失败，精确版本镜像和安装 ZIP 可能已经可用，按失败步骤重试即可。

## 6. 失败重试与手动补发

### npm 审核或上架延迟

npm 接收发布不等于该版本立即可以公开下载。新镜像构建前，工作流检查精确版本的 npm 元数据和 tarball 下载地址；尚不可用时每分钟重试，最多等待 15 分钟。404、限流、服务端错误和网络异常会重试；认证错误或版本信息不匹配会立即报错。已有版本镜像的重试直接复用镜像，不等待 npm。

超过等待时间后，工作流明确报错并停止。审核完成后，先确认以下命令返回版本号（以 `0.0.10` 为例）：

```bash
npm view dr-octopus@0.0.10 version --registry=https://registry.npmjs.org
```

然后打开失败的运行记录，点击 **Re-run jobs → Re-run failed jobs**，或使用下面的 **Run workflow**。保持原 `tag` 和 `image_revision`，无需重新发布 npm、修改版本或删除 Release。npm 后续上架不会自动唤醒已经失败的运行。

### 手动运行

在 GitHub **Actions → Docker release → Run workflow** 中选择包含工作流的默认分支，填写：

| 输入             | 示例      | 含义                                               |
| ---------------- | --------- | -------------------------------------------------- |
| `tag`            | `v0.0.10` | 已发布的 GitHub Release tag，且同版本 npm 包已存在 |
| `image_revision` | `0`       | 正常版本或重试，生成 `0.0.10` 镜像标签             |
| `image_revision` | `1`       | 显式镜像修订，生成 `0.0.10-r1` 镜像标签            |

工作流最终检出填写的 Release tag，因此该 tag 本身必须包含 Docker 发布文件。仅推送 Git tag、不创建 GitHub Release，不会自动触发镜像发布。

本次流程调整需随新的 Release tag 发布。重跑历史运行会沿用历史工作流；旧 tag 不包含新增脚本时，请在原运行记录中重跑，不要从新版默认分支手动运行旧 tag。

固定镜像标签已存在时复用并验证，不覆盖；npm 已发布但 Docker 失败时，无需再次发布 npm。`latest` 仅向更新的稳定版本或镜像修订推进，不因旧版本补发而回退。

镜像修订仍使用对应 Release tag 中的 Dockerfile，可更新基础镜像和系统依赖；如需修改 Dockerfile 或发布脚本，提交修改并发布新版本，不移动已有 Release tag。

## 相关文档

- [设计文档与验证记录](../../docs/architecture/docker-distribution.md)
- [Docker Compose 安装说明](../../deploy/docker/README.zh-CN.md)
