# Dr.Octopus Permission System 模块设计文档

> 2026-09-11 实施补充：[ADR-0049：统一声明式权限配置与 Settings](../adr/0049-declarative-permission-configuration.md) 优先于本文历史方案。默认策略和工具解释规则统一存入 permission-system.json；Settings 支持全局与工作区覆盖；每次调用前重载；非法配置阻止执行；显式 ask 在 full 模式仍需确认；缺失范围时不提供会话授权。

> 2026-09-06 实施补充：[定时任务持久授权](./scheduled-task-authorization.md)、[ADR-0039](../adr/0039-scheduled-task-durable-authorization.md)。已新增独立于进程 PermissionMode 的任务持久 grant；唯一门禁及交互模式不落盘的基线保持不变。

> 用途：指导智能体实现 Dr.Octopus 内置权限系统。  
> 基线：权限门禁作为 Dr.Octopus Agent Runtime 的内置 `InlineExtension`，只使用 Pi 公开 API。  
> 核心目标：打通 `PermissionSelect`、WebSocket、Server Runtime、Pi JSONL RPC 与 Agent 权限门禁的 `ask | auto | full` 三档进程级链路。
>
> **2026-08-29 实施决策（优先于本文后续历史方案）：** 当前版本不读取、改写、迁移或删除任何 `pi-subagents` 配置，也不处理其 `permissions.rules` 或 Agent frontmatter。本文后续所有自动 `ensurePiSubagentsNativePermissionsDisabled()`、配置写回和 child forwarding 章节均已放弃，不属于本次实现范围，待独立方案重新评审。`PermissionSelect` 的现有展示文案保持不变。内置权限系统是唯一审批权威；产品发布基线不包含 `@gotgenes/pi-permission-system`，运行时代码不执行旧数据迁移，也不改写用户 `settings.json`。

## 当前实施链路

```text
PermissionSelect
  -> agent.set-permission-mode（WebSocket，runtimeId + epoch fencing）
  -> ChannelService / SessionsService / RuntimeCommands
  -> Runtime Permission Control（Server 构造 /permission-mode <mode>）
  -> AgentRpcProcess.execute（Pi JSONL RPC prompt）
  -> pi.registerCommand('permission-mode') handler
  -> PermissionModeService（与内置 InlineExtension 共享实例）
  -> tool_call / user_bash 门禁
  -> ctx.ui.select / input（ask 时复用现有 Extension UI RPC）
  -> Permission Review JSONL（所有终态决策与 gate_error）
```

- `PermissionStateDto` 随 Session bootstrap/snapshot 返回，命令成功后随 `command.ack` 权威回读。
- 权限状态只属于 Agent process generation，不写数据库、Session JSONL 或 Pi 配置；新进程固定恢复为 `ask`。
- 进程恢复时 Server 和 Web 同时清理旧 generation 的 pending Extension UI，避免把审批结果发送给新进程。
- 权限切换复用 Pi JSONL RPC 的 `prompt` 命令和扩展 slash command 入口。`AgentRpcProcess` 只维护已有的 `pendingRequests`，负责请求关联、超时、写入失败和进程代际隔离，不增加 Permission 分支或第二套 IPC。
- Server Runtime 在 slash command RPC 成功后更新当前 generation 的权限镜像；该镜像用于 bootstrap、snapshot 和 command ack，新进程固定从 `ask` 开始。
- `ask` 保留原权限项目的四种决策：单次允许、本会话允许、拒绝、拒绝并说明原因；本会话规则只保存在内存中，Session 关闭即清除。
- 默认扩展安装列表和发布配置不包含第三方 `@gotgenes/pi-permission-system`。
- 产品尚未发布，不提供旧权限扩展迁移逻辑，Agent 启动不会为此读取或改写用户 `settings.json`。
- `auto` 使用精确工具名规则；默认自动批准 `ask_user_question`、`plan_mode_question`、`plan_mode_complete`、`subagent` 和 `bg_wait`，未知第三方工具仍为 `ask`。Plan 工具只跳过权限确认，其自身的问答和方案就绪交互仍照常展示。
- 配置优先级为 Builtin Defaults → Global Config → Trusted Project Config；显式 `deny`、敏感输入和 `auto` 下的外部路径不会被工具 allowlist 绕过。
- Permission Review Log 默认开启，只记录真实的 `permission_request.*` 权限请求转换。每个 Agent 进程独占 `<octopusRoot>/permission-system/logs/permission-review.<startedAt>-<pid>-<instanceId>.<segment>.jsonl` 分片；单段达到 5 MiB 后切换到下一编号分段，不共享写入文件，也不记录 Session 或配置生命周期事件。当 `<agentDir>` 为 `~/.dr-octopus/agent` 时，`<octopusRoot>` 即 `~/.dr-octopus`。每条记录包含 requestId、Session、模式、工具、请求摘要、决策来源和 resolution；敏感键遮罩后以 JSONL 写入。已关闭分段最多保留 4 个且总计不超过 20 MiB，存活进程各自最新的活动分段不参与历史清理。
- Agent 通过内置只读工具 `permission_audit_query` 查询 Review Log，不直接接收日志路径或任意文件读取能力。工具支持 `requestId`、`sessionId`、`toolName`、`resolution`、`event`、`since` 精确筛选，默认返回最新 20 条、最多 100 条；损坏行跳过并计数，结果按时间顺序返回。该查询工具默认静态 allow，查询动作本身仍由门禁记录，管理员可用显式工具策略改为 `ask` 或 `deny`。

