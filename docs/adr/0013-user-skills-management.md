# ADR-0013: Server 托管的 User Skill 管理

## Status

Accepted（作用域与路由部分由 [ADR-0014](./0014-dual-scope-skills.md) 修订；“管理目录等于 Runtime 完整目录”的假设由 [ADR-0015](./0015-effective-skills-catalog.md) 修订。本文的受管存储、校验与上传管线仍然有效）

## Context

Pi 在 Session 启动时通过 `loadSkills` 从两个默认位置发现 Agent Skills（见 `pi-coding-agent` `core/skills`）：

- User 作用域：`<agentDir>/skills`，其中 `agentDir` 由 `getAgentDir()` 解析。本仓库通过 pnpm patch 将 `piConfig` 品牌化为 `{ name: "Dr_Octopus", configDir: ".dr-octopus" }`，因此 `agentDir` 默认为 `~/.dr-octopus/agent`，可由 `DR_OCTOPUS_CODING_AGENT_DIR` 覆盖。
- Project 作用域：`<workspace cwd>/.dr-octopus/skills`，随每个 Workspace 的工作目录生效。

Skill 遵循 Agent Skills 规范：目录（或单文件）内的 `SKILL.md` 以 frontmatter 声明 `name`（小写字母、数字、单连字符，不超过 64 字符）与 `description`（必填，不超过 1024 字符），可选 `disable-model-invocation`，正文为 Markdown 指令；目录内其余文件为 Skill 资源。

Workbench Header 已预留「技能」菜单但处于 disabled 状态，用户无法在不直接操作用户主目录的情况下管理 User Skills。需要一个 Web 页面与对应的 Server HTTP 能力来完成上传、查看、编辑与删除。

## Decision

1. 首版只管理 User 作用域 Skills（`<agentDir>/skills`）。「技能」是应用级菜单，与 Workspace 无关；Project 作用域 Skills 已可通过 Workspace 文件浏览器直接维护，不重复建设。
2. 文件系统是 Skill 的唯一事实源。Server 直接读写 Pi 运行时加载的同一目录，不引入数据库 Catalog，避免双写一致性问题和 Skill 漂移。运行中的 Session 不做热更新；新启动的 RPC Session 进程自然加载最新 Skills。
3. 新增 `apps/server/src/modules/skills` Module（controller/service/dto/utils），遵循现有 Module 分层。Skill 发现与诊断复用 `@earendil-works/pi-coding-agent` 公开的 `getAgentDir()` 与 `loadSkillsFromDir()`，保证管理面与运行时的发现、校验规则完全一致。
4. HTTP API 挂在 `/api/skills`：
   - `GET /api/skills`：列出 Skill 摘要（名称、描述、调用开关、文件数、体积、更新时间、校验警告）。
   - `GET /api/skills/:name`：返回 `SKILL.md` 全文与资源文件清单。
   - `POST /api/skills`：以结构化字段（name/description/disableModelInvocation/content）创建 Skill，Server 负责生成合法 frontmatter。
   - `PUT /api/skills/:name`：按名称更新描述、调用开关与正文；Skill 名称即目录身份，首版不支持重命名。
   - `DELETE /api/skills/:name`：递归删除 Skill 目录。
   - `POST /api/skills/upload`：Base64 JSON 上传单个 `.md` 文件或 `.zip` 技能包，与 Workspace 文件上传传输方式保持一致；重名时必须显式 `overwrite` 才允许覆盖。
5. 写入前先校验（命名规范、描述必填、大小与文件数上限、zip 路径穿越防护），写入后再次用 Pi Loader 校验；任何失败回滚到写入前状态，保证 Skills 目录不会残留半成品。
6. Web 端在 Workbench 布局下新增 `/skills` 路由与 `features/skills` 功能目录，启用 Header「技能」菜单；页面使用 shadcn/ui 组件与 TanStack Query，遵循 `components/` 与 `features/` 边界约定。

## Consequences

### Positive

- 管理面与运行时读取同一份文件，Skill 的可见性、诊断与 Agent 实际加载结果一致。
- 不引入新的持久化设施，Module 无 Repository，复杂度与 Workspaces Module 相当。
- User Skills 一经上传对所有 Workspace 的新 Session 生效，符合全局菜单的产品语义。
- 上传、编辑均经过与运行时相同的校验规则，坏 Skill 会在管理面暴露警告而不是静默失效。

### Negative

- 已在运行的 Session 不会感知 Skill 变更，用户需要新开会话才能使用新 Skill（页面需给出提示）。
- Server 直接操作用户主目录下的配置目录，必须维持严格的路径与 zip 条目校验。

### Neutral

- 首版不支持 Skill 重命名与 Project 作用域管理，后续可独立追加而不破坏现有 API。
- zip 解包引入 `fflate` 运行时依赖（纯 JS、无原生编译），仅用于有界大小内的内存解压。

## Alternatives Considered

### 在数据库中建立 Skill Catalog

拒绝。Pi 运行时只认文件系统，数据库 Catalog 会形成第二个事实源，删除文件与删除记录必然漂移。

### 首版同时管理 Project 作用域 Skills

暂缓。Project Skills 与具体 Workspace 耦合，而「技能」入口是应用级导航；且 Workspace 文件浏览器已覆盖其文件操作。后续如需引导式管理可独立设计。

### 使用 multipart/form-data 上传

未采用。现有 Workspace 上传与附件暂存均使用 Base64 JSON 传输，保持一致可以减少一种新的请求形状与体积限制配置；Skill 包通常远小于附件，Base64 开销可接受。

### 对运行中的 Session 热更新 Skills

拒绝。Pi 在 Session 启动时加载 Skills 并固化进系统提示，热更新需要替换 runtime 或重新注入上下文，代价远高于「新 Session 生效」的提示成本。

## References

- [ADR-0001: Pi RPC Host 架构](./0001-pi-rpc-host-architecture.md)
- [ADR-0005: 由 Host 按驻留 Session 编排 RPC 子进程](./0005-host-owned-session-runtime-processes.md)
- [ADR-0012: 提取 Server Runtime 内部基础库](./0012-server-runtime-library-boundary.md)
- Agent Skills 规范：<https://agentskills.io/integrate-skills>
