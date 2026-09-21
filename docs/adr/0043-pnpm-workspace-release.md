# ADR-0043: 使用原始 workspace 元数据交付可安装的发布目录

## Status

发布外层格式与清单生成方式已由 [ADR-0046](./0046-configured-npm-bootstrap.md) 取代。以下保留历史决策，内部原始 workspace、锁文件和补丁交付原则继续沿用。

Accepted — 2026-09-09。用户确认采用本方案并要求清理旧配置。发布组装与安装逻辑已调整为原始 workspace 目录交付，验证结果记录于下文。

本提案替换 ADR-0042 中的发布组装方式；Gateway、Scheduler 和依赖安装命令的业务职责保持原有设计。

## Context

现有 release.mjs 除构建之外，还手工生成内部包 manifest、解析已安装版本、生成独立 dependencies、指定补丁版本、编写 workspace YAML、重建锁文件及维护资源清单。这些信息与 package.json、pnpm-workspace.yaml 和 pnpm-lock.yaml 重复，项目变化时容易遗漏。

约束：发布物不含 node_modules；目标平台安装原生依赖；内部包仍为 private；保留补丁和锁定版本；发布流程以 pnpm 命令和文件拷贝为主。

## Decision

### 1. 交付保留目录关系的 workspace

仓库内输出目录为根目录 `release/`，临时组装目录为根目录 `.release-*`，统一通过根 .gitignore 排除。CLI、Server 和 Web 是同一项目发布物的组成部分，不再把最终发布目录放进 apps/cli。

根 package.json 通过 `bin: { "octopus": "./apps/cli/dist/cli.mjs" }` 注册对外命令。复制到 release 后映射仍有效；CLI 继续保留包内 bin。发布入口检查以根 bin 为准。源码根包仍为 private；2026-09-10 补充：产物根 package.json 按需规范化发布字段，此变更不等于完成 npm registry 分发；私有依赖、锁文件/补丁交付和全局安装目录写权限属于后续设计。

发布物是只携带运行产物的 workspace 目录。直接复制根 package.json、pnpm-workspace.yaml、pnpm-lock.yaml，以及所有 workspace package 的原始 package.json，保持相对路径。编译产物整目录复制。

2026-09-10 经用户确认，根 manifest 复制完成后仅校验并修正 `private`、`files`：`private` 为 false 或缺省时保留，其他值替换为 false；`files` 精确匹配实际复制的包 manifest、dist 目录、workspace 配置与补丁，顺序不限，不符合时替换。两个字段均合格则保留整个文件的原始字节。根 package.json 由 npm 自动包含，pnpm-lock.yaml 由 npm 强制排除，二者不加入该列表。源码 manifest、内部包 manifest、依赖和锁文件不改写；锁文件与 `octopus deps install` 的后续 npm 分发方案另行讨论。

```text
release/
  package.json
  pnpm-workspace.yaml
  pnpm-lock.yaml
  patches/
  apps/
    cli/package.json + dist/
    server/package.json + dist/
    web/package.json + dist/
  packages/
    agent/package.json + dist/
    shared/package.json + dist/
    ui/package.json
```

这是当前项目的示意布局，不是 release 脚本中的包名单。由 pnpm 的 workspace 列举结果发现 package 路径，复制原始清单及已有 dist。保留其他 workspace 的清单以维持原锁文件的 importer 结构；它们不因此成为目标机器的安装根。

不复制源码、开发机 node_modules、.env 或凭据配置。若未来存在 dist 之外的运行资源，由所属 package 的构建任务将其纳入产物，不在 release 脚本逐个补文件名。

workspace 引用和安装后指向发布目录内部的链接是合法的。禁止的是指向原仓库或开发机目录的依赖，不能再通过搜索 workspace:/link: 字符串一律拒绝。

### 2. package.json 表达真实依赖，pnpm 处理依赖图

apps/cli 声明其运行时使用的 Server、Agent 等 workspace dependencies；直接使用的依赖仍由使用者声明。Web 构建属于构建任务关系，不因此成为 CLI 的运行依赖。

构建调用现有 package build，由任务图处理依赖顺序。迁移、infra、Worker 和 Web 资源的产物责任回到所属构建任务。发布脚本不再分别调用 tsc、Vite、tsdown 的内部命令，也不枚举 agent/shared 的构建顺序。

目标机器由 CLI 在发布 workspace 根目录调用：

```sh
pnpm --filter-prod '@octopus/cli...' install --prod --frozen-lockfile
```

此命令以完成依赖声明调整为前提。实施时验证当前 pnpm 版本的过滤安装、生命周期和原生模块行为；不把单独的根目录 pnpm install --prod 当作等价命令，因为它会覆盖其他 workspace 项目。

版本仅由原始声明和提交的锁文件决定。删除 installedVersion、packInternal、shared override 和生成独立锁文件的逻辑。

### 3. 原配置和补丁直接交付

pnpm-workspace.yaml 原样复制；补丁从其中 patchedDependencies 声明的路径读取并按原相对路径复制，不硬编码 patchName 或版本。保留原有 allowBuilds 等安装配置。

任何新增的本地配置引用也必须在发布目录内成立；缺失时构建失败，不通过模板生成替代配置。

根 postinstall 的开发技能链接已移除，需要时显式运行 pnpm skills:link。这个调整发生在仓库配置中，发布脚本不改写 scripts，也不使用 --ignore-scripts 绕过全部依赖构建。

### 4. 发布脚本仅编排与拷贝