当前支持的配置形状：

```json
{
  "permissionReviewLog": true,
  "reviewLogFieldMaxWidth": 1000,
  "policy": {
    "tools": {
      "dangerous_tool": "deny"
    }
  },
  "modes": {
    "auto": {
      "tools": {
        "ask_user_question": "allow",
        "subagent": "allow",
        "bg_wait": "allow",
        "custom_safe_tool": "allow"
      }
    }
  }
}
```

---

## 1. 背景

Dr.Octopus 基于 Pi Coding Agent Runtime 构建，并通过 Pi RPC 向 Web 提供智能体能力。

权限系统以：

```text
epheien/pi-permission-system
```

为基础，将源码复制并内置到：

```text
packages/agent/src/extensions/permission-system
```

从此不再把它当作第三方 Extension 安装，而是作为 Dr.Octopus Agent Runtime 的内置基础能力维护。

Permission System 需要覆盖：

- Root Agent
- Pi Tools
- Bash
- MCP
- 文件访问
- 外部目录访问
- Web 用户批准
- Runtime PermissionMode

---

# 2. 核心设计原则

## 2.1 PermissionMode

统一定义：

```ts
export type PermissionMode = 'ask' | 'auto' | 'full';
```

三种模式：

| Mode   | 行为                                         |
| ------ | -------------------------------------------- |
| `ask`  | 所有最终为 `ask` 的请求进入用户审批          |
| `auto` | 普通文件修改自动批准，危险操作继续 `ask`     |
| `full` | 所有最终为 `ask` 的操作自动批准              |
| `deny` | 静态策略明确拒绝的操作，任何 Mode 都不能突破 |

权限优先级：

```text
deny
  >
PermissionMode
```

即：

```text
allow -> allow
deny  -> deny
ask   -> PermissionMode 再决定
```

`full` 不得把 `deny` 提升成 `allow`。

---

# 3. 非目标

Permission System 不负责：

- Subagent 调度
- Subagent 生命周期编排
- Tool Visibility
- Worktree
- Workflow
- Chain
- Watchdog
- Mission
- Agent orchestration

这些继续由：

```text
nicobailon/pi-subagents
```

负责。

职责边界：

```text
nicobailon/pi-subagents
        ↓
Capability / Tool Visibility
        ↓
“这个 Agent 有没有这个 Tool”


Dr.Octopus Permission System
        ↓
Runtime Authority
        ↓
“这个 Tool 当前允不允许执行”
```

---

# 4. 总体架构

```text
                         apps/web
                            │
                            │
                    Permission Mode
                  ask / auto / full
                            │
                            ▼
                       apps/server
                            │
              Pi JSONL RPC / Slash Command
                            │
                            ▼
                   Dr.Octopus Agent
                            │
                  Permission System
                            │
         ┌──────────────────┼──────────────────┐
         │                  │                  │
       Tools              Bash                MCP
         │                  │                  │
         └──────────────────┼──────────────────┘
                            │
                      Static Policy
                            │
                   allow / ask / deny
                            │
                    if result = ask
                            │
                    Permission Mode
                  ┌─────────┼─────────┐
                  │         │         │
                 ask       auto      full
                  │         │         │
                 ask    selective    allow
                           allow
```

Subagent：

```text
nicobailon/pi-subagents
        │
        │ tools:
        ▼
   Tool Visibility
        │
        ▼
Child Dr.Octopus Process
        │
        ▼
 Permission System
        │
        ├── allow
        ├── deny
        │
        └── ask
             │
             ▼
       ParentAuthorizer
             │
             ▼
       Parent Session
             │
             ▼
      Parent PermissionMode
```

---

# 5. 推荐目录

第一阶段应尽量保持 upstream 原始目录，避免“移植 + 重构”同时进行。

稳定以后逐步收敛为：

```text
packages/agent/src/extensions/permission-system/
│
├── index.ts
├── types.ts
│
├── runtime/
│   └── permission-mode.ts
│
├── config/
│   ├── paths.ts
│   ├── loader.ts
│   ├── schema.ts
│   └── store.ts
│
├── policy/
│   ├── resolver.ts
│   ├── mode-policy.ts
│   └── rule.ts
│
├── gates/
│   ├── tool-gate.ts
│   ├── bash-gate.ts
│   ├── mcp-gate.ts
│   └── path-gate.ts
│
├── authority/
│   ├── local-user-authorizer.ts
│   ├── parent-authorizer.ts
│   ├── forwarding-manager.ts
│   ├── forwarded-request-server.ts
│   └── forwarding-io.ts
│
├── subagent/
│   ├── context.ts
│   └── forwarding.ts
│
├── compat/
│   └── pi-subagents.ts
│
├── ui/
│   ├── permission-prompt.ts
│   └── permission-events.ts
│
└── tests/
```

