# Dr.Octopus Agent Infra

本目录保存 Dr.Octopus Agent 离线启动所需的基础设施资源。目录内容随 Agent 包一起发布，运行时只读取本地文件，不从网络下载资源。

## 目录结构

```text
infra/
├─ manifest.json   # 离线资源清单及完整性信息
└─ resources/      # 按平台和架构划分的 Agent 工具
```

### `resources`

存放 Pi Agent 使用的平台相关工具。路径格式为：

```text
resources/<platform>-<arch>/bin/<executable>
```

支持的 `platform` 与 Node.js `process.platform` 保持一致，支持的 `arch` 与 `process.arch` 保持一致。当前资源覆盖：

- `darwin-arm64`
- `darwin-x64`
- `linux-arm64`
- `linux-x64`
- `win32-arm64`
- `win32-x64`

## Manifest

`manifest.json` 是本目录的唯一资源清单：

- `resources`：平台相关工具。

通用字段：

| 字段      | 说明                           |
| --------- | ------------------------------ |
| `id`      | 稳定资源标识或 npm 包名        |
| `version` | 发布产物的精确版本             |
| `source`  | 上游发布地址，仅用于审计和更新 |
| `target`  | 相对于 Agent 目录的安装目标    |

平台工具还包含：

| 字段         | 说明                         |
| ------------ | ---------------------------- |
| `platform`   | 目标操作系统                 |
| `arch`       | 目标 CPU 架构                |
| `executable` | 安装后是否需要设置可执行权限 |

运行时必须先选择当前平台资源并验证 SHA-256，再执行复制。文件缺失、哈希不匹配、扩展版本不一致均应终止 Agent 启动，禁止静默降级或联网下载。

## 运行时约束

- 安装结果提供包含 `PI_OFFLINE=true` 和工具 `PATH` 的 Worker 环境变量。
- 安装过程应幂等，并在全部资源成功安装后原子发布安装状态。
