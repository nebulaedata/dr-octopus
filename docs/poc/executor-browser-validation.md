# executor-browser：概念验证与验收

架构设计：[原设计](../architecture/executor-browser.md)。

2026-11-03 从架构正文迁入；以下保留原测试计划、结果、日期与限制。测试计划或验收要求不代表已执行通过。

## 持续验证入口

协议和路由使用扩展 test/*.test.mjs；真实反馈、连接、冻结/丢弃和原生 popup 使用 Executor test/integration 的对应用例；扩展 test:popup 单独检查实际 action 目标与生产弹窗文档。

浏览器夹具使用唯一测试 Host、扩展副本和隔离 Profile；不替换正式注册，不改日常配置。仅在测试副本注入故障，不向产品加入故障、脚本、强停或额外控制接口。自动 action/CDP 交互与人工点击工具栏、商店分发、企业策略及跨环境稳定性分别验收。

Native Host 的 host-location.json 仅接受 projectRoot，读取其 browser 子目录。安装脚本参数为 ProjectRoot，与 Main/Runtime 的业务根一致；不再从 Electron userData 读取桥接凭据。