---

# 6. PermissionMode 状态模型

## 6.1 删除 YOLO Boolean

废弃：

```ts
yoloMode: boolean;
```

以及：

```ts
toggleYoloMode();
```

统一改成：

```ts
export type PermissionMode = 'ask' | 'auto' | 'full';
```

提供幂等接口：

```ts
export interface PermissionModeService {
  get(): PermissionMode;

  set(mode: PermissionMode): PermissionMode;
}
```

Web 传递的是目标状态，因此禁止设计为：

```ts
toggle();
```

---

# 7. PermissionMode 生命周期

PermissionMode 为：

```text
Process Global
+
Process Lifetime
```

不是：

```text
Session Local
```

使用：

```ts
globalThis + Symbol.for();
```

保存。

示例：

```ts
const PERMISSION_MODE_KEY = Symbol.for('@dr-octopus/permission-system:mode');
```

读取：

```ts
export function getPermissionMode(): PermissionMode {
  const value = (globalThis as Record<symbol, unknown>)[PERMISSION_MODE_KEY];

  if (value === 'ask' || value === 'auto' || value === 'full') {
    return value;
  }

  return 'ask';
}
```

写入：

```ts
export function setPermissionMode(mode: PermissionMode): PermissionMode {
  (globalThis as Record<symbol, unknown>)[PERMISSION_MODE_KEY] = mode;

  return mode;
}
```

生命周期：

```text
Process Start
    ↓
ask

Session A
Session B
Session Switch
/reload
Agent Turn
    ↓
保持当前 mode

Process Exit
    ↓
销毁

Next Process
    ↓
ask
```

---

# 8. PermissionMode 不落盘

必须严格区分：

```text
Static Policy
```

与：

```text
Runtime PermissionMode
```

所以：

```text
permission-system.json
```

中不得保存：

```json
{
  "permissionMode": "full"
}
```

也不得继续保留：

```json
{
  "yoloMode": true
}
```

PermissionMode 唯一来源：

```text
globalThis runtime state
```

---

# 9. 权限决策流程

Static Policy 首先正常解析：

```text
allow
ask
deny
```

只有：

```text
ask
```

进入 PermissionMode。

```text
Policy Resolver
      │
      ▼
 allow / ask / deny
      │
      ├── allow ──────────► ALLOW
      │
      ├── deny ───────────► DENY
      │
      └── ask
           │
           ▼
      PermissionMode
```

推荐实现：

```ts
function applyPermissionMode(decision: PermissionDecision, surface: PermissionSurface): PermissionDecision {
  if (decision !== 'ask') {
    return decision;
  }

  const mode = getPermissionMode();

  if (mode === 'ask') {
    return 'ask';
  }

  if (mode === 'full') {
    return 'allow';
  }

  if (mode === 'auto' && isAutoAllowedSurface(surface)) {
    return 'allow';
  }

  return 'ask';
}
```

---

# 10. Auto 模式

第一版保持简单。

```ts
const AUTO_ALLOW_SURFACES = new Set(['write', 'edit']);
```

以下读取能力直接在 Static Policy 中允许：

```text
read
grep
find
ls
```

行为：

### ask

```text
write -> ask
edit  -> ask
bash  -> ask
mcp   -> ask
```

### auto

```text
write -> allow
edit  -> allow
ask_user_question -> allow
plan_mode_question -> allow
plan_mode_complete -> allow
subagent -> allow
bg_wait -> allow
ctx_batch_execute (shell) -> allow
ctx_doctor (read) -> allow
ctx_execute (shell) -> allow
ctx_execute_file (shell) -> allow
ctx_fetch_and_index (write) -> allow
ctx_index (write) -> allow
ctx_insight -> allow
ctx_purge (write) -> allow
ctx_search (read) -> allow
ctx_stats (read) -> allow
ctx_upgrade -> allow

bash  -> ask
mcp   -> ask
unknown custom tool -> ask
```

`modes.auto.tools` 可以按精确工具名配置 `allow | ask | deny`。工具规则只作用于
`auto` 模式，且不能越过敏感输入、显式静态 `deny` 或外部目录边界。
context-mode 当前发布的 11 个 `ctx_*` 工具使用精确名称加入内置 auto allowlist；不使用
前缀通配，以免未来新增工具未经审查就继承批准。

`ctx_execute` / `ctx_execute_file` / `ctx_batch_execute` 按 `shell` 能力类归类，与内置
shell 工具同等对待（子进程执行代码、继承 CLI 凭证）。无人值守执行不授予 `ctx_upgrade`：自我更新会改变
工具身份并使 grant 失效，预检目录不展示，含它的 grant 按 `SCHEDULE_AUTHORIZATION_STALE`
拒绝，详见 scheduled-task-authorization。

