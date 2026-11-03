# settings-module：概念验证与验收

架构设计：[原设计](../architecture/settings-module.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

### Phase C：验证

必须覆盖：

- Agent Service 单元测试；
- Pi SettingsManager、ModelRuntime、DefaultPackageManager 契约测试；
- Server Controller 路由测试；
- Web Query、表单和路由状态测试；
- API Key 不回显、不记录测试；
- Extension 单资源、批量、混合状态和字段保留测试；
- `pi config` 与 Web 写入结果的双向兼容测试；
- 同一视口下参考设计与最终 UI 的视觉对照；
- 键盘、焦点、窄屏和错误状态可访问性验证；
- `pnpm test`、`pnpm lint`、`pnpm typecheck` 和 `pnpm build`。

退出条件：

- 自动化检查全部通过；
- 视觉 QA 通过；
- 不存在 P0/P1/P2 问题；
- 文档与实际实现一致。
