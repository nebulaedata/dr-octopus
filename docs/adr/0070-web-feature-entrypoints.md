# ADR-0070：前端 feature 公共入口与实现归属

## 状态

Accepted

## 决策

- 九个业务 feature 使用纯具名导出的 `index.ts`，外部消费者只访问公开组件入口；同 feature 内直接引用实现，不反向导入自身入口。
- 页面实现使用具名组件文件；已有业务 Hook 与纯投影分别位于 feature 的 `hooks/`、`utils/`，两者不再嵌套目录。Query、请求与 Zustand 的既有所有权保留。
- 设置导航 Context 由内部 Hook 模块持有，Provider 是独立组件；设置导航模型在 Hook 中供导航与标题读取，不放入依赖组件的工具模块。
- 附件上传任务 Map 归 session store 域，保留浏览器实例范围与原来的取消/完成清理顺序，不为搬移而创建第二份状态。
- Sidebar 通过 session 的 `SessionRestartActions` 组件取得动作与确认框；确认状态仍属于每个动作宿主，pending 继续由原 Query mutation key 共享。
- 工具注册和选择私有地内聚于 `ToolRenderer.tsx`，ToolCard 保留通用外壳；解析与摘要保持纯工具，custom → built-in → fallback 顺序不变。
- 会话和调度页面通过普通公共组件包装内部 lazy 实现。已经静态使用其他公开组件的 feature 不再同时被路由动态导入整个 barrel，避免保留整个命名空间。路由的 Suspense 保留，不能让 lazy 解析结果再次成为 lazy 对象。
- 构建仅将经过结构测试的一级 feature 纯入口标记为无初始化副作用，不对 UI 实现、store 或第三方依赖做全局无副作用假设。

## 取舍与验证

入口用于稳定调用关系，不用于重新组织业务所有权。少量惰性页面包装用于保持加载边界，不推广为每个组件一层包装，也不按 300 行强制拆分。

通过 AST 检查目录、静态/动态导入、公开导出和 feature 依赖环；嵌套三目使用 ESLint 检查。原有状态与业务测试继续执行，浏览器回归保护草稿、焦点、首条发送与页面导航。详见 [重构记录](../refactoring/web-features.md) 与 [工具渲染开发指南](../architecture/web-tool-renderers.md)。