工具分类按向调用者开放的能力区分：信息查询为 `read`，明确的持久数据变更为 `write`，
任意命令或代码执行为 `shell`，交互、委派和流程控制为 `custom`。
`ctx_search`、`ctx_stats`、`ctx_doctor` 和 `fetch_content` 归为读取；缓存与固定自检
不单独改变分类。`ctx_index`、`ctx_fetch_and_index` 和 `ctx_purge` 归为写入，
因为索引持久化或删除是其明确功能。上述读取工具在 ask 模式下默认允许，写入工具默认询问；
auto 模式继续由已有精确工具规则允许。`fetch_content` 的分类依据 pi-web-access 0.29.0，
该扩展未锁定版本，升级时需复核完整能力。

### full

```text
write -> allow
edit  -> allow
bash  -> allow
mcp   -> allow
```

Hard Deny 始终保持：

```text
.env
~/.ssh/*
explicit dangerous rule
```

---

# 11. Decision Source

删除 upstream：

```text
yolo
```

建议统一：

```ts
export type PermissionDecisionSource =
  'builtin' | 'global' | 'project' | 'agent' | 'session' | 'mode:auto' | 'mode:full' | 'fail-closed';
```

例如：

```json
{
  "permission": "allow",
  "source": "mode:auto"
}
```

Web 后续可以展示：

```text
Allowed by policy
Auto approved
Full access
Denied by policy
```

---

# 12. 配置路径

Permission System 内部不得写死：

```text
.pi
.dr-octopus
octopus
Dr.Octopus
```

路径由 Host 注入。

## Global

```text
<agentDir>/permission-system.json
```

例如：

```text
~/.dr-octopus/agent/
└── permission-system.json
```

## Project

```text
<cwd>/<configDir>/permission-system.json
```

例如：

```text
project/
└── .octopus/
    └── permission-system.json
```

实际目录由：

```ts
configDir;
```

决定。

---

# 13. PermissionSystemOptions

```ts
export interface PermissionSystemOptions {
  agentDir: string;
  configDir: string;
  packageDir?: string;
}
```

创建：

```ts
createPermissionSystem({
  agentDir,
  configDir,
  packageDir,
});
```

职责：

```text
Dr.Octopus Core
       │
       ├── resolve agentDir
       ├── resolve configDir
       └── resolve packageDir
               │
               ▼
        Permission System
```

Permission System 本身禁止重新猜产品名称和路径。

---

# 14. Config Paths

建议：

```ts
const CONFIG_FILENAME = 'permission-system.json';

export function getGlobalConfigPath(agentDir: string): string {
  return join(agentDir, CONFIG_FILENAME);
}

export function getProjectConfigPath(cwd: string, configDir: string): string {
  return join(cwd, configDir, CONFIG_FILENAME);
}
```

---

# 15. Static Policy 示例

Global：

```json
{
  "permission": {
    "*": "ask",

    "read": "allow",
    "grep": "allow",
    "find": "allow",
    "ls": "allow",

    "write": "ask",
    "edit": "ask",

    "bash": {
      "*": "ask",
      "rm -rf *": "deny"
    },

    "mcp": {
      "*": "ask"
    },

    "path": {
      "*": "allow",
      "*.env": "deny",
      "*.env.*": "deny",
      "*.env.example": "allow"
    },

    "external_directory": "ask"
  }
}
```

---

# 16. 配置优先级

保留 upstream 成熟的 Scope Merge：

```text
Builtin
   ↓
Global
   ↓
Project
   ↓
Agent
   ↓
Session Approval
```

Project：

```text
override Global
```

对于 untrusted project：

```text
不加载 Project Permission Config
```

Invalid config：

```text
fail closed
```

禁止自动 fallback 到 allow。

---

# 17. Agent Frontmatter

`nicobailon/pi-subagents` 自己会使用：

```yaml
permission:
```

和：

```yaml
permissions:
```

作为它的 native permission 配置。

因此 Dr.Octopus Permission System 禁止复用这两个 key。

统一使用：

```yaml
permissionPolicy:
```

例如：

```yaml
---
name: worker

tools:
  - read
  - write
  - edit
  - bash

permissionPolicy:
  '*': ask
  read: allow
  write: ask
  edit: ask
  bash:
    '*': ask
---
```

职责：

```text
tools:
    ↓
nicobailon/pi-subagents


permissionPolicy:
    ↓
Dr.Octopus Permission System
```

---

# 18. nicobailon/pi-subagents 集成原则（已放弃，保留为历史备选）

继续使用 `nicobailon/pi-subagents` 负责：

```text
Subagent
Workflow
Chain
Worktree
Tool visibility
Child process
Watchdog
```

但 native：

```text
permissions.rules
```

必须关闭。

原因：

