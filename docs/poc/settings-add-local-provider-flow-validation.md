# settings-add-local-provider-flow：概念验证与验收

架构设计：[原设计](../architecture/settings-add-local-provider-flow.md)。

2026-11-03 从架构正文迁入；计划与实际结果以原文标记为准，不代表新增验收通过。


## 11. 验收场景

- 长 Provider 列表滚动时“添加”按钮始终可见；
- 空列表、无搜索结果和列表查询失败时仍可打开 Dialog；
- Dialog 初始显示名称、类型和通用/品牌图标，默认类型为 Ollama；
- 名称为空时不能进入下一步；
- 切换 preset 会清除旧探测 fingerprint 和模型选择；
- 探测可取消，失败后草稿不丢失；
- API Key 永不进入 wizard、URL、Query cache 或日志；
- 保存并取消认证后 Provider 保留且显示“需要认证”；
- 409/412 后草稿保留且可继续；
- 浏览器返回关闭 Dialog，选中的背景 Provider 不变；
- 桌面 Dialog 和移动全屏 Sheet 均满足键盘、焦点和 sticky action 要求。
