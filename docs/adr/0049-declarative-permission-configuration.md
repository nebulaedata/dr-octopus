# ADR-0049：统一声明式权限配置与 Settings

- 状态：Implemented
- 日期：2026-09-11
- 修订：ADR-0020 中默认规则的存放位置、配置加载和会话授权范围；不改变唯一门禁或运行模式不持久化的约束。

## 背景

默认策略原先由 `definitions/types.ts` 内的工厂生成，工具分类和知识库授权范围则写在 Pi 事件适配器里。两者只能部分配置，新增扩展需要修改门禁代码，Settings 的权限入口也没有实现。

## 决定

1. 默认规则移入 Agent 的 `permission-system/config/permission-system.json`，构建时原样复制到 dist。类型定义不负责创建默认值，Pi adapter 不包含扩展工具名单。
2. Shared 提供严格的 Zod 配置协议。Agent 负责读取、合并、校验、解释规则和保存；Server 只解析已登记的工作区并映射 HTTP 错误；Web 使用同一协议编辑覆盖。
3. 同一份 JSON 同时描述 `toolRules`（工具分类、参数字段、会话授权范围）、`policy.tools`（固定动作）、`modes`（各模式工具动作、类型默认动作、外部路径动作）以及审计选项。它们仍是不同职责的配置段，不执行表达式或脚本。
4. 优先级为内置默认 → `<agentDir>/permission-system.json` → 可信工作区 `<cwd>/<CONFIG_DIR_NAME>/permission-system.json`。当前产品的 `CONFIG_DIR_NAME` 为 `.dr-octopus`。未信任的工作区不参与运行时合并。
5. JSON 仅保存本级覆盖。动作映射按键覆盖，数组整体替换，单个工具描述整体替换；`toolRules.<name>: null` 删除继承分类，删除本级键恢复继承。未知工具归类为 `custom`。无版本的已有策略文件继续可读，Settings 保存时写入 `version: 2`；未知字段和非法取值报错。
6. 决策先执行硬安全检查和显式拒绝，再处理会话授权和动作选择。固定工具策略优先于模式工具策略和类型默认；外部路径需同时满足本模式的外部路径规则。显式 `ask` 在 full 模式仍要求确认。内置默认维持三种模式的通常行为，硬安全规则不能用 JSON 关闭。
7. 每次 `tool_call` / `user_bash` 前重新加载规则，再使用同一快照归一化请求。有效配置、工作区或信任状态变化时清除会话授权。审批期间配置或模式变化则拒绝本次旧审批，要求重试。
8. 启动配置损坏时抛错；运行中损坏时保留最后有效快照用于诊断，但暂停放行工具，直到配置修复。不会因忽略损坏覆盖而回退到更宽松的默认权限。Settings 可读取有界的损坏 JSON 并修复，工作区上层配置损坏时应先修复全局配置。
9. 会话授权键使用结构化序列化，包含工作区、工具、声明的范围字段以及目录/命令。声明范围缺失时只提供单次授权；未知无范围工具也不提供整工具会话授权。Shell 会话授权绑定完整命令，避免共享前缀匹配复合命令。
10. Settings 使用原文件及继承层摘要作为 revision。写入时取得 OS 文件锁、校验 revision，并在同目录写临时文件后原子替换；冲突返回 409。配置最多 1 MiB，拒绝符号链接文件。只更改权限配置，不写 Pi settings 或持久任务 grant。

## 配置示例

```json
{
  "version": 2,
  "toolRules": {
    "custom_document_import": {
      "kind": "write",
      "pathFields": ["arguments.sourcePath"],
      "commandFields": [],
      "sessionApproval": {
        "fields": ["collectionId"],
        "pathParents": ["arguments.sourcePath"]
      }
    }
  },
  "policy": { "tools": { "custom_document_import": "ask" } },
  "modes": {
    "auto": { "kinds": { "shell": "ask" }, "external": "ask" },
    "full": { "tools": { "dangerous_tool": "deny" } }
  },
  "permissionReviewLog": true,
  "reviewLogFieldMaxWidth": 1000
}
```

`pathFields`、`commandFields` 支持点分参数路径和字符串数组。未指定时继承 `requestDefaults`。`sessionApproval.fieldDefaults` 可为缺失范围声明固定默认值，例如知识库创建集合的 `scope: workspace`。范围必需字段没有值时不会退化为全工具授权。

## Settings 与接口

- Settings → 高级 → 权限支持全局和工作区；沿用设置页容器、页头、Tabs、表格和编辑 Dialog，同时接入普通路由与 Settings 弹窗。
- 运行模式与审计配置分为独立卡片。审计使用直接保存的 Switch，并保留恢复继承；“日志文本保留长度”通过 Slider 配置，显示当前字符数，调整完成后保存并支持恢复继承；说明每个文本字段的截断长度。可编辑三种模式的类型/外部路径动作；逐工具编辑固定策略、各模式动作与声明式分类，支持恢复继承；完整 JSON 编辑器用于高级配置和修复。
- `GET /api/settings/permissions[?workspaceId=…]` 返回本级覆盖、继承配置、有效配置、来源路径、revision 和诊断。
- `PUT /api/settings/permissions[?workspaceId=…]` 接收 `{ revision, config }`。无 workspaceId 表示全局；未知工作区由 Workspace 服务拒绝；不接受浏览器传入 cwd。

## 后果与边界

- 新增工具只需增加配置描述，不必修改 Pi 适配器。工具注册、模型配置和实际功能由各自扩展负责。
- Settings 保存规则不会切换当前会话的 ask/auto/full 模式。已启动的旧版本 Agent 需先重启到包含此加载逻辑的版本，之后在下一次工具调用时读取修改。
- 无人值守任务继续使用独立的持久授权与 grant 校验；其强制工具限制来自 `policy.tools`，不会因交互模式配置而获得持久授权。
- 运行时采用有界同步文件读取，避免门禁读到半次加载结果；工具本身的沙箱、路径真实化和业务权限仍由工具负责。
- 回归验证覆盖继承、可信工作区、版本冲突、原子保存、损坏修复、未知工具、范围缺失、命令隔离和审批期间配置变化。

权限设置页将“继承”展示为“默认”。“恢复默认”清空当前范围的完整配置（权限与审计）：全局恢复系统预设，工作区恢复使用全局配置；写入仍校验当前版本，避免覆盖并发更新。