- native `ask` 不是 Web 用户审批
- native `ask` 由 Child Watchdog AI Arbiter 决定
- native permission 不覆盖 Bash
- 同时启用会形成双 Runtime Gate

Dr.Octopus 必须保证：

```text
一个 Runtime
一个 Permission Authority
```

---

# 19. 自动 Ensure 关闭 native permissions.rules

Permission System 创建阶段执行：

```ts
ensurePiSubagentsNativePermissionsDisabled();
```

这是 ensure 操作：

```text
detect
↓
already disabled?
    ↓ yes
    no-op

enabled?
    ↓
disable

invalid / cannot guarantee?
    ↓
fail fast
```

必须满足：

- 幂等
- 无变化时零写入
- 不删除其它 pi-subagents 配置
- 修改前备份
- 原子写
- Root Process 执行
- Child Process 跳过
- 无法保证关闭时 fail fast

---

# 20. pi-subagents Config Path

统一通过当前 Dr.Octopus：

```ts
agentDir;
```

解析：

```ts
function getPiSubagentsConfigPath(agentDir: string) {
  return join(agentDir, 'extensions', 'subagent', 'config.json');
}
```

即：

```text
<agentDir>/extensions/subagent/config.json
```

Permission System 和 pi-subagents 必须使用同一个 `agentDir`。

---

# 21. Ensure 返回值

```ts
export interface EnsureNativePermissionsResult {
  status: 'not-configured' | 'already-disabled' | 'disabled' | 'skipped-child';

  configPath: string;

  removedRules: number;
}
```

---

# 22. Ensure 流程

```text
ensure()
   │
   ├── is child process?
   │       ↓
   │   skipped-child
   │
   ├── config 不存在
   │       ↓
   │   not-configured
   │
   ├── 读取 JSON
   │
   ├── 验证 root object
   │
   ├── permissions.rules 不存在
   │       ↓
   │   already-disabled
   │
   └── permissions.rules 存在
           ↓
       创建 backup
           ↓
       删除 rules
           ↓
       permissions 为空则删除 permissions
           ↓
       atomic write
           ↓
       disabled
```

---

# 23. Ensure 修改示例

修改前：

```json
{
  "asyncByDefault": true,

  "permissions": {
    "rules": {
      "write": "ask",
      "edit": "deny"
    }
  },

  "maxSubagentDepth": 1
}
```

修改后：

```json
{
  "asyncByDefault": true,
  "maxSubagentDepth": 1
}
```

其他配置必须保留。

---

# 24. Ensure 核心伪代码

```ts
export function ensurePiSubagentsNativePermissionsDisabled(options: {
  agentDir: string;
}): EnsureNativePermissionsResult {
  if (isPiSubagentChildProcess()) {
    return {
      status: 'skipped-child',
      configPath: '',
      removedRules: 0,
    };
  }

  const configPath = getPiSubagentsConfigPath(options.agentDir);

  if (!existsSync(configPath)) {
    return {
      status: 'not-configured',
      configPath,
      removedRules: 0,
    };
  }

  const config = readJsonObject(configPath);

  const permissions = config.permissions;

  if (permissions === undefined) {
    return {
      status: 'already-disabled',
      configPath,
      removedRules: 0,
    };
  }

  if (!isPlainObject(permissions)) {
    throw new SubagentNativePermissionEnsureError('Invalid pi-subagents permissions config');
  }

  const rules = permissions.rules;

  if (rules === undefined || (isPlainObject(rules) && Object.keys(rules).length === 0)) {
    return {
      status: 'already-disabled',
      configPath,
      removedRules: 0,
    };
  }

  const removedRules = isPlainObject(rules) ? Object.keys(rules).length : 1;

  delete permissions.rules;

  if (Object.keys(permissions).length === 0) {
    delete config.permissions;
  }

  backupOnce(configPath);

  atomicWriteJson(configPath, config);

  return {
    status: 'disabled',
    configPath,
    removedRules,
  };
}
```

---

# 25. Ensure 设计要求

## 25.1 无变化时零写入

禁止：

```text
read
↓
JSON.stringify
↓
write
```

每次启动都覆盖文件。

必须：

```text
Already Correct
↓
ZERO WRITE
```

避免：

- mtime 变化
- watcher 触发
- 配置同步冲突
- 多进程噪音
- backup 工具误判

---

## 25.2 原子写

禁止直接覆盖原文件。

建议：

```text
config.json
↓
config.json.tmp-<pid>-<uuid>
↓
flush
↓
rename
```

第一次自动修改前保存：

```text
config.json.permission-system.bak
```

Backup 已存在则：

```text
不覆盖
```

---

## 25.3 错误策略

以下情况：

```text
JSON parse error
permissions 类型错误
read failure
write failure
rename failure
```

必须：

```text
fail fast
```

抛出：

```ts
SubagentNativePermissionEnsureError;
```

错误至少包含：

```text
configPath
reason
manual remediation
```

