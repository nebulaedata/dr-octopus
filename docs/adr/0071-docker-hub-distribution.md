# ADR-0071: 本地发布 npm，GitHub Actions 构建 Docker Hub 成品镜像

## 状态

Accepted — 2026-09-28。

## 背景

现有部署要求每台服务器从 npm 构建镜像；国际和内部 Harbor 配置重复，用户需要处理构建工具与多个下载源。现有 npm 发布脚本已经完成本地构建、npm 发布和 GitHub Release 创建。

## 决策

保留本地 npm 发布流程，以 GitHub Release published 事件触发远程镜像构建、验证及 Docker Hub 发布。用户只使用 Compose 拉取成品镜像。仅维护 `nebulaedata01/dr-octopus` 一个公开镜像仓库（GitHub 仓库仍为 `nebulaedata/dr-octopus`），首期 Linux AMD64；精确标签不覆盖，镜像修订显式编号，稳定 `latest` 不回退。公开 Dockerfile 和部署配置，凭据使用 Actions Secrets。

## 后果与取舍

构建及版本镜像推送优先使用 Docker 官方 Action，按官方“先测试、后复用缓存推送”的方式执行。自定义脚本仅承担 npm 上架等待、容器验证、版本保护和安装文件准备；`latest` 的更新由工作流中的标准 Docker 命令执行。新构建最多等待 npm 公开可下载 15 分钟，超时后保留原 Release，等待上架后手动重跑。

- 用户无需在服务器构建，也无需安装 Node.js 或 pnpm；维护者本地无需 Docker。
- 公开构建定义便于社区检查和复现，保留现有数据卷与 npm 发行契约。
- npm 成功与 Docker 就绪是两个状态；镜像发布失败独立重试，以安装包和 Actions 结果显示就绪。
- 依赖 Docker Hub、GitHub Actions 及首次扩展下载的网络，不承诺离线安装。
- 相比本地推送镜像，远程构建增加工作流维护，但减少维护者平台差异；相比全远程 npm 发布，保留既有流程可减少本次改造范围。
- 不维护国内仓库、不引入 Kubernetes、不改变共享 Agent 核心。

## 实施契约

见[通俗设计与执行步骤表格](../architecture/docker-distribution.md)及[安装说明](../../deploy/docker/README.zh-CN.md)。