```mermaid
flowchart LR
    A[原始 workspace 与锁文件] --> B[pnpm 调用构建任务]
    B --> C[复制原始元数据、补丁和完整产物目录]
    C --> D[仓库外安装与运行验证]
    D --> E[交付无 node_modules 的 workspace 目录]
    E --> F[目标机器 pnpm 冻结安装]
```

组装写入独立 staging，成功后交付；保留发布目录占用检查和限定目录的清理保护。验证安装使用另一份临时副本，避免把 node_modules 带进交付物。

需要压缩文件时，使用普通归档工具整体压缩该目录。pnpm pack 是单个 npm package 的打包工具，不作为整个 workspace 的归档器：它会转换该包的 workspace 依赖，也不会自动附带完整私有依赖图。本机 pnpm 11.18.0 的最小 dry-run 验证还表明，显式列入 files 的 pnpm-lock.yaml 仍未进入包内。

因此，不承诺用一个 pnpm pack 命令同时生成无 node_modules、带原锁文件、带私有 workspace 的完整应用安装包。若必须提供这种单命令体验，应由根 release 命令封装上述工具编排，而不是重建包管理逻辑。

### 5. 更新路径和验证契约

CLI 从自身安装位置确定 workspace 根和 Server 入口，Agent SDK 从声明该依赖的 package 上下文解析；取消假定所有依赖都位于 release/node_modules 的验证方式。

普通 Web build 的 Vite 缓存使用包相对路径。复制 Web package.json 与完整 dist 后可直接使用；Server 静态托管边界在内存中兼容 Windows 的路径分隔符，release 脚本不再重写 Vite 配置字段。

移除 octopusRelease.resources 手工文件列表及相应安装前置协议。保留面向真实入口的运行检查：CLI 无依赖时可执行安装/诊断、Server 启动、Web 页面、迁移、Worker、Agent RPC/Scheduler 和原生模块。各 package 的资源完整性由构建及相关集成验证负责。

## Consequences

- 依赖、补丁、版本、构建方式各自只在原配置中维护一次。
- 新增 workspace package 由 pnpm 发现；原目录关系和原锁文件保持一致，无需维护 vendor tarball 映射。
- 交付目录保留 workspace 层次和额外开发清单/锁记录，接受少量元数据冗余以减少发布逻辑。
- 根开发安装生命周期需要调整；CLI 的路径和依赖验证需要适配，不能只替换 release.mjs。
- 构建先形成各包 dist 再复制，替代 ADR-0042 的直接写入最终 release 目录策略。
- 不需要为了该方案修改 packages/agent；使用其现有 build 和 dist。任何未来必要的 Agent 改动仍须单独确认。

## Alternatives Considered

- pnpm deploy：适合带生产 node_modules 的可运行目录，与本次确认的目标机器安装要求不匹配，不选作默认交付方式。
- 逐包 pnpm pack 加私有包路径改写：仍需组合 tarball、安装清单、补丁与锁文件，会继续维护一套依赖转换规则，不选。
- 自行裁剪 workspace 清单和锁文件：增加依赖图处理代码；本次优先原样复制元数据，不追求最小清单。

## Validation

- 根目录输出与 bin 调整后，pnpm release 在仓库根目录生成 release，根 manifest 原样复制并保留命令映射，旧 apps/cli/release 已移出仓库。CLI 5 项测试、lint 和类型检查通过，包含目标目录尚不存在时的 Scheduler 占用检查。在隔离 npm prefix 中离线安装本地 release，生成的 octopus 命令可执行 --help；此检查仅验证命令映射，不代表 npm registry 发布验收。

- Windows / Node 24.20.0 / pnpm 11.18.0：pnpm release 成功，保留原始元数据与锁文件；交付目录的 2464 个文件/目录条目不含 node_modules、.env 或软链接。
- 在仓库外含空格的路径、独立空 pnpm store 中，通过发布 CLI 冻结安装成功。pnpm 选择 4/7 个 workspace、安装 551 个生产依赖；Web/UI 未生成 node_modules。SQLite 从源码编译成功，Sharp、Canvas、Koffi 和 Pino pretty 加载验证通过。
- 比对根安装元数据和运行包 manifest，构建拷贝及目标安装均未改写原文件；Server 的 Agent 链接解析到发布目录自身的 packages/agent。
- 真实发布运行检查通过：Gateway 后台启动、单实例互斥、重启继承日志开关、页面与深链、受保护路径 404、SSE/WebSocket、Agent RPC get_state、infra、JSONL、附件 Worker，以及 Gateway 停止后 Scheduler 独立存活。扩展安装使用不可达测试 registry，验证离线告警，不发起模型调用。
- CLI 4 项、Server 225 项、Web 83 项测试通过；静态托管适配修改后另跑 2 项对应回归。相关 lint、TypeScript 检查通过。
- 新包、新版本补丁、嵌套资源、缺失补丁及路径边界由确定性拷贝测试覆盖；未另建真实 registry 发布分支。
- 初次使用过深临时路径时遇到 Windows MSBuild 原生编译失败；改用较短的含空格路径后成功。Linux/macOS 的安装运行仍需在对应系统验收，Windows 测试不能代替跨平台验收。

## References

- [pnpm workspace 协议与 pack 转换](https://pnpm.io/workspaces)
- [pnpm deploy](https://pnpm.io/cli/deploy)
- [pnpm pack](https://pnpm.io/cli/pack)
- [pnpm install](https://pnpm.io/cli/install)
- [ADR-0042](./0042-cli-managed-gateway-distribution.md)