不能因为 ensure 失败继续启动两套权限系统。

---

# 26. Agent Frontmatter Native Permission 检测

全局 `permissions.rules` 关闭后，Agent Markdown 仍可能定义：

```yaml
permission:
```

或者：

```yaml
permissions:
```

因此 Agent discovery 时必须检测。

禁止自动修改 Agent Markdown。

建议：

```ts
if ('permission' in frontmatter || 'permissions' in frontmatter) {
  throw new Error(
    'pi-subagents native permission frontmatter is disabled. ' + 'Use permissionPolicy instead.'
  );
}
```

原因：

Agent Markdown 可能：

- 来自用户
- 来自 Git
- 来自 npm package
- 来自 Project

静默改写风险太高。

所以：

```text
Global config
→ 自动 ensure

Agent frontmatter
→ detect + reject + migration guidance
```

---

# 27. Ensure 执行时机

Ensure 必须发生在：

```text
pi-subagents extension 初始化之前
```

推荐：

```text
createAgentRuntime()
        │
        ▼
PermissionSystem bootstrap
        │
        ├── ensurePiSubagentsNativePermissionsDisabled()
        │
        └── create extension
        │
        ▼
ResourceLoader
        │
        ▼
load pi-subagents
```

禁止：

```text
pi-subagents 已 load config
↓
再修改 config.json
```

因为当前 Runtime 已经读取旧配置。

如果现有 ResourceLoader 无法保证顺序，应将 ensure 提升到 Agent Runtime bootstrap。

---

# 28. Built-in Extension 初始化

```ts
export function createPermissionSystem(options: PermissionSystemOptions): InlineExtension {
  ensurePiSubagentsNativePermissionsDisabled({
    agentDir: options.agentDir,
  });

  return (pi) => {
    registerPermissionSystem(pi, options);
  };
}
```

---

# 29. Subagent Child Runtime

`nicobailon/pi-subagents` 使用独立 Child Process。

必须保证 Child 启动的也是 Dr.Octopus Runtime。

使用：

```text
PI_SUBAGENT_PI_BINARY
```

指定 Dr.Octopus Agent Binary。

最终：

```text
Parent Dr.Octopus
        │
        ▼
nicobailon/pi-subagents
        │
        ▼
spawn
        │
        ▼
Child Dr.Octopus
        │
        ├── built-in PermissionSystem
        ├── built-in Extensions
        ├── agentDir
        └── configDir
```

禁止：

```text
Parent Dr.Octopus
↓
stock Pi child
```

---

# 30. Subagent Detection

删除 upstream 针对：

```text
@gotgenes/pi-subagents
```

的专用：

```text
subagents:child:session-created
subagents:child:disposed
SubagentSessionRegistry
```

因为 nicobailon 是 subprocess。

使用以下环境变量识别 Child：

```text
PI_SUBAGENT_CHILD
PI_SUBAGENT_RUN_ID
PI_SUBAGENT_CHILD_AGENT
PI_SUBAGENT_DEPTH
PI_SUBAGENT_PARENT_SESSION
```

---

# 31. Active Agent

优先：

```text
PI_SUBAGENT_CHILD_AGENT
```

例如：

```ts
function getActiveAgent(): string | undefined {
  return normalize(process.env.PI_SUBAGENT_CHILD_AGENT);
}
```

不再优先依赖 system prompt tag。

---

# 32. Parent Permission Forwarding

保留 upstream：

```text
ParentAuthorizer
ForwardingManager
ForwardedRequestServer
ForwardingIO
```

通过：

```text
PI_SUBAGENT_PARENT_SESSION
```

寻找 Parent Session。

---

# 33. Child Ask 流程

Child：

```text
Child Tool
    ↓
Static Policy
    ↓
ask
    ↓
ParentAuthorizer
    ↓
PI_SUBAGENT_PARENT_SESSION
    ↓
Parent ForwardedRequestServer
```

Parent：

```text
Forwarded Request
        ↓
Parent Static Policy
        ↓
Parent PermissionMode
        │
        ├── ask
        │    ↓
        │   Web UI
        │
        ├── auto
        │    ↓
        │ selective allow
        │
        └── full
             ↓
            allow
```

---

# 34. PermissionMode 不跨进程同步

禁止设计：

```text
PERMISSION_MODE env
permission-mode.json
IPC broadcast
file watcher
```

Parent Runtime 是最终 authority。

例如：

```text
Child 已运行
↓
Parent = ask

Web:
ask → full

Child 下一次 ask
↓
forward Parent
↓
Parent 当前 full
↓
allow
```

运行中的 Child 不需要收到 mode change。

---

# 35. RPC API

Web：

```ts
type PermissionMode = 'ask' | 'auto' | 'full';
```

Server：

```text
GET /runtime/permission-mode

PUT /runtime/permission-mode
```

Request：

```json
{
  "mode": "auto"
}
```

Response：

```json
{
  "mode": "auto"
}
```

---

# 36. Pi Extension Command

注册：

