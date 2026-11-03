# settings-web-layout：概念验证与验收

架构设计：[原设计](../architecture/settings-web-layout.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

## 11. 实施验收

开始 Settings Web 实施前，开发者应能仅凭本文和已链接领域文档回答：

1. 当前视口应该渲染几栏，各栏由谁滚动；
2. Provider 选择、非法 URL 和移动端返回如何改变路由；
3. 哪些 Provider、Endpoint 和模型操作由 capability 与 ownership 决定；
4. loading、empty、cached error、conflict 和 partial commit 如何展示；
5. 模型编辑和删除确认何时允许、何时必须先替换默认模型；
6. 每个区域复用哪个 shadcn/ui primitive；
7. 哪些状态属于 Query、Router、TanStack Form 或纯局部 UI 状态。

实现完成后至少验证：

- `1440 × 900`、`1024 × 768`、`768 × 1024` 和 `390 × 844` 四种视口；
- 三栏/两栏/单栏切换没有内容溢出或重复滚动条；
- 键盘全流程、焦点返回和危险操作确认；
- reference screenshot 与最终页面在信息层级、密度和分栏结构上的视觉对照；
- light/dark theme 均只使用语义 token；
- `pnpm lint`、`pnpm typecheck`、相关 Web tests 和视觉回归检查通过。
