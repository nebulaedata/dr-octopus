# docker-distribution：概念验证与验收

架构设计：[原设计](../architecture/docker-distribution.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

## 验收

发布工作流验证实际 Linux AMD64 镜像的版本、OCI 标签、非 root 用户、Gateway health/ready、Web 首页，以及三个卷中的文件在容器重建后保留。推送后使用空 Docker 客户端配置验证匿名拉取，通过后才上传安装包。安装包使用公开 Compose 配置；配置测试验证默认对外绑定和旧项目/卷身份。隔离的 smoke 测试显式使用回环地址及随机端口，不改变安装默认值。首次正式发布还需确认工作流端到端成功、真实旧版本升级和服务器外部访问。

本地没有 Docker Engine 时只能验证脚本、配置和模拟故障分支，不能把这些检查写成容器启动成功。

### 初版实施验证（2026-09-28，流程调整前）

- `pnpm test:docker`：7 项通过，包括版本输入、latest 不回退、仓库失败处理、安装包文件名单及真实 Compose 配置解析。
- `pnpm --filter @octopus/cli test`：76 项通过；该作用域的 lint、typecheck 均通过。
- 发布辅助脚本通过 ESLint、Node 语法检查；工作流通过 YAML/schema、内联 Bash 语法及已固定 Action 输入检查；新增文件通过格式检查。
- 在本机 Docker Desktop 的 Linux AMD64 Engine 上，以已发布 npm `0.0.9` 实际构建验证镜像；依赖与原生模块校验通过。
- 使用工作流相同的 `smoke.mjs` 检查版本、平台、运行用户、首次健康启动、Web 首页及强制重建后三个卷的文件保留，全部通过。独立测试容器、网络和卷已清理。
- 尚未执行 GitHub Actions 远程发布或 Docker Hub 推送，也未验证真实旧版本数据升级。需要先提交工作流、配置 Docker Hub 公开仓库和 Secrets，再发布包含这些文件的新版本，确认远程流程及匿名拉取。

### 官方组件调整验证（2026-09-28）

- `pnpm test:docker`：12 项通过，新增 npm 元数据与 tarball 延迟可见、限流及网络故障、等待超时、永久错误处理测试；包含实际 Compose 配置解析。
- 部署脚本 ESLint、Node 语法、Prettier 和 `git diff --check` 通过；工作流通过 YAML/schema、全部内联 Bash 语法、已固定 Docker Action 输入和两次构建参数一致性检查。
- 对公开 npm 的实际检查确认 `dr-octopus@0.0.10` 元数据及 tarball 可访问，基础镜像摘要查询成功。
- Docker Engine 恢复后，以公开 npm `0.0.10` 及固定的 Node 基础镜像摘要完成真实 Linux AMD64 构建。一次导出因 Docker Desktop 重启中断；引擎恢复后重试成功，运行依赖与原生模块校验通过。
- 对本次构建运行 `smoke.mjs`：版本、平台、非 root 用户、首次 Gateway 健康启动、Web 首页，以及强制重建后的 Web 和三个卷文件保留全部通过。隔离测试容器、网络与卷已清理。
- 使用同一 Buildx 构建器和相同参数再次构建，关闭基础镜像刷新并导出为本地 OCI 文件，安装步骤全部命中缓存。导出与已测试镜像的完整 manifest 摘要均为 `sha256:63eec3ed0f9303f5a464661acb9e9cafaf241a2777362c9aa16a08acf50db978`，确认缓存复用及镜像内容一致。临时导出文件已清理，验证镜像和构建缓存保留。
- 未执行 Docker Hub 推送或 GitHub Actions 发布。提交并发布包含改动的新 Release 后，仍需确认远程构建、smoke、官方组件推送、匿名拉取和安装包上传完整通过。

### npm 源名称统一验证（2026-09-28）

- 统一使用 npm 官方的 `NPM_CONFIG_REGISTRY`，移除自定义变量转换；Agent 和 CLI 源码保持原有标准变量读取方式。
- Docker 部署测试 12 项、CLI 测试 76 项、Agent 环境与 Server 扩展安装聚焦测试 4 项通过；扩展安装测试验证子进程使用指定源且不污染 Host 环境。
- Dockerfile 通过 Buildx 配置检查；现有验证镜像中 `npm config get registry` 正确返回显式设置的 `https://registry.npmmirror.com`。部署脚本 ESLint、文档格式和差异检查通过。
- 此次没有重新完整构建或发布镜像；上文完整镜像构建与 smoke 结果属于此前的 Dockerfile 版本。较早自定义变量方案的 Agent 全量测试出现 Memory/Scheduler 超时，未宣称全量通过；该方案的核心改动已移除。