```text
/permission-mode ask
/permission-mode auto
/permission-mode full
```

示例：

```ts
pi.registerCommand('permission-mode', {
  description: 'Change permission mode',

  handler(args) {
    const mode = parsePermissionMode(args);

    permissionModeService.set(mode);
  },
});
```

---

# 37. Mode 切换即时生效

PermissionManager 每一次 Gate 都必须调用：

```ts
permissionModeService.get();
```

禁止启动时缓存。

错误：

```ts
const mode = permissionModeService.get();
```

正确：

```text
Request A
↓
get mode = ask
↓
Web 弹窗

Web:
ask → full

Request A
↓
继续等待

Request B
↓
get mode = full
↓
allow
```

当前已弹出的 Request 不重新计算。

后续 Request 立即生效。

---

# 38. Web Approval

`ask` 继续复用 Pi RPC Extension UI：

```text
PermissionSystem
↓
ctx.ui
↓
extension_ui_request
↓
apps/server
↓
Web
↓
PermissionDialog
↓
extension_ui_response
↓
Pi RPC
```

不要自行再造第二套 Permission Request RPC Protocol。

---

# 39. Permission Events

保留：

```text
permissions:ui_prompt
permissions:decision
```

用于：

- Web observability
- Audit
- Pending UI
- Debug
- Logging

---

# 40. 安全原则

## Explicit Deny

```text
deny
↓
永远 deny
```

## Invalid Config

```text
fail closed
```

## External Directory

保留独立处理：

```text
external_directory
```

## Path

继续保留 upstream：

```text
canonical path
symlink protection
external path detection
```

## Bash

继续使用 upstream Bash Parser 与 Command Policy。

禁止降级成简单 Regex 权限判断。

---

# 41. Licensing

`epheien/pi-permission-system` 为 MIT License。

复制源码后保留：

```text
packages/agent/src/extensions/permission-system/
└── LICENSE.upstream
```

项目 NOTICE 中记录：

```text
Permission system derived from
epheien/pi-permission-system
MIT License
```

---

# 42. PermissionMode Tests

必须覆盖：

```text
ask  + ask       -> ask

auto + write ask -> allow
auto + edit ask  -> allow
auto + bash ask  -> ask
auto + mcp ask   -> ask

full + ask       -> allow

ask  + deny      -> deny
auto + deny      -> deny
full + deny      -> deny
```

---

# 43. Runtime Tests

```text
initial mode = ask

set auto
get = auto

set full
get = full

set full
get = full

/reload
get = full
```

验证：

- process global
- idempotent
- reload stable

---

# 44. Immediate Switching Tests

```text
Request A
→ ask pending

set full

Request A
→ still pending

Request B
→ allow
```

---

# 45. Ensure Tests

## Config 不存在

```text
→ not-configured
→ 不创建 config
```

## 无 permissions

```text
→ already-disabled
→ zero write
```

## 空 rules

```json
{
  "permissions": {
    "rules": {}
  }
}
```

结果：

```text
already-disabled
```

## 有 rules

输入：

```json
{
  "foo": true,

  "permissions": {
    "rules": {
      "write": "ask"
    }
  }
}
```

结果：

```json
{
  "foo": true
}
```

## 保留其它配置

例如：

```text
asyncByDefault
watchdog
missions
parallel
```

必须完整保留。

## Invalid JSON

```text
→ throw
→ 原文件不修改
```

## Backup

第一次：

```text
create backup
```

第二次：

```text
do not overwrite backup
```

## Idempotency

连续：

```text
ensure()
ensure()
ensure()
```

只有第一次允许写。

## Child

Child Process：

```text
→ skipped-child
```

---

# 46. Subagent Integration Tests

## ask

```text
Child write
↓
ask
↓
Parent
↓
mode ask
↓
Web
```

## auto

```text
Child write
↓
Parent
↓
mode auto
↓
allow
```

## auto + bash

```text
Child bash
↓
Parent
↓
mode auto
↓
ask
```

## full

```text
Child bash
↓
Parent
↓
mode full
↓
allow
```

## Hard Deny

```text
Child operation
↓
deny rule
↓
Parent full
↓
仍 deny
```

---

# 47. 实施阶段

## Phase 1 — Upstream Import

把：

```text
epheien/pi-permission-system/src
```

复制到：

```text
packages/agent/src/extensions/permission-system
```

先修复：

- imports
- dependencies
- tsconfig
- package references
- test references

此阶段：

```text
不要改目录
不要改权限语义
```

目标是先让 upstream 行为完整跑通。

---

## Phase 2 — Built-in Extension

取消：

```text
pi install
npm package discovery
third-party extension discovery
```

由：

```text
packages/agent
```

直接注册：

```ts
createPermissionSystem(...)
```

---

## Phase 3 — Path Adaptation

统一替换：

```text
.pi
extension-specific config dir
getAgentDir()
```

等旧路径依赖。

全部通过：

```ts
agentDir;
configDir;
packageDir;
```

