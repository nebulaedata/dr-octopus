# Environment loader

`@octopus/env-loader` 是不依赖 Host 或 Pi 的 Node SDK。它只负责环境文件读写、分层合并和来源查询；目录选择、允许修改的变量及业务校验由调用方提供。

```ts
import { createEnvironmentStore } from '@octopus/env-loader';

const store = createEnvironmentStore({
  path: '/absolute/user-data/environment.json',
  environment: process.env,
  defaults: { LOG_LEVEL: 'info' },
});
const snapshot = store.load();
store.get('LOG_LEVEL');
store.source('LOG_LEVEL');
await store.update(snapshot.revision, { LOG_LEVEL: 'warn' });
await store.update(store.load().revision, { LOG_LEVEL: null }); // 删除文件中的覆盖值
```

优先级为 `overrides > environment > dotenvPath > environment.json > defaults`。`environment` 默认取当前进程；store 创建时复制高优先级输入，避免后续全局环境修改改变其行为。可选 `dotenvPath` 必须显式传入绝对路径，不会从 cwd 自动发现文件。空字符串是显式值；业务层可进一步将其解释为默认值。读取返回不可变快照，SDK 不修改 `process.env`。

JSON 为扁平字符串对象，不支持嵌套、数字值、变量插值或命令执行。缺失文件等价于空配置；非法 JSON、权限错误和过大文件明确报错。每个文件最多 256 项，值最多 8192 字符，文件最多 1 MiB；变量名不得仅大小写不同，以便跨平台使用。

更新只保存 patch，不持久化默认值或进程环境。SHA-256 revision 检查位于独占文件锁内，临时文件完成同步后原子替换。所有 SDK 写入者遵循相同锁；外部编辑器不遵循锁，因此不要同时手动编辑。文件以 `0600`、目录以 `0700` 创建，Windows 权限仍由 ACL 决定。遇到 `ENV_BUSY` 不会抢占锁；若写入进程异常退出，管理员确认写入者已退出后可移除对应 `environment.json.lock`。不自动按文件年龄删除锁。

`validate` 在读取和写入时检查持久化值，防止高优先级配置掩盖非法文件值。错误不包含文件内容；业务 validator 也应遵守这一约定。SDK 的原始快照可能包含凭据，禁止直接通过 HTTP、日志或诊断页面暴露。

## Dr.Octopus 接入

- Server：`<SERVER_DATA_DIR>/environment.json`，默认 `~/.dr-octopus/server/environment.json`。
- Agent：`<DR_OCTOPUS_CODING_AGENT_DIR>/environment.json`，默认 `~/.dr-octopus/agent/environment.json`。
- 两个目录独立解析，禁止在 JSON 中修改配置文件自身的位置。
- Server 支持其配置模块定义的变量；Agent 支持大写名称的自定义变量，保留目录、Server 变量和内部进程控制变量。
- 开发脚本通过 Node 的 env-file 参数加载仓库 `.env`，因此 Settings 将此来源显示为“进程环境 / .env”。发布入口不自动读取 `.env`，npm 产物不包含它。
- Server 使用快照解析业务配置，不把 JSON/defaults 写入全局进程环境。Agent 的专用 CLI 进程在导入 Pi 前加载自己的 JSON。
- 修改 Server 配置后重启 Server/Gateway；新的 Agent 进程读取最新文件，已有 Agent 和继承了旧环境的 Scheduler 需要重启。
- Settings 展示下次加载的配置来源，不声称实时进程已经应用了修改。自定义 Agent 值仅允许替换和删除，API 不回显内容。
- `VITE_*` 在 `apps/web/.env*` 中独立管理，是 Web 构建时参数，不属于这些服务端运行时文件；修改后需要重新构建并部署。