注入。

完成后全局搜索：

```text
".pi"
"pi-permission-system"
"@gotgenes"
"yolo"
```

逐项审查。

---

## Phase 4 — PermissionMode

完成：

```text
yoloMode:boolean
```

到：

```text
PermissionMode
```

迁移。

删除：

```text
toggleYoloMode
isYoloEnabled
yolo config schema
yolo config persistence
```

---

## Phase 5 — Auto Mode

实现：

```ts
applyPermissionMode();
```

必须保证：

```text
只提升 ask
永远不提升 deny
```

---

## Phase 6 — pi-subagents Compatibility

实现：

```text
compat/pi-subagents.ts
```

核心：

```ts
ensurePiSubagentsNativePermissionsDisabled();
```

同时禁止 Agent 使用：

```yaml
permission:
permissions:
```

统一使用：

```yaml
permissionPolicy:
```

---

## Phase 7 — Subagent Forwarding

删除：

```text
@gotgenes/pi-subagents
```

专属：

```text
lifecycle events
session registry
```

保留：

```text
ParentAuthorizer
ForwardingManager
ForwardedRequestServer
ForwardingIO
```

统一适配：

```text
PI_SUBAGENT_PARENT_SESSION
```

---

## Phase 8 — RPC / Web

实现：

```text
GET /runtime/permission-mode
PUT /runtime/permission-mode
```

以及：

```text
/permission-mode
```

连接 Web：

```text
ask
auto
full
```

三档权限模式。

---

# 48. 最终职责边界

## Dr.Octopus Core

负责：

```text
agentDir
configDir
packageDir
built-in extension lifecycle
Pi RPC lifecycle
```

## Permission System

负责：

```text
Static Policy
Tool Gate
Bash Gate
MCP Gate
Path Gate
External Directory
ask / auto / full
User Approval
Hard Deny
Subagent Permission Forwarding
Permission Audit
```

## nicobailon/pi-subagents

负责：

```text
Subagent Orchestration
Agent Discovery
tools:
Workflow
Chain
Worktree
Watchdog
Child Process
Child Runtime
```

不负责：

```text
Runtime Permission Authority
```

其：

```text
permissions.rules
```

由 Permission System bootstrap 自动 ensure 为关闭状态。

---

# 49. 最终核心模型

```text
                 Permission System

Static Policy
      │
      ▼
allow / ask / deny
      │
      ▼
PermissionMode
      │
 ┌────┼────┐
 │    │    │
ask  auto full
```

所有：

```text
Root Agent
Child Agent
Tool
Bash
MCP
Path
External Directory
```

统一进入这一套权限体系。

`nicobailon/pi-subagents` 只负责：

```text
这个 Subagent 能看到什么
```

Permission System 负责：

```text
它看到以后能不能执行
```

最终保证：

```text
一个 Runtime
一个 PermissionMode
一个 Permission Policy Engine
一个 User Approval Flow
```

避免：

```text
pi-subagents Watchdog Permission
+
Dr.Octopus PermissionSystem
```

两套 Runtime Authority 同时生效。

---

# 50. 开发验收标准

实现完成后必须满足：

- [ ] Permission System 已内置到 `packages/agent/src/extensions/permission-system`
- [ ] 不再依赖 `@gotgenes/pi-permission-system` Runtime Package
- [ ] PermissionMode 统一为 `ask | auto | full`
- [ ] PermissionMode 为 Process Global
- [ ] PermissionMode 不落盘
- [ ] `/reload` 后 PermissionMode 保留
- [ ] 新请求立即读取最新 PermissionMode
- [ ] 已弹出的旧请求不重新计算
- [ ] `auto` 只自动批准普通编辑操作
- [ ] `full` 仅将 `ask` 提升为 `allow`
- [ ] `deny` 永远无法被 PermissionMode 提升
- [ ] Global Config 使用 `<agentDir>/permission-system.json`
- [ ] Project Config 使用 `<cwd>/<configDir>/permission-system.json`
- [ ] Permission System 内部不写死 `.pi` / `.dr-octopus`
- [ ] Dr.Octopus Agent 使用 `permissionPolicy:`
- [ ] 禁止使用 pi-subagents native `permission:` / `permissions:`
- [ ] Root bootstrap 自动 ensure 关闭 `permissions.rules`
- [ ] Ensure 幂等、原子写、支持 backup、失败 fail-fast
- [ ] Child Process 不执行 ensure
- [ ] nicobailon 子进程启动 Dr.Octopus Binary
- [ ] Child `ask` 能通过 ParentAuthorizer 转发到 Parent
- [ ] Parent 当前 PermissionMode 能即时决定 Child 后续请求
- [ ] Web `ask` 使用 Pi RPC 原生 `extension_ui_request/response`
- [ ] Bash / MCP / Path / External Directory 权限保持 upstream 安全能力
- [ ] upstream MIT License 已保留
- [ ] Unit / Runtime / Integration Tests 全部通过
